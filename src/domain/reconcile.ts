import { activeExpenseTotal } from './expenses';
import { orderPackaging, type Packaging, type PackagingNorms } from './packaging';
import { DEFAULT_COUNT_ITEMS, type AdjustmentKind, type CountItem, type DineType, type Money, type OrderItem, type OrderStatus, type PaymentMethod, type ShipMode } from './types';

/**
 * Đối soát cuối ca. Công thức này phải cho cùng kết quả với hàm SQL `reconcile_shift`
 * (xem tests/fixtures/reconcile-cases.json, dùng chung cho test TS và test SQL).
 */

export interface ReconcileShift {
  id: string;
  open_boxes: number;
  open_plates: number;
  /** Thiếu (dữ liệu cũ) ⇒ 0 / null / mặc định. */
  open_cans?: number;
  open_float: Money;
  count_items?: CountItem[];
  close_boxes_left: number | null;
  close_plates_left: number | null;
  close_cans_left?: number | null;
  close_cash_counted: Money | null;
}

export interface ReconcileOrder {
  id: string;
  code: string;
  status: OrderStatus;
  dine_type: DineType;
  opened_shift_id: string;
  paid_shift_id: string | null;
  payment_method: PaymentMethod | null;
  /** Phí ship (đã nằm trong `total`); không có ⇒ 0. */
  ship_fee?: Money;
  /** Kiểu ship; không có ⇒ `shop`. */
  ship_mode?: ShipMode;
  /** Tiền trả shipper ngoài (không nằm trong `total`); không có ⇒ 0. */
  ship_payout?: Money;
  total: Money;
  served_at: string | null;
  deleted_at: string | null;
  items: Array<Pick<OrderItem, 'product_id' | 'qty' | 'toppings_snap'>>;
}

export interface ReconcileInput {
  shift: ReconcileShift;
  adjustments: Array<{ shift_id: string; kind: AdjustmentKind; qty: number }>;
  orders: ReconcileOrder[];
  debt_payments: Array<{ shift_id: string | null; amount: Money; method: 'cash' | 'transfer' }>;
  /** Khoản chi (tiền mặt từ két); thiếu (dữ liệu cũ) ⇒ không có. */
  expenses?: Array<{ shift_id: string; amount: Money; voided_at: string | null }>;
  products: PackagingNorms[];
}

export interface CountLine {
  used: number | null; // null khi ca chưa đóng (chưa có số đếm)
  by_orders: number;
  diff: number | null; // used − by_orders
}

/** Thống kê ship (chỉ chủ): đơn ship đã thu trong ca / kỳ. */
export interface ShipStats {
  shop_orders: number;
  external_orders: number;
  /** Σ phí ship của đơn quán ship. */
  shop_fee: Money;
  /** Σ phụ thu của đơn shipper ngoài. */
  external_fee: Money;
  /** Σ tiền trả shipper ngoài (tiền mặt lấy từ két). */
  payout: Money;
  /** Lãi/lỗ ship ngoài = phụ thu ship ngoài − trả shipper ngoài. */
  external_profit: Money;
}

export const EMPTY_SHIP_STATS: ShipStats = { shop_orders: 0, external_orders: 0, shop_fee: 0, external_fee: 0, payout: 0, external_profit: 0 };

/** Cùng công thức với `private.ship_stats` (SQL). */
export function shipStats(orders: ReadonlyArray<Pick<ReconcileOrder, 'dine_type' | 'ship_mode' | 'ship_fee' | 'ship_payout'>>): ShipStats {
  const ship = orders.filter((o) => o.dine_type === 'delivery');
  const shop = ship.filter((o) => (o.ship_mode ?? 'shop') === 'shop');
  const ext = ship.filter((o) => o.ship_mode === 'external');
  const sum = (xs: typeof ship, f: (o: (typeof ship)[number]) => number) => xs.reduce((s, o) => s + f(o), 0);
  const external_fee = sum(ext, (o) => o.ship_fee ?? 0);
  const payout = sum(ship, (o) => o.ship_payout ?? 0);
  return {
    shop_orders: shop.length,
    external_orders: ext.length,
    shop_fee: sum(shop, (o) => o.ship_fee ?? 0),
    external_fee,
    payout,
    external_profit: external_fee - sum(ext, (o) => o.ship_payout ?? 0),
  };
}

