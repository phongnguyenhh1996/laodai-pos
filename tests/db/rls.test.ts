import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { anonClient, ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim, item } from '../support/ops';
import { SEED } from '../support/seed-ids';

// 10.3: vai trò tablet KHÔNG lấy được doanh thu, kể cả khi gọi API trực tiếp.

let tabA: SupabaseClient;
let tabB: SupabaseClient;
let owner: SupabaseClient;
let simA: TabletSim;
let simB: TabletSim;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await resetDb();
  [tabA, tabB, owner] = await Promise.all([tabletClient(SEED.tablets.A), tabletClient(SEED.tablets.B), ownerClient()]);
  simA = new TabletSim(tabA, SEED.tablets.A);
  simB = new TabletSim(tabB, SEED.tablets.B);
  await simA.openShift('Lan');
  await simB.openShift('Mai');
  const open = await simA.createOrder([item('xoiGa')]);
  const paid = await simA.createOrder([item('xoiXeo')]);
  const deleted = await simA.createOrder([item('xoiPate')]);
  const bOpen = await simB.createOrder([item('xoiTc')]);
  await simA.pay(paid.id, paid.total);
  await simA.del(deleted.id);
  Object.assign(ids, { open: open.id, paid: paid.id, deleted: deleted.id, bOpen: bOpen.id });
  // Một ca đã đóng của tablet A
  await simA.closeShift(199, 60, 515_000);
  await simA.openShift('Hung');
});

