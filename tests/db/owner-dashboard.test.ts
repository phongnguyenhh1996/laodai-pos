import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim, item, debtCustomer } from '../support/ops';
import { SEED } from '../support/seed-ids';

// Bước 9: dashboard, danh sách đơn có lọc, báo cáo (đối chiếu chuyển khoản, theo nhân viên) — chỉ chủ.

let owner: SupabaseClient;
let tabA: SupabaseClient;
const ids: Record<string, string> = {};
let today: string;

const debtTo = (customer: keyof typeof SEED.customers) => ({ customer: debtCustomer(SEED.customers[customer], 'Dũng') });

beforeAll(async () => {
  await resetDb();
  let tabB: SupabaseClient;
  [owner, tabA, tabB] = await Promise.all([ownerClient(), tabletClient(SEED.tablets.A), tabletClient(SEED.tablets.B)]);
  const a = new TabletSim(tabA, SEED.tablets.A);
  const b = new TabletSim(tabB, SEED.tablets.B);
  await a.openShift('Lan');
  await b.openShift('Mai');

  // Lan – Tablet A: TM 25.000 · CK 15.000 · CK cơm gà 35.000 · Nợ 20.000; 1 đơn đang mở; 1 đơn xóa sau khi ra món; 1 lần sửa
  const cash = await a.createOrder([item('xoiGa')]);
  const tr = await a.createOrder([item('xoiXeo', [], 2)]);
  await a.update(tr.id, [{ ...item('xoiXeo'), qty: 1 }]);
  const com = await a.createOrder([item('comGa')], { point_id: SEED.points.com, dine_type: 'dinein' });
  const debt = await a.createOrder([item('xoiPate')]);
  const open = await a.createOrder([item('xoiTc')]);
  const del = await a.createOrder([item('xoiGa')]);
  await a.serve(del.id);
  await a.del(del.id);
  await a.pay(cash.id, 25_000);
  await a.pay(tr.id, 15_000, 'transfer');
  await a.pay(com.id, 35_000, 'transfer');
  await a.pay(debt.id, 20_000, 'debt', debtTo('dungGv'));

  // Mai – Tablet B: CK 30.000, thu nợ CK 50.000
  const bTr = await b.createOrder([item('xoiTc')]);
  await b.pay(bTr.id, 30_000, 'transfer');
  await b.debtPayment(SEED.customers.dungGv, 50_000, 'transfer');

  Object.assign(ids, { cash: cash.id, tr: tr.id, com: com.id, debt: debt.id, open: open.id, del: del.id, bTr: bTr.id });
  [{ d: today }] = await sql<{ d: string }>(`select to_char(private.business_date(now()), 'YYYY-MM-DD') as d`);
});

describe('owner_dashboard (Tổng quan hôm nay)', () => {
  it('doanh thu theo điểm và hình thức, thu nợ, đơn xóa, ca đang mở, đơn đang chờ', async () => {
    const { data, error } = await owner.rpc('owner_dashboard');
    expect(error).toBeNull();
    expect(data.date).toBe(today);
    expect(data.revenue).toEqual({ total: 125_000, cash: 25_000, transfer: 80_000, debt: 20_000, orders: 5, ship_fee: 0,
      ship: { shop_orders: 0, external_orders: 0, shop_fee: 0, external_fee: 0, payout: 0, external_profit: 0 } });
    const byPoint = Object.fromEntries(
      (data.by_point as Array<{ point_id: string; total: number; transfer: number }>).map((p) => [p.point_id, [p.total, p.transfer]]),
    );
    expect(byPoint).toEqual({ [SEED.points.xoiA]: [60_000, 15_000], [SEED.points.xoiB]: [30_000, 30_000], [SEED.points.com]: [35_000, 35_000] });
    expect(data.debt_collected).toEqual({ cash: 0, transfer: 50_000 });
    expect(data.deleted).toEqual({ count: 1, served: 1 });
    expect((data.open_shifts as Array<{ staff_name: string }>).map((s) => s.staff_name).sort()).toEqual(['Lan', 'Mai']);
    expect((data.active_orders as Array<{ id: string; status: string }>).map((o) => [o.id, o.status])).toEqual([[ids.open, 'open']]);
    expect(data.wait).toEqual({ yellow_min: 5, red_min: 10 });
  });
});

