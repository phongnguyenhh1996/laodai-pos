import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim, item } from '../support/ops';
import { SEED } from '../support/seed-ids';

// Ship hai kiểu (SPEC 4.2, 4.4, 4.7, 5): Quán ship / Shipper ngoài. Xôi gà = 25.000.

let tab: SupabaseClient;
let sim: TabletSim;

const SHIP = { dine_type: 'delivery', address: '12 Lê Lợi' };
const EXT = { ...SHIP, ship_mode: 'external', ship_fee: 5000, ship_payout: 10000, total: 30000 };

const shipRow = async (id: string) =>
  (await sql('select dine_type, ship_mode, ship_fee, ship_payout, total from orders where id = $1', [id]))[0];
const keptItem = async (orderId: string) => ({
  ...item('xoiGa'),
  id: (await sql('select id from order_items where order_id = $1', [orderId]))[0].id as string,
});
const deliveryNotices = () => sql(`select payload from notifications where kind = 'delivery_order' order by performed_at, id`);

beforeEach(async () => {
  await resetDb();
  tab = await tabletClient(SEED.tablets.A);
  sim = new TabletSim(tab, SEED.tablets.A);
  await sim.openShift('Lan');
});

describe('dữ liệu: kiểu ship + tiền trả shipper', () => {
  it('check constraint: shop ⇒ payout 0; external ⇒ đơn ship + payout 1.000–50.000 bội 1.000', async () => {
    const o = await sim.createOrder([item('xoiGa')], EXT);
    expect(o.result).toMatchObject({ status: 'ok' });
    const bad = [
      `update orders set ship_mode = 'shop' where id = $1`, // còn payout 10.000
      `update orders set ship_payout = 0 where id = $1`,
      `update orders set ship_payout = 7500 where id = $1`,
      `update orders set ship_payout = 60000 where id = $1`,
      `update orders set dine_type = 'takeaway', address = null, ship_fee = 0 where id = $1`,
      `update orders set ship_mode = 'grab' where id = $1`,
    ];
    for (const q of bad) await expect(sql(q, [o.id]), q).rejects.toThrow(/check constraint/);
  });

  it('shipper ngoài: lưu kiểu + payout, tổng không cộng payout; payout sai / thiếu ⇒ bad_ship_payout', async () => {
    for (const bad of [0, 7500, 60000, null, -5000]) {
      const r = await sim.createOrder([item('xoiGa')], { ...EXT, ship_payout: bad });
      expect(r.result, String(bad)).toEqual({ status: 'rejected', reason: 'bad_ship_payout' });
    }
    const { ship_payout: _omit, ...missing } = EXT;
    expect((await sim.createOrder([item('xoiGa')], missing)).result).toEqual({ status: 'rejected', reason: 'bad_ship_payout' });
    expect((await sim.createOrder([item('xoiGa')], { ...EXT, ship_mode: 'grab' })).result).toEqual({ status: 'rejected', reason: 'bad_ship_mode' });
    // Tổng có cộng payout ⇒ lệch.
    expect((await sim.createOrder([item('xoiGa')], { ...EXT, total: 40000 })).result).toEqual({ status: 'rejected', reason: 'total_mismatch' });

    const o = await sim.createOrder([item('xoiGa')], EXT);
    expect(o.result).toMatchObject({ status: 'ok', order: { ship_mode: 'external', ship_payout: 10000, total: 30000 } });
    expect(await shipRow(o.id)).toEqual({ dine_type: 'delivery', ship_mode: 'external', ship_fee: 5000, ship_payout: 10000, total: 30000 });
    const [n] = await deliveryNotices();
    expect(n.payload.order).toMatchObject({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10000, total: 30000 });

    // Phụ thu 0 vẫn được (bấm lại = bỏ), payout vẫn bắt buộc.
    const free = await sim.createOrder([item('xoiGa')], { ...EXT, ship_fee: 0, total: 25000 });
    expect(free.result).toMatchObject({ status: 'ok' });
  });

  it('quán ship gửi kèm payout ⇒ bỏ (lưu 0); mang về gửi external ⇒ shop / 0; client cũ không gửi ⇒ shop / 0', async () => {
    const shop = await sim.createOrder([item('xoiGa')], { ...SHIP, ship_mode: 'shop', ship_fee: 10000, ship_payout: 10000, total: 35000 });
    expect(await shipRow(shop.id)).toMatchObject({ ship_mode: 'shop', ship_fee: 10000, ship_payout: 0 });

    const take = await sim.createOrder([item('xoiGa')], { dine_type: 'takeaway', ship_mode: 'external', ship_payout: 10000 });
    expect(take.result).toMatchObject({ status: 'ok' });
    expect(await shipRow(take.id)).toEqual({ dine_type: 'takeaway', ship_mode: 'shop', ship_fee: 0, ship_payout: 0, total: 25000 });

    const old = await sim.createOrder([item('xoiGa')], { ...SHIP, ship_fee: 10000, total: 35000 });
    expect(old.result).toMatchObject({ status: 'ok' });
    expect(await shipRow(old.id)).toMatchObject({ ship_mode: 'shop', ship_payout: 0, total: 35000 });
    const kept = await keptItem(old.id);
    expect(await sim.update(old.id, [kept], { ...SHIP, ship_fee: 15000, total: 40000 })).toMatchObject({ status: 'ok' });
    expect(await shipRow(old.id)).toMatchObject({ ship_mode: 'shop', ship_fee: 15000, ship_payout: 0 });
  });

  it('đổi kiểu / payout ⇒ audit trước-sau + Telegram; đổi phí thôi ⇒ không báo; về mang về ⇒ shop / 0', async () => {
    const o = await sim.createOrder([item('xoiGa')], { ...SHIP, ship_fee: 10000, total: 35000 });
    const kept = await keptItem(o.id);
    expect(await deliveryNotices()).toHaveLength(1);

    expect(await sim.update(o.id, [kept], { ...SHIP, ship_mode: 'external', ship_fee: 10000, ship_payout: 10000, total: 35000 }))
      .toMatchObject({ status: 'ok' });
    expect(await sim.update(o.id, [kept], { ...SHIP, ship_mode: 'external', ship_fee: 10000, ship_payout: 15000, total: 35000 }))
      .toMatchObject({ status: 'ok' });
    // Chỉ đổi phụ thu ⇒ không báo lại.
    expect(await sim.update(o.id, [kept], { ...SHIP, ship_mode: 'external', ship_fee: 5000, ship_payout: 15000, total: 30000 }))
      .toMatchObject({ status: 'ok' });
    const ns = await deliveryNotices();
    expect(ns.map((n) => [n.payload.updated, n.payload.order.ship_mode, n.payload.order.ship_payout])).toEqual([
      [false, 'shop', 0],
      [true, 'external', 10000],
      [true, 'external', 15000],
    ]);

    const audits = await sql(`select before, after from audit_log where action = 'order_update' and entity_id = $1 order by at, id`, [o.id]);
    expect(audits.map((a) => [a.before.ship_mode, a.after.ship_mode, a.before.ship_payout, a.after.ship_payout])).toEqual([
      ['shop', 'external', 0, 10000],
      ['external', 'external', 10000, 15000],
      ['external', 'external', 15000, 15000],
    ]);

    expect(await sim.update(o.id, [kept], { dine_type: 'takeaway', ship_mode: 'external', ship_payout: 15000 })).toMatchObject({ status: 'ok' });
    expect(await shipRow(o.id)).toEqual({ dine_type: 'takeaway', ship_mode: 'shop', ship_fee: 0, ship_payout: 0, total: 25000 });
  });
});

