// Tablet realtime (src/pos) chạy thật với Supabase local: hai máy cùng hồ sơ tablet dùng chung ca + hàng đợi,
// server cấp mã đơn / số thứ tự, gửi lại an toàn (idempotent), Realtime báo thay đổi qua live_pulse (kể cả "đã thanh toán").
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosError, createSupabaseBackend } from '@/pos';
import { anonClient, resetDb, sql, tabletClient } from '../support/db';
import { item } from '../support/ops';
import { SEED } from '../support/seed-ids';
import { liveTablet, type LiveTablet } from '../support/tablet';

const draft = (qty = 1) => ({ point_id: SEED.points.xoiA, dine_type: 'takeaway' as const, items: [item('xoiGa', ['trung'], qty)] });

let tabA1: SupabaseClient;
let tabA2: SupabaseClient;
const opened: LiveTablet[] = [];
const device = async (c: SupabaseClient, realtime = false) => {
  const t = await liveTablet(c, SEED.tablets.A, { realtime });
  opened.push(t);
  return t;
};

beforeEach(async () => {
  await resetDb();
  // Hai máy kích hoạt cùng hồ sơ Tablet A (hai phiên của cùng user tablet)
  tabA1 = await tabletClient(SEED.tablets.A);
  tabA2 = await tabletClient(SEED.tablets.A);
});

afterEach(async () => {
  opened.splice(0).forEach((t) => t.stop());
  await Promise.all([tabA1.removeAllChannels(), tabA2.removeAllChannels()]);
});

describe('hai máy cùng hồ sơ tablet', () => {
  it('chung một ca: máy 2 thấy ca máy 1 vừa mở; máy 2 không mở được ca thứ hai', async () => {
    const [m1, m2] = [await device(tabA1), await device(tabA2)];
    const s = await m1.pos.openShift({ staff_id: SEED.staff.Lan });
    expect(s).toMatchObject({ staff_name: 'Lan', open_boxes: 200, open_plates: 60, open_float: 500_000 });
    // Máy 2 chưa tải lại ⇒ bấm mở ca bị server từ chối, rồi tự thấy ca của máy 1
    await expect(m2.pos.openShift({ staff_id: SEED.staff.Mai })).rejects.toMatchObject({ reason: 'shift_already_open' });
    await m2.store.refresh();
    expect(m2.store.getSnapshot().open?.shift).toMatchObject({ id: s.id, staff_name: 'Lan' });
    expect(await sql(`select count(*)::int n from shifts where status = 'open'`)).toEqual([{ n: 1 }]);
  });

  it('tạo đơn cùng lúc: server cấp số thứ tự liên tiếp + mã đơn khác nhau; giờ tạo là giờ server', async () => {
    const [m1, m2] = [await device(tabA1), await device(tabA2)];
    await m1.pos.openShift({ staff_id: SEED.staff.Lan });
    await m2.store.refresh();
    const before = Date.now();
    const made = await Promise.all([m1.pos.createOrder(draft()), m2.pos.createOrder(draft(2)), m1.pos.createOrder(draft(3))]);
    expect(made.map((o) => o.device_seq).sort()).toEqual([1, 2, 3]);
    expect(new Set(made.map((o) => o.code)).size).toBe(3);
    for (const o of made) expect(Math.abs(Date.parse(o.created_at) - before)).toBeLessThan(60_000);
    expect(await sql('select 1 from seq_gaps')).toHaveLength(0);
    await Promise.all([m1.store.refreshOpen(), m2.store.refreshOpen()]);
    expect(m1.store.getSnapshot().open?.orders).toHaveLength(3);
    expect(m2.store.getSnapshot().open?.orders).toHaveLength(3);
  });

  it('máy 2 thanh toán đơn ⇒ máy 1 (chưa tải lại) thu lần nữa bị từ chối, báo rõ; không thu hai lần', async () => {
    const [m1, m2] = [await device(tabA1), await device(tabA2)];
    await m1.pos.openShift({ staff_id: SEED.staff.Lan });
    const o = await m1.pos.createOrder(draft());
    await m2.store.refresh();
    await m2.pos.payOrder(o.id, { method: 'transfer' });
    const err = await m1.pos.payOrder(o.id, { method: 'cash', cash_given: o.total }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PosError);
    expect(err).toMatchObject({ reason: 'order_not_open', message: expect.stringContaining('máy khác') });
    expect(await sql(`select status, payment_method from orders`)).toEqual([{ status: 'paid', payment_method: 'transfer' }]);
    await vi.waitFor(() => expect(m1.store.getSnapshot().open?.orders).toEqual([]));
  });
});

