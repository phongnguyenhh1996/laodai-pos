// Dựng op đồng bộ đúng hình dạng tablet gửi (`WireOp` ở src/pos/types.ts) để test RPC sync_push.
import type { SupabaseClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';
import type { CreateOrderFields, OrderCustomerPayload, RejectReason, UpdateOrderPayload } from '@/domain/orderWrite';
// Đường dẫn tương đối: ts-node của Cypress (nạp cypress.config.ts) không hiểu alias `@/` cho import chạy thật.
import { orderTotal } from '../../src/domain/pricing';
import type { DeleteReason, Order, OrderItem, OrderStatus, PaymentMethod, ShiftExpense } from '@/domain/types';
import type { CloseKey, DebtCustomerPayload, OpKind, OpPayloads, PushResult, TabletShift, WireOp, WireOpOf } from '@/pos/types';
import { SEED } from './seed-ids';

/** Op thô: chỉ cho test cố tình gửi payload sai / thiếu / kiểu cũ. Op đúng hình dạng dùng `wire()`. */
export interface RawOp {
  op_id: string;
  kind: string;
  entity_id: string;
  performed_at?: string;
  payload: Record<string, unknown>;
}

let clock = Date.now() - 60 * 60_000;
export const tick = (ms = 1000) => new Date((clock += ms)).toISOString();

/**
 * Op có kiểu theo `kind`. `performed_at` mặc định theo đồng hồ giả (đi dần từ một giờ trước) để thứ tự
 * nhật ký ổn định; tablet bây giờ không gửi trường này (server dùng giờ server).
 */
export function wire<K extends OpKind>(kind: K, entity_id: string, payload: OpPayloads[K], performed_at = tick()): WireOpOf<K> {
  return { op_id: uuidv7(), kind, entity_id, performed_at, payload };
}

/** Op thô, payload không kiểm kiểu. Dùng khi test cố tình gửi dữ liệu sai: ghi chú lý do tại chỗ gọi. */
export function op(kind: string, entity_id: string, payload: Record<string, unknown>, performed_at = tick()): RawOp {
  return { op_id: uuidv7(), kind, entity_id, performed_at, payload };
}

/** `PushResult` gộp phẳng để test đọc `order` / `reason` không cần thu hẹp kiểu. */
export type PushReply = {
  status: PushResult['status'];
  reason?: RejectReason;
  order?: Order;
  shift?: TabletShift;
  expense?: ShiftExpense;
};

export async function push(c: SupabaseClient, o: WireOp | RawOp) {
  const { data, error } = await c.rpc('sync_push', { op: o });
  if (error) throw error;
  return data as PushReply;
}

export const item = (
  product: keyof typeof SEED.products,
  toppings: Array<keyof typeof SEED.toppings> = [],
  qty = 1,
  id = uuidv7(),
): OrderItem => ({
  id,
  product_id: SEED.products[product],
  name_snap: product,
  unit_price_snap: SEED.prices[product],
  qty,
  toppings_snap: toppings.map((t) => ({ id: SEED.toppings[t], name: t, price: SEED.prices[t], extra_box: false })),
});

/** Khách nợ có sẵn khi trả tiền ghi nợ. */
export const debtCustomer = (id: string, name: string): DebtCustomerPayload => ({ id, is_new: false, name, description: null, phone: null });

/** Trường đơn thêm vào khi tạo / sửa: phần đơn của payload + khách. Thiếu `total` ⇒ món + phí ship. */
export type OrderExtra = Partial<Omit<CreateOrderFields, 'id' | 'opened_shift_id'>> & { customer?: OrderCustomerPayload | null };

/** Bộ thao tác của một tablet với ca hiện tại. Mã đơn + số thứ tự do server cấp. */
export class TabletSim {
  shiftId: string | null = null;
  constructor(public c: SupabaseClient, public profileId: string) {}

  get pointId() {
    return this.profileId === SEED.tablets.B ? SEED.points.xoiB : SEED.points.xoiA;
  }

  /** Ca đang mở; test gọi sau `openShift`. */
  get shift() {
    if (!this.shiftId) throw new Error('TabletSim: chưa mở ca');
    return this.shiftId;
  }

  async openShift(staff: keyof typeof SEED.staff = 'Lan') {
    const id = uuidv7();
    const r = await push(this.c, wire('open_shift', id, { shift_id: id, staff_id: SEED.staff[staff] }));
    if (r.status === 'ok') this.shiftId = id;
    return r;
  }

  private fields(items: OrderItem[], extra: Omit<OrderExtra, 'customer'>) {
    const base = { point_id: this.pointId, label: null, table_no: null, dine_type: 'takeaway', address: null,
      ship_fee: 0, ship_mode: 'shop', ship_payout: 0, ...extra } as const;
    return { ...base, total: extra.total ?? orderTotal(items) + base.ship_fee };
  }

  createOrderOp(items: OrderItem[], { customer = null, ...extra }: OrderExtra = {}) {
    const id = uuidv7();
    const order: CreateOrderFields = { id, opened_shift_id: this.shift, ...this.fields(items, extra) };
    return { id, total: order.total, op: wire('create_order', id, { order, customer, items }) };
  }

  async createOrder(items: OrderItem[], extra: OrderExtra = {}) {
    const o = this.createOrderOp(items, extra);
    return { ...o, result: await push(this.c, o.op) };
  }

  serve(orderId: string) {
    return push(this.c, wire('serve_order', orderId, { order_id: orderId }));
  }

  pay(orderId: string, total: number, method: PaymentMethod = 'cash', extra: Partial<OpPayloads['pay_order']> = {}) {
    return push(this.c, wire('pay_order', orderId, {
      order_id: orderId, paid_shift_id: this.shift, method,
      cash_given: method === 'cash' ? total : null, total, customer: null, ...extra,
    }));
  }

  del(orderId: string, reason: DeleteReason = 'customer_left', status_before: OrderStatus = 'open') {
    return push(this.c, wire('delete_order', orderId, { order_id: orderId, reason, status_before }));
  }

  update(orderId: string, items: OrderItem[], { customer = null, ...extra }: OrderExtra = {}) {
    const payload: UpdateOrderPayload = { order_id: orderId, customer, items, ...this.fields(items, extra) };
    return push(this.c, wire('update_order', orderId, payload));
  }

  closeShift(boxes_left: number, plates_left: number, cash_counted: number, extra: Partial<Record<CloseKey, number>> = {}) {
    const id = this.shift;
    return push(this.c, wire('close_shift', id, { shift_id: id, boxes_left, plates_left, cash_counted, ...extra }));
  }

  createExpense(amount: number | null, note: string, id = uuidv7(), shift_id = this.shift) {
    return push(this.c, wire('create_expense', id, { id, shift_id, amount, note }));
  }

  voidExpense(expense_id: string) {
    return push(this.c, wire('void_expense', expense_id, { expense_id }));
  }

  debtPayment(customer_id: string, amount: number, method: 'cash' | 'transfer' = 'cash') {
    const id = uuidv7();
    return push(this.c, wire('debt_payment', id, { id, customer_id, amount, method, shift_id: this.shift }));
  }
}