describe('đối soát: trả shipper là tiền mặt từ két', () => {
  it('1 đơn shipper ngoài thu CK 30.000 (phụ thu 5.000, trả 10.000): đếm = tiền lẻ − 10.000 ⇒ chênh 0', async () => {
    const float = (await sql('select open_float from shifts where id = $1', [sim.shiftId]))[0].open_float as number;
    const o = await sim.createOrder([item('xoiGa')], EXT);
    // Chưa thanh toán ⇒ chưa trừ.
    expect((await sql('select private.reconcile_shift($1) r', [sim.shiftId]))[0].r.cash.expected).toBe(float);
    expect(await sim.pay(o.id, 30000, 'transfer')).toMatchObject({ status: 'ok' });
    const boxes = (await sql('select open_boxes from shifts where id = $1', [sim.shiftId]))[0].open_boxes as number;
    expect(await sim.closeShift(boxes - 1, 0, float - 10000)).toMatchObject({ status: 'ok' });

    const [n] = await sql(`select payload from notifications where kind = 'shift_close'`);
    expect(n.payload.reconcile.cash).toEqual({ expected: float - 10000, counted: float - 10000, diff: 0 });
    expect(n.payload.reconcile.revenue).toMatchObject({ total: 30000, transfer: 30000, ship_fee: 5000 });
    expect(n.payload.reconcile.ship).toEqual({
      shop_orders: 0, external_orders: 1, shop_fee: 0, external_fee: 5000, payout: 10000, external_profit: -5000,
    });
  });

  it('đơn shipper ngoài bị xóa ⇒ không có khoản chi', async () => {
    const float = (await sql('select open_float from shifts where id = $1', [sim.shiftId]))[0].open_float as number;
    const o = await sim.createOrder([item('xoiGa')], EXT);
    expect(await sim.del(o.id)).toMatchObject({ status: 'ok' });
    const r = (await sql('select private.reconcile_shift($1) r', [sim.shiftId]))[0].r;
    expect(r.cash.expected).toBe(float);
    expect(r.ship.payout).toBe(0);
  });

  it('thống kê ship theo kỳ: owner_report + owner_dashboard có khối ship', async () => {
    const a = await sim.createOrder([item('xoiGa')], EXT);
    const b = await sim.createOrder([item('xoiGa')], { ...SHIP, ship_fee: 10000, total: 35000 });
    await sim.pay(a.id, 30000, 'cash');
    expect(await sim.pay(b.id, 35000, 'debt', { customer: { id: SEED.customers.dungGv, name: 'Dũng' } })).toMatchObject({ status: 'ok' });
    const owner = await ownerClient();
    const day = (await sql('select private.business_date(now())::text d'))[0].d as string;
    const ship = { shop_orders: 1, external_orders: 1, shop_fee: 10000, external_fee: 5000, payout: 10000, external_profit: -5000 };
    const rep = await owner.rpc('owner_report', { p_from: day, p_to: day });
    expect(rep.error).toBeNull();
    expect(rep.data.revenue).toMatchObject({ total: 65000, ship_fee: 15000, ship });
    expect(rep.data.by_shift[0].reconcile.ship).toEqual(ship);
    const dash = await owner.rpc('owner_dashboard');
    expect(dash.error).toBeNull();
    expect(dash.data.revenue.ship).toEqual(ship);
    expect(dash.data.by_point.find((p: { point_id: string }) => p.point_id === SEED.points.xoiA).ship).toEqual(ship);

    const list = await owner.rpc('owner_orders', { p_date: day });
    expect(list.data.find((r: { id: string }) => r.id === a.id)).toMatchObject({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10000 });
  });
});

