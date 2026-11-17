import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../support/env';
import { anonClient, ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim, item, op, push } from '../support/ops';
import { SEED } from '../support/seed-ids';
import { telegramClear, waitForMessage } from '../support/telegram';

// Đầu-cuối: thao tác → notifications → pg_net → Edge Function telegram-dispatch → Telegram mock.

beforeAll(async () => {
  const ok = await fetch(`${ENV.url}/functions/v1/telegram-dispatch`, { method: 'POST', body: '{}' }).then((r) => r.status).catch(() => 0);
  if (ok === 0 || ok === 404 || ok === 503) {
    throw new Error('Edge Functions chưa chạy: `npx supabase functions serve` hoặc khởi động lại `npx supabase start`');
  }
});

beforeEach(async () => {
  await resetDb();
  await telegramClear();
});

describe('Telegram qua Edge Function', () => {
  it('mở ca gửi tin vào nhóm, đánh dấu đã gửi', async () => {
    const sim = new TabletSim(await tabletClient(SEED.tablets.A), SEED.tablets.A);
    await sim.openShift('Lan');
    const m = await waitForMessage((x) => x.text.includes('Lan mở ca'));
    expect(m.chat_id).toBe('-1001234567890');
    expect(m.token).toBe('test-token');
    expect(m.text).toMatch(/🟢 Lan mở ca – Tablet A – \d\d:\d\d/);
    await expect.poll(async () => (await sql(`select sent_at from notifications where kind = 'shift_open'`))[0].sent_at).not.toBeNull();
  });

  it('thao tác offline: tin hiện thời điểm thực hiện thật', async () => {
    const tab = await tabletClient(SEED.tablets.A);
    const sim = new TabletSim(tab, SEED.tablets.A);
    await sim.openShift('Lan');
    const o = await sim.createOrder([item('xoiGa')]);
    await sim.serve(o.id);
    const del = op('delete_order', o.id, { order_id: o.id, reason: 'customer_left' }, new Date(Date.now() - 30 * 60_000).toISOString());
    await push(tab, del);
    const m = await waitForMessage((x) => x.text.includes('Xóa đơn'));
    expect(m.text).toContain('ĐÃ RA MÓN');
    expect(m.text).toContain('Thực hiện:');
    expect(m.text).toContain('Đồng bộ:');
  });

  it('kích hoạt tablet: cấp phiên vai trò tablet, báo "Tablet A vừa được đăng nhập"', async () => {
    const owner = await ownerClient();
    const { data: s } = await owner.auth.getSession();
    const res = await fetch(`${ENV.url}/functions/v1/activate-tablet`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.session!.access_token}`, 'Content-Type': 'application/json', apikey: ENV.anonKey },
      body: JSON.stringify({ tablet_profile_id: SEED.tablets.A }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profile: { id: string; name: string };
      last_device_seq: number;
      session: { access_token: string; refresh_token: string };
    };
    expect(body.profile).toMatchObject({ id: SEED.tablets.A, name: 'Tablet A' });
    expect(body.last_device_seq).toBe(0);
    const tab = anonClient();
    await tab.auth.setSession(body.session);
    const { data: me } = await tab.auth.getUser();
    expect(me.user!.app_metadata).toMatchObject({ role: 'tablet', tablet_profile_id: SEED.tablets.A });
    expect((await tab.from('settings').select('*')).data).toEqual([]);
    await waitForMessage((x) => x.text.includes('Tablet A vừa được đăng nhập'));
  });

  it('kích hoạt tablet: người không phải chủ bị từ chối', async () => {
    const tab = await tabletClient(SEED.tablets.B);
    const { data: s } = await tab.auth.getSession();
    const res = await fetch(`${ENV.url}/functions/v1/activate-tablet`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.session!.access_token}`, 'Content-Type': 'application/json', apikey: ENV.anonKey },
      body: JSON.stringify({ tablet_profile_id: SEED.tablets.A }),
    });
    expect(res.status).toBe(403);
  });

  it('kích hoạt tablet: không có token / token anon bị từ chối', async () => {
    for (const headers of [{}, { Authorization: `Bearer ${ENV.anonKey}` }] as Record<string, string>[]) {
      const res = await fetch(`${ENV.url}/functions/v1/activate-tablet`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', apikey: ENV.anonKey },
        body: JSON.stringify({ tablet_profile_id: SEED.tablets.A }),
      });
      expect(res.status).toBe(403);
    }
    expect(await sql(`select 1 from audit_log where action = 'tablet_login'`)).toEqual([]);
  });

  it('kích hoạt lại: device_seq tiếp tục từ số lớn nhất server đã thấy', async () => {
    const sim = new TabletSim(await tabletClient(SEED.tablets.A), SEED.tablets.A);
    await sim.openShift('Lan');
    await sim.createOrder([item('xoiGa')]);
    await sim.createOrder([item('xoiGa')]);
    const owner = await ownerClient();
    const { data, error } = await owner.functions.invoke('activate-tablet', { body: { tablet_profile_id: SEED.tablets.A } });
    expect(error).toBeNull();
    expect(data.last_device_seq).toBe(2);
  });

  it('vào chế độ chủ trên tablet: ghi nhật ký + báo "Vào chế độ chủ trên Tablet A"', async () => {
    const owner = await ownerClient();
    const { error } = await owner.rpc('owner_mode_entered', { p_profile: SEED.tablets.A });
    expect(error).toBeNull();
    const log = await sql(`select actor_kind, tablet_profile_id from audit_log where action = 'owner_mode'`);
    expect(log).toEqual([{ actor_kind: 'owner', tablet_profile_id: SEED.tablets.A }]);
    const m = await waitForMessage((x) => x.text.includes('Vào chế độ chủ'));
    expect(m.text).toMatch(/👑 Vào chế độ chủ trên Tablet A – \d\d:\d\d/);
  });

  it('tổng kết ngày gọi thẳng endpoint: Telegram nhận đủ doanh thu theo điểm', async () => {
    const sim = new TabletSim(await tabletClient(SEED.tablets.A), SEED.tablets.A);
    await sim.openShift('Lan');
    const o = await sim.createOrder([item('xoiGa')]);
    await sim.pay(o.id, o.total, 'transfer');
    const owner = await ownerClient();
    const { error } = await owner.rpc('run_daily_summary', {});
    expect(error).toBeNull();
    const m = await waitForMessage((x) => x.text.includes('Tổng kết ngày'));
    expect(m.text).toContain('• Xôi A: 25.000');
    expect(m.text).toContain('CK 25.000');
  });
});
