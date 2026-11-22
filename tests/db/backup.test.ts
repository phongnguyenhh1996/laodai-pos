import { strToU8, zipSync } from 'fflate';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readSnapshot, snapshotFiles, type Snapshot } from '../../supabase/functions/_shared/backup';
import { finishRestore, loadSnapshot, parseBackupZip, verifyCounts } from '../../scripts/restore/lib.mjs';
import { ENV } from '../support/env';
import { anonClient, ownerClient, resetDb, serviceClient, sql, tabletClient, withPg } from '../support/db';
import { TabletSim, item } from '../support/ops';
import { SEED } from '../support/seed-ids';
import { telegramClear, telegramMessages, waitForMessage } from '../support/telegram';

// Sao lưu hằng đêm (Edge Function nightly-backup → file zip vào Telegram) và khôi phục (scripts/restore/lib.mjs).

const MAIN_CHAT = '-1001234567890';

async function runBackup(): Promise<{ status: string; error?: string; tables?: Record<string, number> }> {
  const res = await fetch(`${ENV.url}/functions/v1/nightly-backup`, { method: 'POST', body: '{}' });
  return (await res.json()) as { status: string; error?: string };
}

/** Tạo ít dữ liệu nghiệp vụ: một ca, đơn tiền mặt, đơn ghi nợ, thu nợ. */
async function someBusiness() {
  const sim = new TabletSim(await tabletClient(SEED.tablets.A), SEED.tablets.A);
  await sim.openShift('Lan');
  const a = await sim.createOrder([item('xoiGa', ['trung'], 2)]);
  await sim.pay(a.id, a.total, 'cash');
  const b = await sim.createOrder([item('xoiXeo')]);
  await sim.pay(b.id, b.total, 'debt', { customer: { id: SEED.customers.dungGv, name: 'Dũng' } });
  await sim.debtPayment(SEED.customers.dungGv, 10_000);
  // Đợi các tin Telegram do thao tác trên sinh ra gửi xong (telegram-dispatch cập nhật notifications bất đồng bộ).
  await expect
    .poll(async () => (await sql(`select count(*)::int n from notifications where sent_at is null and attempts = 0`))[0].n, { timeout: 15_000 })
    .toBe(0);
  return { a, b };
}

function snapshotNow(): Promise<Snapshot> {
  const svc = serviceClient();
  return readSnapshot((fn, args) => svc.rpc(fn, args));
}

const sortRows = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).sort();

beforeAll(async () => {
  const s = await fetch(`${ENV.url}/functions/v1/nightly-backup`, { method: 'GET' }).then((r) => r.status).catch(() => 0);
  if (s !== 405) throw new Error('Edge Function nightly-backup chưa chạy: khởi động lại `npx supabase start`');
});

beforeEach(async () => {
  await resetDb();
  await sql('truncate backup_runs');
  await telegramClear();
});

