// Khôi phục bản sao lưu hằng đêm (zip JSON do Edge Function nightly-backup gửi vào Telegram) vào một DB Postgres.
// Dùng bởi scripts/db-restore.mjs và test tests/db/backup.test.ts.
import { strFromU8, unzipSync } from 'fflate';

/** Có dữ liệu ở một trong các bảng này ⇒ DB đích không trống ⇒ từ chối (không bao giờ ghi đè DB đang bán). */
export const CORE_TABLES = ['orders', 'shifts', 'customers', 'staff', 'products', 'points'];

const q = (name) => `"${String(name).replaceAll('"', '""')}"`;

/** Đọc file zip sao lưu ⇒ { manifest, tables }. Kiểm tra đủ file và đúng số dòng. */
export function parseBackupZip(buf) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch {
    throw new Error('Không đọc được file zip');
  }
  if (!files['manifest.json']) throw new Error('Không thấy manifest.json: không phải file sao lưu laodai');
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  if (manifest.format !== 1) throw new Error(`Định dạng sao lưu ${manifest.format} không hỗ trợ`);
  const tables = {};
  for (const [t, n] of Object.entries(manifest.tables)) {
    const f = files[`${t}.json`];
    if (!f) throw new Error(`File sao lưu thiếu ${t}.json`);
    tables[t] = JSON.parse(strFromU8(f));
    if (tables[t].length !== n) throw new Error(`${t}.json có ${tables[t].length} dòng, manifest ghi ${n}`);
  }
  return { manifest, tables };
}

/**
 * Nạp bản chụp vào DB đích (đã chạy đủ migration, chưa có dữ liệu).
 * Phải gọi trong transaction (người gọi lo BEGIN / COMMIT): lỗi giữa chừng ⇒ ROLLBACK, DB vẫn trống.
 * Tắt trigger + kiểm tra khóa ngoại trong lúc nạp (session_replication_role = replica):
 * không sinh nhật ký / tin Telegram giả, không phụ thuộc thứ tự bảng.
 */
export async function loadSnapshot(client, snap, { chunk = 500 } = {}) {
  for (const t of CORE_TABLES) {
    const { rows } = await client.query(`select exists (select 1 from public.${q(t)}) as x`);
    if (rows[0].x) {
      throw new Error(`DB đích đã có dữ liệu (bảng ${t}). Chỉ khôi phục vào một dự án mới, chưa có dữ liệu.`);
    }
  }

  const { rows: colRows } = await client.query(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  const columns = new Map();
  for (const r of colRows) {
    if (!columns.has(r.table_name)) columns.set(r.table_name, new Set());
    columns.get(r.table_name).add(r.column_name);
  }
  const plan = [];
  for (const [t, rows] of Object.entries(snap.tables)) {
    const have = columns.get(t);
    if (!have) throw new Error(`DB đích thiếu bảng ${t}: chạy đủ migration trước`);
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const missing = keys.filter((k) => !have.has(k));
    if (missing.length) throw new Error(`Bảng ${t} ở DB đích thiếu cột ${missing.join(', ')}: chạy đủ migration trước`);
    plan.push({ t, rows, keys });
  }

  await client.query('set local session_replication_role = replica');
  for (const { t, rows, keys } of plan) {
    // Xóa dòng mặc định do migration tạo (vd print_template) để nạp đúng bản chụp.
    await client.query(`delete from public.${q(t)}`);
    if (rows.length === 0) continue;
    // Chỉ chèn các cột có trong bản chụp ⇒ cột mới thêm sau (có default) vẫn nhận default.
    const cols = keys.map(q).join(', ');
    for (let i = 0; i < rows.length; i += chunk) {
      await client.query(
        `insert into public.${q(t)} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${q(t)}, $1::jsonb)`,
        [JSON.stringify(rows.slice(i, i + chunk))],
      );
    }
  }
  await client.query('set local session_replication_role = origin');
}

/** Sau khi nạp: dọn những thứ gắn với dự án cũ. */
export async function finishRestore(client) {
  // Tin Telegram chưa gửi ở dự án cũ: không gửi lại từ dự án mới.
  await client.query('update public.notifications set attempts = greatest(attempts, 5) where sent_at is null');
  // Tài khoản tablet thuộc auth của dự án cũ ⇒ bỏ liên kết, kích hoạt lại từng tablet.
  await client.query('update public.tablet_profiles set auth_user_id = null where auth_user_id is not null');
}

/** So số dòng từng bảng với manifest. Trả về danh sách bảng lệch (rỗng = khớp). */
export async function verifyCounts(client, manifest) {
  const bad = [];
  for (const [t, n] of Object.entries(manifest.tables)) {
    const { rows } = await client.query(`select count(*)::int as n from public.${q(t)}`);
    if (rows[0].n !== n) bad.push({ table: t, expected: n, actual: rows[0].n });
  }
  return bad;
}