describe('owner_report', () => {
  it('bank_check: tổng chuyển khoản theo ngày / điểm + thu nợ CK, để so với app ngân hàng', async () => {
    const { data, error } = await owner.rpc('owner_report', { p_from: today, p_to: today });
    expect(error).toBeNull();
    expect(data.bank_check).toHaveLength(1);
    const [day] = data.bank_check;
    expect(day.date).toBe(today);
    expect(day.points.map((p: { point_id: string; amount: number; orders: number }) => [p.point_id, p.amount, p.orders])).toEqual([
      [SEED.points.xoiA, 15_000, 1],
      [SEED.points.xoiB, 30_000, 1],
      [SEED.points.com, 35_000, 1],
    ]);
    expect(day.debt_payments).toEqual({ amount: 50_000, count: 1 });
    expect(day.total).toBe(130_000);
    expect(data.revenue.transfer).toBe(80_000);
  });

  it('by_day_point: tiền mặt = 0 (không phải null) ở điểm không có đơn tiền mặt', async () => {
    const { data } = await owner.rpc('owner_report', { p_from: today, p_to: today });
    const com = data.by_day_point.find((r: { point_id: string }) => r.point_id === SEED.points.com);
    expect(com).toMatchObject({ total: 35_000, cash: 0, transfer: 35_000, debt: 0, orders: 1 });
  });

  it('by_staff: TM / CK / Nợ, số đơn, thu nợ, số lần sửa / xóa của từng nhân viên', async () => {
    const { data } = await owner.rpc('owner_report', { p_from: today, p_to: today });
    const by = (id: string) => data.by_staff.find((s: { staff_id: string }) => s.staff_id === id);
    expect(by(SEED.staff.Lan)).toMatchObject({ total: 95_000, cash: 25_000, transfer: 50_000, debt: 20_000, orders: 4, edits: 1, deletes: 1, debt_collected: 0 });
    expect(by(SEED.staff.Mai)).toMatchObject({ total: 30_000, cash: 0, transfer: 30_000, debt: 0, orders: 1, edits: 0, deletes: 0, debt_collected: 50_000 });
    expect(by(SEED.staff.Hung)).toMatchObject({ total: 0, orders: 0 });
  });

  it('khoảng ngày khác ⇒ không có số liệu; khoảng ngược ⇒ lỗi', async () => {
    const { data } = await owner.rpc('owner_report', { p_from: '2020-01-01', p_to: '2020-01-02' });
    expect(data.revenue.total).toBe(0);
    expect(data.bank_check).toEqual([]);
    const bad = await owner.rpc('owner_report', { p_from: '2020-01-02', p_to: '2020-01-01' });
    expect(bad.error?.code).toBe('22023');
  });
});

describe('owner_orders (lọc đơn)', () => {
  const list = async (args: Record<string, unknown>) => {
    const { data, error } = await owner.rpc('owner_orders', args);
    expect(error).toBeNull();
    return (data as Array<{ id: string }>).map((o) => o.id).sort();
  };

  it('theo ngày / điểm / nhân viên / hình thức / trạng thái (bao gồm đã xóa)', async () => {
    expect(await list({ p_date: today })).toEqual(Object.values(ids).sort());
    expect(await list({ p_date: '2020-01-01' })).toEqual([]);
    expect(await list({ p_status: 'deleted' })).toEqual([ids.del]);
    expect(await list({ p_method: 'transfer' })).toEqual([ids.tr, ids.com, ids.bTr].sort());
    expect(await list({ p_point: SEED.points.com })).toEqual([ids.com]);
    expect(await list({ p_staff: SEED.staff.Mai })).toEqual([ids.bTr]);
    expect(await list({ p_staff: SEED.staff.Lan, p_method: 'debt' })).toEqual([ids.debt]);
  });

  it('mỗi dòng có người mở / người thu, khách nợ, món', async () => {
    const { data } = await owner.rpc('owner_orders', { p_method: 'debt' });
    expect(data[0]).toMatchObject({
      id: ids.debt,
      status: 'paid',
      opened_by: 'Lan',
      paid_by: 'Lan',
      point_name: 'Xôi A',
      tablet_name: 'Tablet A',
      customer_label: expect.stringContaining('Dũng'),
      items: [{ qty: 1 }],
    });
  });
});

describe('tablet không gọi được hàm của chủ', () => {
  it.each([
    ['owner_dashboard', {}],
    ['owner_orders', {}],
    ['owner_report', { p_from: '2020-01-01', p_to: '2100-01-01' }],
  ])('%s', async (fn, args) => {
    const { data, error } = await tabA.rpc(fn, args);
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });
});
