import { orderPackaging, type Packaging, type PackagingNorms } from './packaging';
import { DEFAULT_COUNT_ITEMS, type AdjustmentKind, type CountItem, type DineType, type Money, type OrderItem, type OrderStatus, type PaymentMethod } from './types';

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
  products: PackagingNorms[];
}

export interface CountLine {
  used: number | null; // null khi ca chưa đóng (chưa có số đếm)
  by_orders: number;
  diff: number | null; // used − by_orders
}

export interface ReconcileResult {
  /** Các thứ ca này đếm; thứ không đếm ⇒ `used`/`diff` (hoặc `cash.counted`/`diff`) = null, giao diện ẩn hẳn. */
  count_items: CountItem[];
  /** `ship_fee`: phần phí ship nằm trong `total` (không cộng thêm). */
  revenue: { total: Money; cash: Money; transfer: Money; debt: Money; ship_fee: Money };
  paid_orders: number;
  debt_collected: { cash: Money; transfer: Money };
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

  const expected = shift.open_float + adj('cash') + revenue.cash + debt_collected.cash;
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
    paid_orders: paidHere.length,
    debt_collected,
    cash: { expected, counted, diff: counted === null ? null : counted - expected },
    boxes: { used: usedBoxes, by_orders: pack.boxes, diff: usedBoxes === null ? null : usedBoxes - pack.boxes },
    plates: { used: usedPlates, by_orders: pack.plates, diff: usedPlates === null ? null : usedPlates - pack.plates },
    cans: { used: usedCans, by_orders: pack.cans, diff: usedCans === null ? null : usedCans - pack.cans },
    deleted_count: deleted.length,
    deleted_after_served,
    open_orders: openedHere.filter((o) => o.status === 'open' || o.status === 'served').length,
  };
}
