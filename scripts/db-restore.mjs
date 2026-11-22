#!/usr/bin/env node
// Khôi phục DB từ file sao lưu hằng đêm (laodai-YYYY-MM-DD.zip trong chat Telegram).
//
//   DATABASE_URL='postgresql://postgres:<mật khẩu>@db.<ref>.supabase.co:5432/postgres' \
//     npm run db:restore -- laodai-2026-11-23.zip
//
// 1. Áp toàn bộ migration lên DB đích (`supabase db push`), bỏ qua bằng --skip-migrations.
// 2. Từ chối nếu DB đích đã có dữ liệu (không bao giờ ghi đè dự án đang bán).
// 3. Nạp mọi bảng trong một transaction, so số dòng với manifest; lệch ⇒ ROLLBACK.
// Các bước còn lại (Edge Function, secret, Vercel, kích hoạt tablet): README › Khôi phục từ bản sao lưu.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { finishRestore, loadSnapshot, parseBackupZip, verifyCounts } from './restore/lib.mjs';

const args = process.argv.slice(2);
const skipMigrations = args.includes('--skip-migrations');
const dbUrlArg = args.find((a) => a.startsWith('--db-url='))?.slice('--db-url='.length);
const file = args.find((a) => !a.startsWith('--'));
const dbUrl = dbUrlArg ?? process.env.DATABASE_URL;

if (!file || !dbUrl) {
  console.error('Dùng: DATABASE_URL=postgresql://… npm run db:restore -- <file.zip> [--skip-migrations]');
  process.exit(2);
}

const snap = parseBackupZip(readFileSync(file));
const total = Object.values(snap.manifest.tables).reduce((a, b) => a + b, 0);
console.log(`Bản sao lưu ngày ${snap.manifest.business_date} (chụp ${snap.manifest.created_at})`);
console.log(`${Object.keys(snap.tables).length} bảng, ${total} dòng; đơn: ${snap.manifest.tables.orders ?? 0}, khách: ${snap.manifest.tables.customers ?? 0}`);
const lastMigration = snap.manifest.migrations.at(-1);
if (lastMigration) console.log(`Migration cuối ở DB nguồn: ${lastMigration.version} ${lastMigration.name ?? ''}`);

if (!skipMigrations) {
  console.log('\n→ Áp migration (supabase db push)…');
  const r = spawnSync('npx', ['supabase', 'db', 'push', `--remote=${dbUrl}`, '--include-all', '--skip-vault', '--yes'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('Áp migration lỗi, dừng.');
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
try {
  console.log('\n→ Nạp dữ liệu…');
  await client.query('begin');
  await loadSnapshot(client, snap);
  await finishRestore(client);
  const bad = await verifyCounts(client, snap.manifest);
  if (bad.length) {
    await client.query('rollback');
    console.error('Số dòng không khớp, đã hủy (DB đích vẫn trống):', bad);
    process.exit(1);
  }
  await client.query('commit');
  console.log(`✔ Đã khôi phục ${total} dòng.`);
  console.log('Tiếp theo: README › Khôi phục từ bản sao lưu (Edge Function, secret, functions_url, Vercel, kích hoạt tablet, PIN chủ).');
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`✘ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
} finally {
  await client.end();
}