describe('chủ sửa đơn đã thanh toán: kiểu ship / phí / tiền trả shipper', () => {
  it('sửa payout ⇒ ca đóng được tính lại; đổi kiểu, phí; thiếu payout bị chặn; không gửi ⇒ giữ nguyên', async () => {
    const float = (await sql('select open_float from shifts where id = $1', [sim.shiftId]))[0].open_float as number;
    const o = await sim.createOrder([item('xoiGa')], EXT);
    await sim.pay(o.id, 30000, 'cash');
    await sim.closeShift(0, 0, float + 20000);
    const owner = await ownerClient();
    const rec = async () => (await owner.rpc('reconcile_shift', { p_shift: sim.shiftId })).data;
    expect((await rec()).cash).toEqual({ expected: float + 20000, counted: float + 20000, diff: 0 });

    // Chỉ sửa hình thức ⇒ kiểu / phí / payout giữ nguyên.
    expect((await owner.rpc('owner_edit_order', { p_order: o.id, p_payment_method: 'cash' })).error).toBeNull();
    expect(await shipRow(o.id)).toMatchObject({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10000, total: 30000 });

    expect((await owner.rpc('owner_edit_order', { p_order: o.id, p_ship_payout: 15000 })).error).toBeNull();
    expect((await rec()).cash).toEqual({ expected: float + 15000, counted: float + 20000, diff: 5000 });
    expect((await sql('select recalculated_at from shifts where id = $1', [sim.shiftId]))[0].recalculated_at).not.toBeNull();
    const [n] = await sql(`select payload from notifications where kind = 'owner_edit' order by performed_at desc, id desc limit 1`);
    expect([n.payload.before.ship_payout, n.payload.after.ship_payout]).toEqual([10000, 15000]);
    const [a] = await sql(`select before, after from audit_log where action = 'owner_edit_order' order by at desc, id desc limit 1`);
    expect([a.before.ship_payout, a.after.ship_payout]).toEqual([10000, 15000]);

    for (const bad of [{ p_ship_payout: 7500 }, { p_ship_payout: 0 }, { p_ship_fee: 7500 }, { p_ship_mode: 'grab' }]) {
      const { error } = await owner.rpc('owner_edit_order', { p_order: o.id, ...bad });
      expect(error?.code, JSON.stringify(bad)).toBe('22023');
    }

    // Về quán ship + đổi phí ⇒ payout 0, tổng = tiền món + phí mới.
    expect((await owner.rpc('owner_edit_order', { p_order: o.id, p_ship_mode: 'shop', p_ship_fee: 10000 })).error).toBeNull();
    expect(await shipRow(o.id)).toMatchObject({ ship_mode: 'shop', ship_fee: 10000, ship_payout: 0, total: 35000 });
    expect((await rec()).cash.expected).toBe(float + 35000);

    // Sang shipper ngoài mà không có payout ⇒ chặn; có payout ⇒ được.
    expect((await owner.rpc('owner_edit_order', { p_order: o.id, p_ship_mode: 'external' })).error?.code).toBe('22023');
    expect((await owner.rpc('owner_edit_order', { p_order: o.id, p_ship_mode: 'external', p_ship_payout: 20000 })).error).toBeNull();
    expect(await shipRow(o.id)).toMatchObject({ ship_mode: 'external', ship_fee: 10000, ship_payout: 20000, total: 35000 });
    // Sửa món ⇒ tổng = món mới + phí hiện tại.
    const kept = await keptItem(o.id);
    expect((await owner.rpc('owner_edit_order', { p_order: o.id, p_items: [{ ...kept, qty: 2 }] })).error).toBeNull();
    expect(await shipRow(o.id)).toMatchObject({ ship_fee: 10000, ship_payout: 20000, total: 60000 });
  });

  it('đơn không phải ship: gửi kiểu / payout bị bỏ', async () => {
    const o = await sim.createOrder([item('xoiGa')]);
    await sim.pay(o.id, 25000, 'cash');
    const owner = await ownerClient();
    expect((await owner.rpc('owner_edit_order', { p_order: o.id, p_ship_mode: 'external', p_ship_payout: 10000, p_ship_fee: 5000 })).error).toBeNull();
    expect(await shipRow(o.id)).toEqual({ dine_type: 'takeaway', ship_mode: 'shop', ship_fee: 0, ship_payout: 0, total: 25000 });
  });
});