describe('đọc dữ liệu để sao lưu', () => {
  it('chỉ service_role gọi được', async () => {
    expect((await anonClient().rpc('backup_manifest')).error).not.toBeNull();
    expect((await (await ownerClient()).rpc('backup_manifest')).error).not.toBeNull();
    expect((await (await tabletClient(SEED.tablets.A)).rpc('backup_table_page', { p_table: 'orders', p_offset: 0, p_limit: 10 })).error).not.toBeNull();
    const { data, error } = await serviceClient().rpc('backup_manifest');
    expect(error).toBeNull();
    expect(data.format).toBe(1);
    expect(data.migrations.length).toBeGreaterThan(0);
  });

  it('gồm mọi bảng public trừ dữ liệu tạm và PIN chủ (gắn tài khoản auth)', async () => {
    const { data } = await serviceClient().rpc('backup_manifest');
    const all = (await sql<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public' order by 1`)).map((r) => r.t);
    expect(Object.keys(data.tables).sort()).toEqual(
      all.filter((t) => !['live_pulse', 'print_jobs', 'sync_ops', 'owner_device_pins'].includes(t)),
    );
    const { error } = await serviceClient().rpc('backup_table_page', { p_table: 'sync_ops', p_offset: 0, p_limit: 10 });
    expect(error?.message).toContain('không được sao lưu');
  });

  it('phân trang theo khóa chính: trang nhỏ cho kết quả y như một trang lớn', async () => {
    await someBusiness();
    const svc = serviceClient();
    const big = await readSnapshot((fn, args) => svc.rpc(fn, args));
    const small = await readSnapshot((fn, args) => svc.rpc(fn, args), 2);
    expect(small.tables).toEqual(big.tables);
    const [{ n }] = await sql(`select count(*)::int n from orders`);
    expect(big.manifest.tables.orders).toBe(n);
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe('Edge Function nightly-backup', () => {
  it('gửi file zip vào chat chính, mỗi ngày một lần', async () => {
    const { a } = await someBusiness();
    await telegramClear();
    const r = await runBackup();
    expect(r.status).toBe('sent');

    const m = await waitForMessage((x) => !!x.document);
    expect(m.chat_id).toBe(MAIN_CHAT);
    expect(m.document!.filename).toMatch(/^laodai-\d{4}-\d\d-\d\d\.zip$/);
    expect(m.text).toMatch(/^💾 Sao lưu \d\d\/\d\d\/\d{4} · 2 đơn · \d+ khách · \d+ KB/);

    const snap = parseBackupZip(Buffer.from(m.document!.base64, 'base64'));
    expect(snap.manifest.tables.orders).toBe(2);
    expect(snap.tables.orders.map((o) => o.id)).toContain(a.id);
    expect(snap.tables.settings[0]).toMatchObject({ telegram_chat_id: MAIN_CHAT });

    const runs = await sql(`select status, bytes, tables from backup_runs`);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'sent', tables: snap.manifest.tables });
    expect(runs[0].bytes).toBe(Buffer.from(m.document!.base64, 'base64').length);

    expect((await runBackup()).status).toBe('already_sent');
    expect((await telegramMessages()).filter((x) => x.document)).toHaveLength(1);
    // Đã gửi ⇒ cron 03:30 không gọi lại, 04:00 không cảnh báo.
    expect((await sql(`select private.backup_tick() r`))[0].r).toBe('done');
    expect((await sql(`select private.backup_watchdog() id`))[0].id).toBeNull();
  });

  it('có backup_chat_id ⇒ gửi vào chat đó', async () => {
    await sql(`update settings set backup_chat_id = '-100777'`);
    expect((await runBackup()).status).toBe('sent');
    expect((await waitForMessage((x) => !!x.document)).chat_id).toBe('-100777');
  });

  it('lỗi ⇒ ghi lý do; 04:00 vẫn chưa gửi được ⇒ một tin cảnh báo', async () => {
    await sql(`update settings set telegram_chat_id = null, backup_chat_id = null`);
    const r = await runBackup();
    expect(r.status).toBe('failed');
    expect(r.error).toContain('chưa cài đặt chat');
    expect((await sql(`select status, error from backup_runs`))[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('chưa cài đặt chat') });

    const [{ id }] = await sql(`select private.backup_watchdog() id`);
    expect(id).not.toBeNull();
    const [n] = await sql(`select kind, payload from notifications where id = $1`, [id]);
    expect(n.kind).toBe('backup_failed');
    expect(n.payload).toMatchObject({ attempts: 1, error: expect.stringContaining('chưa cài đặt chat') });
    expect((await sql(`select private.backup_watchdog() id`))[0].id).toBeNull();

    // Sửa cài đặt rồi chạy lại trong ngày ⇒ gửi được.
    await sql(`update settings set telegram_chat_id = $1`, [MAIN_CHAT]);
    expect((await runBackup()).status).toBe('sent');
  });

  it('không có lần chạy nào ⇒ 04:00 vẫn cảnh báo', async () => {
    const [{ id }] = await sql(`select private.backup_watchdog() id`);
    const [n] = await sql(`select payload from notifications where id = $1`, [id]);
    expect(n.payload).toMatchObject({ attempts: 0, error: expect.stringContaining('không chạy') });
    await waitForMessage((x) => x.text.includes('Sao lưu đêm') && x.text.includes('không gửi được'));
  });

  it('chưa cài functions_url ⇒ cron không gọi', async () => {
    await sql(`delete from private.config where key = 'functions_url'`);
    expect((await sql(`select private.backup_tick() r`))[0].r).toBe('no_url');
  });

  it('cron 03:00 + 03:30 và 04:00 giờ VN', async () => {
    const jobs = await sql<{ jobname: string; schedule: string; command: string }>(
      `select jobname, schedule, command from cron.job where jobname like 'laodai-%backup%' order by jobname`,
    );
    expect(jobs).toEqual([
      { jobname: 'laodai-backup-watchdog', schedule: '0 21 * * *', command: 'select private.backup_watchdog()' },
      { jobname: 'laodai-nightly-backup', schedule: '0,30 20 * * *', command: 'select private.backup_tick()' },
    ]);
  });
});

describe('khôi phục', () => {
  it('sao lưu → zip → nạp vào DB trống ⇒ từng dòng của mọi bảng y như bản chụp', async () => {
    await someBusiness();
    const snap = await snapshotNow();
    const zip = zipSync(Object.fromEntries(Object.entries(snapshotFiles(snap)).map(([k, v]) => [k, strToU8(v)])));
    const parsed = parseBackupZip(zip);
    expect(parsed).toEqual(snap);

    await withPg(async (c) => {
      await c.query('begin');
      try {
        const tables = Object.keys(parsed.tables);
        await c.query(`truncate ${tables.map((t) => `public."${t}"`).join(', ')} cascade`);
        await loadSnapshot(c, parsed, { chunk: 3 });
        expect(await verifyCounts(c, parsed.manifest)).toEqual([]);
        for (const t of tables) {
          const { rows } = await c.query(`select to_jsonb(t) r from public."${t}" t`);
          expect(sortRows(rows.map((x) => x.r)), t).toEqual(sortRows(parsed.tables[t]));
        }
        // Nạp không sinh nhật ký / tin Telegram mới (trigger tắt trong lúc nạp).
        const { rows: n } = await c.query(`select count(*)::int n from notifications`);
        expect(n[0].n).toBe(parsed.manifest.tables.notifications);

        await finishRestore(c);
        const { rows: tp } = await c.query(`select count(*)::int n from tablet_profiles where auth_user_id is not null`);
        expect(tp[0].n).toBe(0);
        const { rows: pending } = await c.query(`select count(*)::int n from notifications where sent_at is null and attempts < 5`);
        expect(pending[0].n).toBe(0);
      } finally {
        await c.query('rollback');
      }
    });
  });

  it('từ chối DB đích đã có dữ liệu', async () => {
    const snap = await snapshotNow();
    await withPg(async (c) => {
      await c.query('begin');
      try {
        await expect(loadSnapshot(c, snap)).rejects.toThrow(/đã có dữ liệu/);
      } finally {
        await c.query('rollback');
      }
    });
  });

  it('DB đích thiếu cột ⇒ từ chối, không nạp gì', async () => {
    const snap = await snapshotNow();
    const bad: Snapshot = { ...snap, tables: { ...snap.tables, menus: snap.tables.menus.map((r) => ({ ...(r as object), cot_moi: 1 })) } };
    await withPg(async (c) => {
      await c.query('begin');
      try {
        await c.query(`truncate ${Object.keys(snap.tables).map((t) => `public."${t}"`).join(', ')} cascade`);
        await expect(loadSnapshot(c, bad as Parameters<typeof loadSnapshot>[1])).rejects.toThrow(/menus.*thiếu cột cot_moi/);
      } finally {
        await c.query('rollback');
      }
    });
  });

  it('file không phải bản sao lưu ⇒ báo rõ', () => {
    expect(() => parseBackupZip(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/manifest\.json/);
    expect(() => parseBackupZip(strToU8('không phải zip'))).toThrow(/zip/);
  });
});
