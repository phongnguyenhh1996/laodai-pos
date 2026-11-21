import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim, item, op, push, tick } from '../support/ops';
import { SEED } from '../support/seed-ids';

let tab: SupabaseClient;
let sim: TabletSim;

beforeEach(async () => {
  await resetDb();
  tab = await tabletClient(SEED.tablets.A);
  sim = new TabletSim(tab, SEED.tablets.A);
  await sim.openShift('Lan');
});

describe('sync_push', () => {
  it('đơn ship: lưu địa chỉ, báo Telegram khi tạo và khi đổi địa chỉ; thiếu địa chỉ bị từ chối', async () => {
    const bad = await sim.createOrder([item('xoiGa')], { dine_type: 'delivery', address: '   ' });
    expect(bad.result).toEqual({ status: 'rejected', reason: 'address_required' });

    const o = await sim.createOrder([item('xoiGa', [], 2)], { dine_type: 'delivery', address: ' 12 Lê Lợi ', label: 'Chị Hoa' });
    expect(o.result).toMatchObject({ status: 'ok' });
    expect(await sql('select dine_type, address from orders where id = $1', [o.id])).toEqual([
      { dine_type: 'delivery', address: '12 Lê Lợi' },
    ]);
    const kept = { ...item('xoiGa', [], 3), id: (await sql('select id from order_items where order_id = $1', [o.id]))[0].id };
    // Sửa món, cùng địa chỉ ⇒ không báo lại.
    await sim.update(o.id, [kept], { dine_type: 'delivery', address: '12 Lê Lợi' });
    await sim.update(o.id, [kept], { dine_type: 'delivery', address: '14 Lê Lợi' });
    const ns = await sql(`select payload from notifications where kind = 'delivery_order' order by performed_at`);
    expect(ns.map((n) => [n.payload.updated, n.payload.order.address, n.payload.point_name])).toEqual([
      [false, '12 Lê Lợi', 'Xôi A'],
      [true, '14 Lê Lợi', 'Xôi A'],
    ]);
    expect(ns[0].payload).toMatchObject({ staff_name: 'Lan', order: { label: 'Chị Hoa', items: [{ qty: 2 }] } });

    // Về mang về ⇒ bỏ địa chỉ, không báo; bao bì tính như mang về.
    await sim.update(o.id, [kept], { dine_type: 'takeaway', address: '14 Lê Lợi' });
    expect(await sql('select dine_type, address from orders where id = $1', [o.id])).toEqual([{ dine_type: 'takeaway', address: null }]);
    expect(await sql(`select 1 from notifications where kind = 'delivery_order'`)).toHaveLength(2);
    const takeaway = (await sql('select private.order_packaging($1) p', [o.id]))[0].p;
    await sim.update(o.id, [kept], { dine_type: 'delivery', address: '14 Lê Lợi' });
    expect((await sql('select private.order_packaging($1) p', [o.id]))[0].p).toEqual(takeaway);

    // Đơn thường không báo ship.
    await sim.createOrder([item('xoiGa')]);
    expect(await sql(`select 1 from notifications where kind = 'delivery_order'`)).toHaveLength(3);
  });

  it('đơn ship có khách: tạo khách mới cùng đơn, lưu địa chỉ gần nhất, báo Telegram kèm khách; trả tiền vẫn giữ khách', async () => {
    const newId = '01900000-0000-7000-8000-00000000c0de';
    const noName = await sim.createOrder([item('xoiGa')], { dine_type: 'delivery', address: '5 Hai Bà Trưng', customer: { id: newId, is_new: true, name: ' ' } });
    expect(noName.result).toEqual({ status: 'rejected', reason: 'customer_required' });

    const o = await sim.createOrder([item('xoiGa')], {
      dine_type: 'delivery', address: '5 Hai Bà Trưng', customer: { id: newId, is_new: true, name: ' Anh Tú ', phone: '0912 345 678' },
    });
    expect(o.result).toMatchObject({ status: 'ok', order: { customer_id: newId } });
    expect(await sql('select name, phone, address from customers where id = $1', [newId])).toEqual([
      { name: 'Anh Tú', phone: '0912 345 678', address: '5 Hai Bà Trưng' },
    ]);
    const [n1] = await sql(`select payload from notifications where kind = 'delivery_order'`);
    expect(n1.payload.customer).toEqual({ id: newId, label: 'Anh Tú', phone: '0912 345 678' });

    // Đổi sang khách có sẵn ⇒ báo lại, địa chỉ lưu vào khách đó; đổi về mang về ⇒ bỏ khách.
    const kept = { ...item('xoiGa'), id: (await sql('select id from order_items where order_id = $1', [o.id]))[0].id };
    const gv = SEED.customers.dungGv;
    await sim.update(o.id, [kept], { dine_type: 'delivery', address: '9 Pasteur', customer: { id: gv } });
    expect(await sql('select customer_id from orders where id = $1', [o.id])).toEqual([{ customer_id: gv }]);
    expect(await sql('select address from customers where id = $1', [gv])).toEqual([{ address: '9 Pasteur' }]);
    expect(await sql(`select 1 from notifications where kind = 'delivery_order'`)).toHaveLength(2);
    await sim.update(o.id, [kept], { dine_type: 'takeaway', customer: { id: gv } });
    expect(await sql('select customer_id from orders where id = $1', [o.id])).toEqual([{ customer_id: null }]);

    // Trả tiền mặt: đơn ship giữ khách, dư nợ không đổi.
    await sim.update(o.id, [kept], { dine_type: 'delivery', address: '9 Pasteur', customer: { id: gv } });
    expect(await sim.pay(o.id, o.total, 'cash')).toMatchObject({ status: 'ok' });
    expect(await sql('select payment_method, customer_id from orders where id = $1', [o.id])).toEqual([
      { payment_method: 'cash', customer_id: gv },
    ]);
    expect((await sql('select private.customer_balance($1) b', [gv]))[0].b).toBe(0);
  });

  it('phí ship: tổng = món + phí; phí sai bị từ chối; mang về bỏ phí; chủ sửa món giữ phí; doanh thu tách phí ship', async () => {
    const ship = { dine_type: 'delivery', address: '12 Lê Lợi' };
    const noFee = await sim.createOrder([item('xoiGa')], { ...ship, ship_fee: 10000 });
    expect(noFee.result).toEqual({ status: 'rejected', reason: 'total_mismatch' });
    for (const bad of [7500, 60000, -5000]) {
      const r = await sim.createOrder([item('xoiGa')], { ...ship, ship_fee: bad, total: 25000 + bad });
      expect(r.result).toEqual({ status: 'rejected', reason: 'bad_ship_fee' });
    }

    const o = await sim.createOrder([item('xoiGa')], { ...ship, ship_fee: 10000, total: 35000 });
    expect(o.result).toMatchObject({ status: 'ok' });
    expect(await sql('select ship_fee, total from orders where id = $1', [o.id])).toEqual([{ ship_fee: 10000, total: 35000 }]);
    const [n] = await sql(`select payload from notifications where kind = 'delivery_order'`);
    expect(n.payload.order).toMatchObject({ ship_fee: 10000, total: 35000 });

    const kept = { ...item('xoiGa'), id: (await sql('select id from order_items where order_id = $1', [o.id]))[0].id };
    // Đổi phí thôi ⇒ không báo lại Telegram; tổng thiếu phí ⇒ từ chối.
    expect(await sim.update(o.id, [kept], { ...ship, ship_fee: 15000, total: 40000 })).toMatchObject({ status: 'ok' });
    expect(await sql(`select 1 from notifications where kind = 'delivery_order'`)).toHaveLength(1);
    expect(await sim.update(o.id, [kept], { ...ship, ship_fee: 15000 })).toEqual({ status: 'rejected', reason: 'total_mismatch' });
    // Mang về: phí gửi kèm bị bỏ (như địa chỉ) ⇒ tổng chỉ còn tiền món.
    expect(await sim.update(o.id, [kept], { dine_type: 'takeaway', ship_fee: 15000 })).toMatchObject({ status: 'ok' });
    expect(await sql('select ship_fee, total from orders where id = $1', [o.id])).toEqual([{ ship_fee: 0, total: 25000 }]);

    expect(await sim.update(o.id, [kept], { ...ship, ship_fee: 20000, total: 45000 })).toMatchObject({ status: 'ok' });
    expect(await sim.pay(o.id, 45000, 'cash')).toMatchObject({ status: 'ok' });
    const owner = await ownerClient();
    const { error } = await owner.rpc('owner_edit_order', { p_order: o.id, p_items: [{ ...kept, qty: 2 }] });
    expect(error).toBeNull();
    expect(await sql('select ship_fee, total from orders where id = $1', [o.id])).toEqual([{ ship_fee: 20000, total: 70000 }]);

    const rec = (await sql('select private.reconcile_shift($1) r', [sim.shiftId]))[0].r;
    expect(rec.revenue).toMatchObject({ total: 70000, cash: 70000, ship_fee: 20000 });
    expect(rec.cash.expected - (await sql('select open_float from shifts where id = $1', [sim.shiftId]))[0].open_float).toBe(70000);
  });

  it('gửi lại cùng một op hai lần thì chỉ có một bản ghi', async () => {
    const o = sim.createOrderOp([item('xoiGa')]);
    expect(await push(tab, o.op)).toMatchObject({ status: 'ok' });
    expect(await push(tab, o.op)).toMatchObject({ status: 'duplicate' });
    const p = op('pay_order', o.id, { order_id: o.id, paid_shift_id: sim.shiftId, method: 'transfer', total: o.total });
    expect(await push(tab, p)).toMatchObject({ status: 'ok' });
    expect(await push(tab, p)).toMatchObject({ status: 'duplicate' });
    expect(await sql('select id from orders where id = $1', [o.id])).toHaveLength(1);
    expect(await sql('select id from order_items where order_id = $1', [o.id])).toHaveLength(1);
    expect(await sql(`select id from audit_log where entity_id = $1 and action = 'order_pay'`, [o.id])).toHaveLength(1);
  });

  it('gửi song song cùng một op vẫn chỉ một bản ghi', async () => {
    const o = sim.createOrderOp([item('xoiGa')]);
    const rs = await Promise.all([push(tab, o.op), push(tab, o.op), push(tab, o.op)]);
    expect(rs.map((r) => r.status).sort()).toEqual(['duplicate', 'duplicate', 'ok']);
    expect(await sql('select id from orders where id = $1', [o.id])).toHaveLength(1);
  });

  it('mỗi thay đổi trên đơn sinh đúng một dòng audit_log có before và after', async () => {
    const o = await sim.createOrder([item('xoiGa', [], 2)]);
    const itemsBefore = (await sql('select id from order_items where order_id = $1', [o.id])).map((r) => r.id);
    const kept = { ...item('xoiGa', [], 1), id: itemsBefore[0] };
    await sim.update(o.id, [kept]);
    await sim.serve(o.id);
    await sim.del(o.id, 'customer_left');
    const logs = await sql(`select action, before, after from audit_log where entity_id = $1 order by at, synced_at`, [o.id]);
    expect(logs.map((l) => l.action)).toEqual(['order_create', 'order_update', 'order_serve', 'order_delete']);
    expect(logs[0].before).toBeNull();
    for (const l of logs.slice(1)) {
      expect(l.before).not.toBeNull();
      expect(l.after).not.toBeNull();
    }
    expect(logs[1].before.items[0].qty).toBe(2);
    expect(logs[1].after.items[0].qty).toBe(1);
    expect(logs[3].after.status).toBe('deleted');
  });

  it('server cấp số thứ tự + mã đơn: số / mã máy gửi lên bị bỏ qua ⇒ không trùng, không lỗ hổng', async () => {
    const o1 = sim.createOrderOp([item('xoiGa')], { device_seq: 7, code: 'AAA' });
    const o2 = sim.createOrderOp([item('xoiGa')], { device_seq: 7, code: 'AAA' });
    const r1 = await push(tab, o1.op);
    const r2 = await push(tab, o2.op);
    expect([r1, r2]).toMatchObject([{ status: 'ok', order: { device_seq: 1 } }, { status: 'ok', order: { device_seq: 2 } }]);
    const rows = await sql<{ device_seq: number; code: string }>('select device_seq, code from orders order by device_seq');
    expect(rows.map((r) => r.device_seq)).toEqual([1, 2]);
    expect(rows[0].code).not.toBe(rows[1].code);
    expect(await sql('select 1 from seq_gaps')).toHaveLength(0);
    // Tablet khác đánh số riêng
    const simB = new TabletSim(await tabletClient(SEED.tablets.B), SEED.tablets.B);
    await simB.openShift('Mai');
    expect(await push(simB.c, simB.createOrderOp([item('xoiGa')]).op)).toMatchObject({ order: { device_seq: 1 } });
  });

  it('thiếu giờ thực hiện ⇒ dùng giờ server (máy lệch đồng hồ không làm lệch hàng đợi)', async () => {
    const o = sim.createOrderOp([item('xoiGa')]);
    delete (o.op as Partial<typeof o.op>).performed_at;
    expect(await push(tab, o.op)).toMatchObject({ status: 'ok' });
    const [row] = await sql<{ lag: number }>('select extract(epoch from now() - created_at)::int lag from orders');
    expect(Math.abs(row.lag)).toBeLessThan(60);
  });

  it('mỗi tablet chỉ có một ca mở: mở ca thứ hai bị từ chối', async () => {
    const r = await sim.openShift('Mai');
    expect(r).toEqual({ status: 'rejected', reason: 'shift_already_open' });
    expect(await sql(`select 1 from shifts where status = 'open' and tablet_profile_id = $1`, [SEED.tablets.A])).toHaveLength(1);
    // Tablet B vẫn mở ca được
    const simB = new TabletSim(await tabletClient(SEED.tablets.B), SEED.tablets.B);
    expect(await simB.openShift('Mai')).toMatchObject({ status: 'ok' });
  });

  it('ca nhận số mặc định của hồ sơ tablet; mở ca báo Telegram', async () => {
    const [s] = await sql('select open_boxes, open_plates, open_float, staff_id from shifts where id = $1', [sim.shiftId]);
    expect(s).toEqual({ open_boxes: 200, open_plates: 60, open_float: 500000, staff_id: SEED.staff.Lan });
    const [n] = await sql(`select payload from notifications where kind = 'shift_open'`);
    expect(n.payload).toMatchObject({ staff_name: 'Lan', tablet_name: 'Tablet A' });
  });

  it('từ chối nghiệp vụ: ghi nhật ký + báo chủ, không chặn hàng đợi', async () => {
    const o = sim.createOrderOp([item('xoiGa')], { point_id: SEED.points.xoiB });
    expect(await push(tab, o.op)).toEqual({ status: 'rejected', reason: 'point_not_allowed' });
    const [log] = await sql(`select action, reason from audit_log where action = 'sync_rejected'`);
    expect(log).toEqual({ action: 'sync_rejected', reason: 'point_not_allowed' });
    expect(await sql(`select 1 from notifications where kind = 'sync_rejected'`)).toHaveLength(1);
    // dữ liệu rác cũng bị từ chối thay vì làm lỗi RPC
    const junk = op('pay_order', o.id, { order_id: 'not-a-uuid' });
    expect((await push(tab, junk)).status).toBe('rejected');
    const future = op('serve_order', o.id, { order_id: o.id }, new Date(Date.now() + 3600_000).toISOString());
    expect(await push(tab, future)).toEqual({ status: 'rejected', reason: 'performed_at_in_future' });
  });

  it('kiểm giá: món ngừng bán, topping khác menu, giá topping sai đều bị từ chối', async () => {
    const owner = await ownerClient();
    await owner.from('products').update({ active: false }).eq('id', SEED.products.xoiPate);
    expect((await sim.createOrder([item('xoiPate')])).result).toEqual({ status: 'rejected', reason: 'product_inactive' });
    expect((await sim.createOrder([item('xoiGa', ['canh'])])).result).toEqual({ status: 'rejected', reason: 'bad_topping' });
    const t = item('xoiGa', ['trung']);
    t.toppings_snap[0].price = 1;
    expect((await sim.createOrder([t])).result).toEqual({ status: 'rejected', reason: 'price_mismatch' });
    expect((await sim.createOrder([item('xoiGa', [], 0)])).result).toEqual({ status: 'rejected', reason: 'bad_qty' });
  });

  it('đổi giá: dòng cũ giữ giá chụp, dòng mới dùng giá mới; đơn tạo offline trước khi đổi giá vẫn nhận', async () => {
    const owner = await ownerClient();
    const before = tick(0);
    const o = await sim.createOrder([item('xoiGa')]);
    const [old] = await sql('select id from order_items where order_id = $1', [o.id]);
    await owner.from('products').update({ price: 30000 }).eq('id', SEED.products.xoiGa);

    // Sửa đơn (giữ dòng cũ giá 25k + thêm dòng mới giá 30k)
    const keep = { ...item('xoiGa', [], 2), id: old.id };
    const fresh = { ...item('xoiGa'), unit_price_snap: 30000 };
    expect(await sim.update(o.id, [keep, fresh])).toMatchObject({ status: 'ok' });
    const [row] = await sql('select total from orders where id = $1', [o.id]);
    expect(row.total).toBe(25000 * 2 + 30000);
    // Dòng cũ mà đổi giá ⇒ từ chối
    expect(await sim.update(o.id, [{ ...keep, unit_price_snap: 30000 }, fresh])).toEqual({ status: 'rejected', reason: 'price_mismatch' });
    // Đơn mới với giá cũ (thời điểm thực hiện = sau khi đổi) ⇒ từ chối
    const late = sim.createOrderOp([item('xoiGa')]);
    late.op.performed_at = new Date().toISOString();
    expect(await push(tab, late.op)).toEqual({ status: 'rejected', reason: 'price_mismatch' });
    // Đơn tạo lúc offline TRƯỚC khi đổi giá, sync sau ⇒ nhận
    const offline = sim.createOrderOp([item('xoiGa')]);
    offline.op.performed_at = before;
    expect(await push(tab, offline.op)).toMatchObject({ status: 'ok' });
  });

  it('thanh toán: tiền thiếu bị từ chối; ghi nợ tên mới tự tạo khách; báo Telegram', async () => {
    const o = await sim.createOrder([item('xoiGa')]);
    expect(await sim.pay(o.id, o.total, 'cash', { cash_given: 1000 })).toEqual({ status: 'rejected', reason: 'cash_short' });
    const newId = crypto.randomUUID();
    const r = await sim.pay(o.id, o.total, 'debt', {
      customer: { id: newId, is_new: true, name: 'Hùng', description: 'xe ôm', phone: '' },
    });
    expect(r).toMatchObject({ status: 'ok' });
    const [c] = await sql('select name, description, phone from customers where id = $1', [newId]);
    expect(c).toEqual({ name: 'Hùng', description: 'xe ôm', phone: null });
    const [n] = await sql(`select payload from notifications where kind = 'debt_recorded'`);
    expect(n.payload).toMatchObject({ customer_label: 'Hùng (xe ôm)', amount: 25000, balance: 25000, order_code: expect.any(String) });
  });

  it('đơn mở từ ca trước được thu ở ca sau: tiền tính vào ca thu', async () => {
    const o = await sim.createOrder([item('xoiGa')]);
    const first = sim.shiftId;
    await sim.closeShift(199, 60, 500000);
    await sim.openShift('Mai');
    expect(await sim.pay(o.id, o.total)).toMatchObject({ status: 'ok' });
    const [row] = await sql('select opened_shift_id, paid_shift_id from orders where id = $1', [o.id]);
    expect(row).toEqual({ opened_shift_id: first, paid_shift_id: sim.shiftId });
  });

  it('đóng ca: thông báo kèm đối soát, RPC chỉ trả ok', async () => {
    const o = await sim.createOrder([item('xoiGa')]);
    await sim.pay(o.id, o.total);
    expect(await sim.closeShift(199, 60, 505000)).toMatchObject({ status: 'ok' });
    const [n] = await sql(`select payload from notifications where kind = 'shift_close'`);
    expect(n.payload.reconcile.cash).toEqual({ expected: 525000, counted: 505000, diff: -20000 });
    expect(n.payload.reconcile.boxes).toEqual({ used: 1, by_orders: 1, diff: 0 });
  });

  it('thu nợ: lưu vào ca hiện tại, báo Telegram kèm dư nợ còn lại', async () => {
    const o = await sim.createOrder([item('xoiGa')]);
    await sim.pay(o.id, o.total, 'debt', { customer: { id: SEED.customers.dungGv, name: 'Dũng' } });
    expect(await sim.debtPayment(SEED.customers.dungGv, 10000)).toMatchObject({ status: 'ok' });
    const [p] = await sql('select shift_id, amount from debt_payments');
    expect(p).toEqual({ shift_id: sim.shiftId, amount: 10000 });
    const [n] = await sql(`select payload from notifications where kind = 'debt_paid'`);
    expect(n.payload).toMatchObject({ customer_label: 'Dũng (giáo viên)', amount: 10000, balance: 15000 });
  });

  it('xóa đơn: báo Telegram ngay kèm nội dung và trạng thái đã ra món', async () => {
    const o = await sim.createOrder([item('xoiGa', ['trung'], 2)]);
    await sim.serve(o.id);
    await sim.del(o.id, 'customer_left');
    const [n] = await sql(`select payload from notifications where kind = 'order_deleted'`);
    expect(n.payload).toMatchObject({ was_served: true, reason: 'customer_left', staff_name: 'Lan' });
    expect(n.payload.order.items[0]).toMatchObject({ qty: 2, name_snap: 'Xôi gà' });
  });
});