describe('shift_ship_defaults', () => {
  it('đơn ship gần nhất của ca (kể cả đã thanh toán, trừ đã xóa); chỉ ba trường; quầy khác bị chặn', async () => {
    const defaults = async (c: SupabaseClient = tab) => c.rpc('shift_ship_defaults', { p_shift: sim.shiftId });
    expect(await defaults()).toMatchObject({ data: null, error: null });

    const a = await sim.createOrder([item('xoiGa')], EXT);
    await sim.createOrder([item('xoiGa')]); // mang về không tính
    expect((await defaults()).data).toEqual({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10000 });

    // Đã thanh toán (tablet không đọc được đơn) vẫn dùng làm mặc định.
    await sim.pay(a.id, 30000, 'transfer');
    expect((await tab.from('orders').select('id').eq('id', a.id)).data).toEqual([]);
    expect((await defaults()).data).toEqual({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10000 });

    const b = await sim.createOrder([item('xoiGa')], { ...SHIP, ship_fee: 15000, total: 40000 });
    expect((await defaults()).data).toEqual({ ship_mode: 'shop', ship_fee: 15000, ship_payout: 0 });
    await sim.del(b.id);
    expect((await defaults()).data).toEqual({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10000 });

    const other = await tabletClient(SEED.tablets.B);
    const denied = await defaults(other);
    expect(denied.data).toBeNull();
    expect(denied.error?.code).toBe('42501');
    expect((await defaults(await ownerClient())).data).toEqual({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10000 });
  });

  it('bill (print_doc) không có kiểu ship / tiền trả shipper', async () => {
    const o = await sim.createOrder([item('xoiGa')], EXT);
    const doc = (await sql('select private.print_doc($1) d', [o.id]))[0].d;
    expect(doc).toMatchObject({ ship_fee: 5000, total: 30000 });
    expect(Object.keys(doc)).not.toContain('ship_payout');
    expect(Object.keys(doc)).not.toContain('ship_mode');
  });
});