describe('vai trò tablet KHÔNG được', () => {
  it('đọc đơn paid hoặc deleted (kể cả theo id)', async () => {
    const { data, error } = await tabA.from('orders').select('id,status,total');
    expect(error).toBeNull();
    expect(data!.map((o) => o.id)).toEqual([ids.open]);
    for (const id of [ids.paid, ids.deleted]) {
      const r = await tabA.from('orders').select('*').eq('id', id);
      expect(r.data).toEqual([]);
      const items = await tabA.from('order_items').select('*').eq('order_id', id);
      expect(items.data).toEqual([]);
    }
  });

  it('đọc đơn của hồ sơ tablet khác', async () => {
    expect((await tabA.from('orders').select('id').eq('id', ids.bOpen)).data).toEqual([]);
    expect((await tabB.from('orders').select('id')).data!.map((o) => o.id)).toEqual([ids.bOpen]);
  });

  it('đọc ca đã đóng; chỉ thấy ca đang mở của mình', async () => {
    const { data } = await tabA.from('shifts').select('id,status,tablet_profile_id');
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ status: 'open', tablet_profile_id: SEED.tablets.A });
  });

  it.each(['audit_log', 'shift_adjustments', 'price_history', 'settings', 'debt_payments', 'sync_ops', 'seq_gaps', 'notifications', 'staff_details', 'payroll_entries', 'staff_day_marks'])(
    'đọc %s',
    async (t) => {
      const { data } = await tabA.from(t).select('*');
      expect(data ?? []).toEqual([]);
      // và chắc chắn bảng có dữ liệu với chủ (trừ bảng có thể rỗng)
    },
  );

  it('đọc hồ sơ tablet khác', async () => {
    const { data } = await tabA.from('tablet_profiles').select('id');
    expect(data!.map((p) => p.id)).toEqual([SEED.tablets.A]);
  });

  it('sửa giá món / topping / combo, sửa staff, tablet_profiles', async () => {
    const attempts = [
      tabA.from('products').update({ price: 1 }).eq('id', SEED.products.xoiGa).select(),
      tabA.from('toppings').update({ price: 1 }).eq('id', SEED.toppings.trung).select(),
      tabA.from('combos').update({ name: 'x' }).eq('id', SEED.combos.xoiGaTrung).select(),
      tabA.from('staff').update({ name: 'x' }).eq('id', SEED.staff.Lan).select(),
      tabA.from('tablet_profiles').update({ default_float: 0 }).eq('id', SEED.tablets.A).select(),
      tabA.from('products').insert({ menu_id: SEED.menus.xoi, name: 'x', price: 1 }).select(),
    ];
    for (const r of await Promise.all(attempts)) {
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
    const [p] = await sql('select price from products where id = $1', [SEED.products.xoiGa]);
    expect(p.price).toBe(SEED.prices.xoiGa);
  });

  it('sửa đơn qua UPDATE / INSERT trực tiếp', async () => {
    const u = await tabA.from('orders').update({ total: 1 }).eq('id', ids.open).select();
    expect(u.error).not.toBeNull();
    const [o] = await sql('select total from orders where id = $1', [ids.open]);
    expect(o.total).toBe(SEED.prices.xoiGa);
  });

  it('sửa đơn đã paid qua RPC', async () => {
    const r = await simA.update(ids.paid, [item('xoiXeo', [], 5)]);
    expect(r).toEqual({ status: 'rejected', reason: 'order_not_open' });
    const r2 = await simA.del(ids.paid);
    expect(r2.status).toBe('rejected');
    const [o] = await sql('select status, total from orders where id = $1', [ids.paid]);
    expect(o).toEqual({ status: 'paid', total: SEED.prices.xoiXeo });
  });

  it('hard delete bất kỳ bảng nào', async () => {
    for (const t of ['orders', 'order_items', 'customers', 'products', 'staff', 'shifts', 'audit_log']) {
      const r = await tabA.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000').select();
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
    const [{ n }] = await sql<{ n: number }>('select count(*)::int n from orders');
    expect(n).toBe(4);
  });

  it('gửi total sai: server tự tính lại và từ chối', async () => {
    const o = simA.createOrderOp([item('xoiGa', ['trung'])]);
    (o.op.payload.order as { total: number }).total = 1000;
    const { data } = await tabA.rpc('sync_push', { op: o.op });
    expect(data).toEqual({ status: 'rejected', reason: 'total_mismatch' });
    // Giá dòng sai cũng bị từ chối dù total khớp với giá sai
    const bad = item('xoiGa');
    bad.unit_price_snap = 1000;
    const o2 = simA.createOrderOp([bad]);
    expect((await tabA.rpc('sync_push', { op: o2.op })).data).toEqual({ status: 'rejected', reason: 'price_mismatch' });
    expect(await sql('select 1 from orders where id = any($1)', [[o.id, o2.id]])).toEqual([]);
  });

  it('đọc số kỳ vọng / chênh lệch của ca vừa đóng (RPC đóng ca chỉ trả ok)', async () => {
    const r = await simA.closeShift(100, 10, 1);
    expect(r).toMatchObject({ status: 'ok' });
    const rec = await tabA.rpc('reconcile_shift', { p_shift: simA.shiftId });
    expect(rec.data ?? null).toBeNull();
    expect(rec.error).not.toBeNull();
    const rep = await tabA.rpc('owner_report', { p_from: '2020-01-01', p_to: '2100-01-01' });
    expect(rep.error).not.toBeNull();
    await simA.openShift('Lan');
  });

  it('gọi RPC của chủ', async () => {
    const r = await tabA.rpc('owner_edit_order', { p_order: ids.paid, p_payment_method: 'transfer' });
    expect(r.error).not.toBeNull();
    const a = await tabA.rpc('owner_adjust_shift', { p_shift: simA.shiftId, p_kind: 'cash', p_qty: 1 });
    expect(a.error).not.toBeNull();
  });

  it('tự kích hoạt hồ sơ khác hay giả "vào chế độ chủ"', async () => {
    const act = await tabA.rpc('activate_tablet_profile', { p_profile: SEED.tablets.B });
    expect(act.error).not.toBeNull();
    const om = await tabA.rpc('owner_mode_entered', { p_profile: SEED.tablets.A });
    expect(om.error).not.toBeNull();
    expect(await sql(`select 1 from audit_log where action in ('tablet_login', 'owner_mode')`)).toEqual([]);
  });
});