export interface ReconcileResult {
  /** Các thứ ca này đếm; thứ không đếm ⇒ `used`/`diff` (hoặc `cash.counted`/`diff`) = null, giao diện ẩn hẳn. */
  count_items: CountItem[];
  /** `ship_fee`: phần phí ship nằm trong `total` (không cộng thêm). */
  revenue: { total: Money; cash: Money; transfer: Money; debt: Money; ship_fee: Money };
  ship: ShipStats;
  paid_orders: number;
  debt_collected: { cash: Money; transfer: Money };
  /** Khoản chi chưa hủy của ca: số khoản + tổng (đã trừ vào `cash.expected`). */
  expenses: { count: number; total: Money };
  cash: { expected: Money; counted: Money | null; diff: Money | null };
  boxes: CountLine;
  plates: CountLine;
  cans: CountLine;
  deleted_count: number;
  deleted_after_served: Array<{ order_id: string; code: string; boxes: number; plates: number; cans: number }>;
  open_orders: number;
}

export function reconcileShift(input: ReconcileInput): ReconcileResult {
  const { shift } = input;
  const norms = new Map(input.products.map((p) => [p.id, p]));
  const adj = (kind: AdjustmentKind) =>
    input.adjustments.filter((a) => a.shift_id === shift.id && a.kind === kind).reduce((s, a) => s + a.qty, 0);

  // Tiền: theo ca THU tiền
  const paidHere = input.orders.filter((o) => o.status === 'paid' && o.paid_shift_id === shift.id);
  const sumBy = (m: PaymentMethod) => paidHere.filter((o) => o.payment_method === m).reduce((s, o) => s + o.total, 0);
  const revenue = {
    total: 0,
    cash: sumBy('cash'),
    transfer: sumBy('transfer'),
    debt: sumBy('debt'),
    ship_fee: paidHere.reduce((s, o) => s + (o.ship_fee ?? 0), 0),
  };
  revenue.total = revenue.cash + revenue.transfer + revenue.debt;

  const debtHere = input.debt_payments.filter((p) => p.shift_id === shift.id);
  const debt_collected = {
    cash: debtHere.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0),
    transfer: debtHere.filter((p) => p.method === 'transfer').reduce((s, p) => s + p.amount, 0),
  };

  // Trả shipper ngoài luôn là tiền mặt lấy từ két, kể cả khách CK / Nợ (đơn đã thu trong ca này).
  const ship = shipStats(paidHere);
  const payout = paidHere.reduce((s, o) => s + (o.ship_payout ?? 0), 0);
  const expenseRows = (input.expenses ?? []).filter((e) => e.shift_id === shift.id && e.voided_at === null);
  const expenses = { count: expenseRows.length, total: activeExpenseTotal(expenseRows) };
  const expected = shift.open_float + adj('cash') + revenue.cash + debt_collected.cash - payout - expenses.total;
  const counted = shift.close_cash_counted;

  // Bao bì: theo ca MỞ đơn, bỏ đơn đã xóa
  const openedHere = input.orders.filter((o) => o.opened_shift_id === shift.id);
  const pack = openedHere
    .filter((o) => o.status !== 'deleted')
    .reduce<Packaging>(
      (acc, o) => {
        const p = orderPackaging(o, norms);
        return { boxes: acc.boxes + p.boxes, plates: acc.plates + p.plates, cans: acc.cans + p.cans };
      },
      { boxes: 0, plates: 0, cans: 0 },
    );

  const usedBoxes = shift.close_boxes_left === null ? null : shift.open_boxes + adj('boxes') - shift.close_boxes_left;
  const usedPlates =
    shift.close_plates_left === null ? null : shift.open_plates + adj('plates') - shift.close_plates_left;
  const cansLeft = shift.close_cans_left ?? null;
  const usedCans = cansLeft === null ? null : (shift.open_cans ?? 0) + adj('cans') - cansLeft;

  const deleted = openedHere.filter((o) => o.status === 'deleted');
  const deleted_after_served = deleted
    .filter((o) => o.served_at !== null && o.deleted_at !== null && Date.parse(o.served_at) < Date.parse(o.deleted_at))
    .sort((a, b) => Date.parse(a.deleted_at!) - Date.parse(b.deleted_at!))
    .map((o) => ({ order_id: o.id, code: o.code, ...orderPackaging(o, norms) }));

  return {
    count_items: [...(shift.count_items ?? DEFAULT_COUNT_ITEMS)],
    revenue,
    ship,
    paid_orders: paidHere.length,
    debt_collected,
    expenses,
    cash: { expected, counted, diff: counted === null ? null : counted - expected },
    boxes: { used: usedBoxes, by_orders: pack.boxes, diff: usedBoxes === null ? null : usedBoxes - pack.boxes },
    plates: { used: usedPlates, by_orders: pack.plates, diff: usedPlates === null ? null : usedPlates - pack.plates },
    cans: { used: usedCans, by_orders: pack.cans, diff: usedCans === null ? null : usedCans - pack.cans },
    deleted_count: deleted.length,
    deleted_after_served,
    open_orders: openedHere.filter((o) => o.status === 'open' || o.status === 'served').length,
  };
}
