// Sao lưu hằng đêm: đọc mọi bảng qua RPC (service role) thành { tên file: JSON }.
// Thuần TS, không import ⇒ dùng chung cho Edge Function nightly-backup (Deno) và test (Vitest).

/** Số dòng mỗi lần gọi backup_table_page. */
export const BACKUP_PAGE = 2000;
/** Bot Telegram chỉ gửi được file tối đa 50MB. */
export const TELEGRAM_FILE_LIMIT = 50 * 1024 * 1024;

export interface BackupManifest {
  format: 1;
  created_at: string;
  /** Ngày (giờ VN) lúc chụp. */
  business_date: string;
  /** Số dòng từng bảng trong bản chụp. */
  tables: Record<string, number>;
  /** Migration của DB nguồn (để biết bản chụp thuộc schema nào). */
  migrations: Array<{ version: string; name: string | null }>;
}

export interface Snapshot {
  manifest: BackupManifest;
  tables: Record<string, Array<Record<string, unknown>>>;
}

type RpcResult = { data: unknown; error: { message: string } | null };
export type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;

async function call(rpc: Rpc, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** Đọc toàn bộ bảng cần sao lưu, theo trang. Số dòng trong manifest = số dòng thật đã đọc. */
export async function readSnapshot(rpc: Rpc, page = BACKUP_PAGE): Promise<Snapshot> {
  const m = (await call(rpc, 'backup_manifest')) as BackupManifest;
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const t of Object.keys(m.tables)) {
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += page) {
      const chunk = (await call(rpc, 'backup_table_page', { p_table: t, p_offset: offset, p_limit: page })) as Array<Record<string, unknown>>;
      for (const r of chunk) rows.push(r);
      if (chunk.length < page) break;
    }
    tables[t] = rows;
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
  return { manifest: { ...m, tables: counts }, tables };
}

/** Nội dung file zip: manifest.json + <bảng>.json. */
export function snapshotFiles(s: Snapshot): Record<string, string> {
  const files: Record<string, string> = { 'manifest.json': JSON.stringify(s.manifest, null, 2) };
  for (const [t, rows] of Object.entries(s.tables)) files[`${t}.json`] = JSON.stringify(rows);
  return files;
}

export function backupFileName(date: string): string {
  return `laodai-${date}.zip`;
}

function count(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function backupCaption(m: BackupManifest, bytes: number): string {
  const [y, mo, d] = m.business_date.split('-');
  const t = (k: string) => count(m.tables[k] ?? 0);
  return [
    `💾 Sao lưu ${d}/${mo}/${y} · ${t('orders')} đơn · ${t('customers')} khách · ${formatBytes(bytes)}`,
    'Giữ file này. Khôi phục: README › Khôi phục từ bản sao lưu.',
  ].join('\n');
}