describe('vai trò tablet ĐƯỢC', () => {
  it('đọc menu, nhân viên, khách và dư nợ', async () => {
    const [menus, products, toppings, combos, staff, customers, bal, cfg] = await Promise.all([
      tabA.from('menus').select('id'), tabA.from('products').select('id'), tabA.from('toppings').select('id'),
      tabA.from('combos').select('id'), tabA.from('staff').select('id'), tabA.from('customers').select('id'),
      tabA.rpc('customer_balances'), tabA.rpc('tablet_config'),
    ]);
    expect(menus.data).toHaveLength(2);
    expect(products.data).toHaveLength(6);
    expect(toppings.data).toHaveLength(7);
    expect(combos.data).toHaveLength(3);
    expect(staff.data).toHaveLength(3);
    expect(customers.data!.length).toBeGreaterThanOrEqual(2);
    expect(bal.data!.length).toBeGreaterThanOrEqual(2);
    expect(cfg.data).toEqual({ wait_yellow_min: 5, wait_red_min: 10, timezone: 'Asia/Ho_Chi_Minh' });
  });

  it('xem lịch sử nợ của khách: ngày, mã đơn, món (dù không đọc được đơn đã thanh toán)', async () => {
    const o = await simA.createOrder([item('xoiGa', [], 2)]);
    await simA.pay(o.id, o.total, 'debt', { customer: { id: SEED.customers.dungPhuongB, name: 'Dũng' } });
    const { data, error } = await tabA.rpc('customer_debt_history', { p_customer: SEED.customers.dungPhuongB });
    expect(error).toBeNull();
    const row = (data as { orders: Array<{ id: string; code: string; paid_at: string; total: number; items: unknown[] }> }).orders.find((x) => x.id === o.id);
    expect(row).toMatchObject({ total: o.total, items: [{ qty: 2, toppings: [] }] });
    expect(row!.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$/);
    expect(row!.paid_at).toBeTruthy();
    expect((await anonClient().rpc('customer_debt_history', { p_customer: SEED.customers.dungPhuongB })).error).not.toBeNull();
  });

  it('tạo, sửa, xóa mềm đơn đang mở của mình; mở/đóng ca; thu nợ', async () => {
    const o = await simA.createOrder([item('xoiGa')]);
    expect(o.result.status).toBe('ok');
    expect((await simA.update(o.id, [item('xoiGa', [], 2)])).status).toBe('ok');
    expect((await simA.serve(o.id)).status).toBe('ok');
    expect((await simA.del(o.id, 'mistake')).status).toBe('ok');
    const [row] = await sql('select status, delete_reason from orders where id = $1', [o.id]);
    expect(row).toEqual({ status: 'deleted', delete_reason: 'mistake' });
    expect((await simA.debtPayment(SEED.customers.dungGv, 10_000)).status).toBe('ok');
  });

  it('không sửa được đơn mở của tablet khác qua RPC', async () => {
    const r = await simA.update(ids.bOpen, [item('xoiGa')]);
    expect(r).toEqual({ status: 'rejected', reason: 'order_not_found' });
  });
});

describe('anon', () => {
  it('không đọc được gì, không gọi được sync_push', async () => {
    const a = anonClient();
    for (const t of ['orders', 'products', 'staff', 'customers']) {
      const r = await a.from(t).select('*');
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
    expect((await a.rpc('sync_push', { op: {} })).error).not.toBeNull();
  });
});

describe('vai trò chủ', () => {
  it('đọc tất cả', async () => {
    const { data } = await owner.from('orders').select('id,status');
    expect(data!.map((o) => o.status).sort()).toEqual(expect.arrayContaining(['open', 'paid', 'deleted']));
    expect((await owner.from('audit_log').select('id')).data!.length).toBeGreaterThan(0);
    expect((await owner.from('shifts').select('id')).data!.length).toBeGreaterThan(2);
  });

  it('sửa cài đặt trực tiếp; đổi giá sinh lịch sử giá', async () => {
    const r = await owner.from('products').update({ price: 27000 }).eq('id', SEED.products.xoiGa).select();
    expect(r.error).toBeNull();
    const hist = await owner.from('price_history').select('*').eq('entity_id', SEED.products.xoiGa);
    expect(hist.data).toEqual([expect.objectContaining({ old_price: 25000, new_price: 27000, entity_type: 'product' })]);
    await owner.from('products').update({ price: 25000 }).eq('id', SEED.products.xoiGa);
  });

  it('chủ cũng không hard delete được', async () => {
    const r = await owner.from('products').delete().eq('id', SEED.products.xoiPate).select();
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    const r2 = await owner.from('orders').delete().eq('id', ids.paid).select();
    expect(r2.error !== null || (r2.data ?? []).length === 0).toBe(true);
  });

  it('sửa đơn đã thanh toán: log trước/sau, owner_edited = true', async () => {
    const { data, error } = await owner.rpc('owner_edit_order', { p_order: ids.paid, p_payment_method: 'transfer' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ payment_method: 'transfer', owner_edited: true });
    const log = await sql('select actor_kind, before, after from audit_log where entity_id = $1 and action = $2', [ids.paid, 'owner_edit_order']);
    expect(log).toHaveLength(1);
    expect(log[0].actor_kind).toBe('owner');
    expect(log[0].before.payment_method).toBe('cash');
    expect(log[0].after.payment_method).toBe('transfer');
  });
});
