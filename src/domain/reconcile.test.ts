import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/reconcile-cases.json';
import { EMPTY_SHIP_STATS, reconcileShift, shipStats, type ReconcileInput, type ReconcileResult } from './reconcile';

const cases = fixture.cases as unknown as Array<{ name: string; input: Omit<ReconcileInput, 'products'>; expected: ReconcileResult }>;
const products = fixture.products;
const run = (name: string) => {
  const c = cases.find((x) => x.name === name)!;
  return reconcileShift({ ...c.input, products } as ReconcileInput);
};

describe('reconcile (bộ dữ liệu dùng chung với SQL)', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(reconcileShift({ ...c.input, products } as ReconcileInput)).toEqual(c.expected);
  });
});

describe('reconcile: quy tắc', () => {
  it('thống kê ship: chỉ đơn ship; đơn cũ thiếu kiểu ⇒ quán ship; lãi/lỗ ship ngoài = phụ thu − trả shipper', () => {
    expect(shipStats([])).toEqual(EMPTY_SHIP_STATS);
    expect(
      shipStats([
        { dine_type: 'delivery', ship_fee: 10_000 },
        { dine_type: 'delivery', ship_mode: 'external', ship_fee: 5_000, ship_payout: 10_000 },
        { dine_type: 'delivery', ship_mode: 'external', ship_fee: 20_000, ship_payout: 15_000 },
        { dine_type: 'takeaway' },
      ]),
    ).toEqual({ shop_orders: 1, external_orders: 2, shop_fee: 10_000, external_fee: 25_000, payout: 25_000, external_profit: 0 });
  });


  const r = run('co-ban');

  it('tiền mặt kỳ vọng = tiền lẻ + chủ bổ sung + đơn TM theo ca thu + TM thu nợ', () => {
    expect(r.cash.expected).toBe(500_000 + 200_000 + (30_000 + 35_000 + 45_000) + 50_000);
  });

  it('không tính CK, nợ, đơn đã xóa, đơn mở ở ca này nhưng thu ở ca khác', () => {
    expect(r.revenue.cash).toBe(110_000); // không có 40.000 của đơn thu ở ca b2
    expect(r.revenue.transfer).toBe(25_000);
    expect(r.revenue.debt).toBe(20_000);
    expect(r.debt_collected).toEqual({ cash: 50_000, transfer: 30_000 });
  });

  it('hộp & dĩa theo ca mở đơn, bỏ qua đơn xóa', () => {
    expect(r.boxes.by_orders).toBe(12);
    expect(r.plates.by_orders).toBe(2);
  });

  it('"bao bì của đơn bị xóa sau khi ra món" chỉ gồm đơn có served_at trước lúc xóa', () => {
    expect(r.deleted_count).toBe(2);
    expect(r.deleted_after_served.map((d) => d.code)).toEqual(['A24']);
  });

  it('chủ đổi tiền mặt → chuyển khoản: đối soát tính lại thay đổi đúng', () => {
    const before = run('chu-sua-truoc');
    const after = run('chu-sua-sau-tm-thanh-ck');
    expect(before.cash.diff).toBe(0);
    expect(after.cash.expected).toBe(before.cash.expected - 15_000);
    expect(after.cash.diff).toBe(15_000);
    expect(after.revenue.total).toBe(before.revenue.total);
  });

  it('đếm thiếu tiền: chênh lệch âm đúng số thiếu; thu nợ ở ca khác và đơn mở ở ca trước (thu ở ca này) tính đúng ca', () => {
    const d = run('dem-thieu-tien');
    expect(d.cash).toEqual({ expected: 500_000 + 100_000 + 31_000 + 28_000 + 50_000, counted: 689_000, diff: -20_000 });
    expect(d.boxes.by_orders).toBe(2); // đơn mở ở ca trước không tính hộp cho ca này
  });

  it('dùng hộp không có đơn: thực dùng (đầu ca + bổ sung − còn lại) lớn hơn theo đơn ⇒ chênh lệch dương', () => {
    const d = run('dung-hop-khong-don');
    // 200 + 50 − 230 = 20 hộp; theo đơn: xôi 2 + cơm mang về (1 + 2 topping thêm hộp) + cơm tại chỗ 0 + đơn mở 1 = 6
    expect(d.boxes).toEqual({ used: 20, by_orders: 6, diff: 14 });
    expect(d.plates).toEqual({ used: 1, by_orders: 1, diff: 0 });
    expect(d.deleted_after_served).toEqual([{ order_id: expect.any(String), code: 'F24', boxes: 3, plates: 0, cans: 0 }]);
  });

  it('đơn xóa có served_at sau deleted_at (dữ liệu lạ) không tính là "xóa sau khi ra món"', () => {
    const c = cases.find((x) => x.name === 'co-ban')!;
    const odd = c.input.orders.map((o) =>
      o.code === 'A24' ? { ...o, served_at: '2026-11-17T23:30:00Z' } : o,
    );
    const res = reconcileShift({ ...c.input, orders: odd, products } as ReconcileInput);
    expect(res.deleted_after_served).toEqual([]);
  });
});