describe('realtime (live_pulse)', () => {
  it('máy 1 nghe realtime: máy 2 tạo đơn ⇒ hiện; máy 2 thanh toán ⇒ biến mất (RLS giấu đơn đã thanh toán vẫn báo được)', async () => {
    const m1 = await device(tabA1, true);
    const m2 = await device(tabA2);
    await vi.waitFor(() => expect(m1.store.getSnapshot().conn).toBe('live'), { timeout: 10_000 });
    await m2.pos.openShift({ staff_id: SEED.staff.Mai });
    await vi.waitFor(() => expect(m1.store.getSnapshot().open?.shift?.staff_name).toBe('Mai'), { timeout: 10_000 });

    const o = await m2.pos.createOrder(draft());
    await vi.waitFor(() => expect(m1.store.getSnapshot().open?.orders.map((x) => x.id)).toEqual([o.id]), { timeout: 10_000 });
    await m2.pos.payOrder(o.id, { method: 'debt', customer: { name: 'Hùng', description: 'xe ôm' } });
    await vi.waitFor(() => expect(m1.store.getSnapshot().open?.orders).toEqual([]), { timeout: 10_000 });
    // Ghi nợ ⇒ danh mục (khách + dư nợ) của máy 1 cũng cập nhật
    await vi.waitFor(() => expect(m1.store.getSnapshot().catalog?.customers.some((c) => c.name === 'Hùng')).toBe(true), { timeout: 10_000 });
  });

  it('RLS: tablet chỉ thấy nhịp của chính hồ sơ mình + danh mục; anon không thấy gì', async () => {
    const m1 = await device(tabA1);
    await m1.pos.openShift({ staff_id: SEED.staff.Lan });
    const tabB = await tabletClient(SEED.tablets.B);
    const b = await liveTablet(tabB, SEED.tablets.B);
    opened.push(b);
    await b.pos.openShift({ staff_id: SEED.staff.Mai });
    const keys = async (c: SupabaseClient) => ((await c.from('live_pulse').select('key')).data ?? []).map((r) => r.key).sort();
    expect(await keys(tabA1)).toEqual(['catalog', `profile:${SEED.tablets.A}`].sort());
    expect(await keys(tabB)).toEqual(['catalog', `profile:${SEED.tablets.B}`].sort());
    expect(await keys(anonClient())).toEqual([]);
    expect(await sql(`select key, rev from live_pulse where key like 'profile:%' order by key`)).toHaveLength(2);
  });
});

describe('gửi lại sau khi mất phản hồi', () => {
  it('cùng op_id ⇒ "duplicate" kèm đơn hiện tại; op bị từ chối gửi lại vẫn là "rejected"', async () => {
    const m1 = await device(tabA1);
    await m1.pos.openShift({ staff_id: SEED.staff.Lan });
    const shift = m1.store.getSnapshot().open!.shift!;
    const backend = createSupabaseBackend(tabA1);
    const it = item('xoiGa');
    const op = {
      op_id: crypto.randomUUID(), kind: 'create_order' as const, entity_id: crypto.randomUUID(),
      payload: { items: [it], order: { point_id: SEED.points.xoiA, dine_type: 'takeaway', opened_shift_id: shift.id, total: it.unit_price_snap } },
    };
    (op.payload.order as Record<string, unknown>).id = op.entity_id;
    const first = await backend.push(op);
    const again = await backend.push(op);
    expect(first).toMatchObject({ status: 'ok', order: { id: op.entity_id, device_seq: 1 } });
    expect(again).toMatchObject({ status: 'duplicate', order: { id: op.entity_id, code: (first as { order: { code: string } }).order.code } });

    const bad = { ...op, op_id: crypto.randomUUID(), entity_id: crypto.randomUUID(), payload: { items: [item('xoiGa')], order: { ...op.payload.order, id: crypto.randomUUID(), total: 1 } } };
    expect(await backend.push(bad)).toEqual({ status: 'rejected', reason: 'total_mismatch' });
    expect(await backend.push(bad)).toEqual({ status: 'rejected', reason: 'total_mismatch' });
  });
});
