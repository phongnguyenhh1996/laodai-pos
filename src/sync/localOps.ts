import { v7 as uuidv7 } from 'uuid';
import { canConfirmCash } from '@/domain/cash';
import { generateOrderCode, type Rng } from '@/domain/orderCode';
import { assertQty, orderTotal } from '@/domain/pricing';
import { businessDate } from '@/domain/time';
import type { DeleteReason, DineType, Money, Order, OrderItem, TabletProfile } from '@/domain/types';
import { META, getMeta, type Activation, type LaodaiDB, type LocalShift } from './db';
import { nextDeviceSeq } from './deviceSeq';
import { enqueue } from './outbox';

/**
 * Thao tác của tablet. Mỗi hàm ghi dữ liệu local và outbox trong CÙNG một transaction:
 * hoặc cả hai, hoặc không gì cả.
 */

export class LocalOpError extends Error {}

type Clock = () => Date;
const systemClock: Clock = () => new Date();

const OPEN_STATUSES = new Set(['open', 'served']);

async function requireActivation(db: LaodaiDB): Promise<Activation> {
  const a = await getMeta<Activation>(db, META.activation);
  if (!a) throw new LocalOpError('Tablet chưa được kích hoạt');
  return a;
}

async function requireShift(db: LaodaiDB): Promise<LocalShift> {
  const s = await getMeta<LocalShift>(db, META.shift);
  if (!s) throw new LocalOpError('Chưa mở ca');
  return s;
}

async function requireOpenOrder(db: LaodaiDB, orderId: string): Promise<Order> {
  const o = await db.orders.get(orderId);
  if (!o || !OPEN_STATUSES.has(o.status)) throw new LocalOpError('Đơn không còn mở');
  return o;
}

function validateItems(items: OrderItem[]): void {
  if (items.length === 0) throw new LocalOpError('Đơn chưa có món');
  for (const it of items) assertQty(it.qty);
}

// ---------- Ca ----------

export async function openShift(
  db: LaodaiDB,
  input: { staff_id: string; staff_name: string; profile: TabletProfile },
  clock: Clock = systemClock,
): Promise<LocalShift> {
  return db.transaction('rw', db.meta, db.outbox, async () => {
    await requireActivation(db);
    if (await getMeta<LocalShift>(db, META.shift)) throw new LocalOpError('Tablet đang có ca mở');
    const shift: LocalShift = {
      id: uuidv7(),
      tablet_profile_id: input.profile.id,
      staff_id: input.staff_id,
      staff_name: input.staff_name,
      opened_at: clock().toISOString(),
      open_boxes: input.profile.default_boxes,
      open_plates: input.profile.default_plates,
      open_float: input.profile.default_float,
    };
    await db.meta.put({ key: META.shift, value: shift });
    await enqueue(db, 'open_shift', shift.id, { shift_id: shift.id, staff_id: shift.staff_id, opened_at: shift.opened_at }, shift.opened_at);
    return shift;
  });
}

/** Đếm mù: chỉ ghi số nhân viên đếm. Không trả về số kỳ vọng / chênh lệch. */
export async function closeShift(
  db: LaodaiDB,
  input: { boxes_left: number; plates_left: number; cash_counted: Money },
  clock: Clock = systemClock,
): Promise<void> {
  for (const [k, v] of Object.entries(input)) {
    if (!Number.isInteger(v) || v < 0) throw new LocalOpError(`Số không hợp lệ: ${k}`);
  }
  await db.transaction('rw', db.meta, db.outbox, async () => {
    const shift = await requireShift(db);
    const closed_at = clock().toISOString();
    await enqueue(db, 'close_shift', shift.id, { shift_id: shift.id, closed_at, ...input }, closed_at);
    await db.meta.delete(META.shift);
  });
}

// ---------- Đơn ----------

export interface OrderDraft {
  point_id: string;
  dine_type: DineType;
  label?: string | null;
  table_no?: string | null;
  items: OrderItem[];
}

export async function createOrder(
  db: LaodaiDB,
  draft: OrderDraft,
  clock: Clock = systemClock,
  rng?: Rng,
): Promise<Order> {
  validateItems(draft.items);
  return db.transaction('rw', db.meta, db.outbox, db.orders, db.usedCodes, async () => {
    const act = await requireActivation(db);
    const shift = await requireShift(db);
    const created_at = clock().toISOString();
    const date = businessDate(created_at);
    const used = new Set((await db.usedCodes.where('date').equals(date).toArray()).map((u) => u.code));
    const code = generateOrderCode(used, rng);
    await db.usedCodes.put({ date, code });

    const order: Order = {
      id: uuidv7(),
      device_seq: await nextDeviceSeq(db),
      tablet_profile_id: act.tablet_profile_id,
      point_id: draft.point_id,
      code,
      label: draft.label?.trim() || null,
      table_no: draft.table_no?.trim() || null,
      dine_type: draft.dine_type,
      status: 'open',
      opened_shift_id: shift.id,
      paid_shift_id: null,
      created_at,
      served_at: null,
      paid_at: null,
      deleted_at: null,
      delete_reason: null,
      total: orderTotal(draft.items),
      payment_method: null,
      cash_given: null,
      customer_id: null,
      owner_edited: false,
      items: draft.items,
    };
    await db.orders.add(order);
    const { items, ...head } = order;
    await enqueue(db, 'create_order', order.id, { order: head, items }, created_at);
    return order;
  });
}

export async function updateOrder(
  db: LaodaiDB,
  orderId: string,
  changes: Partial<Pick<OrderDraft, 'point_id' | 'dine_type' | 'label' | 'table_no' | 'items'>>,
  clock: Clock = systemClock,
): Promise<Order> {
  if (changes.items) validateItems(changes.items);
  return db.transaction('rw', db.meta, db.outbox, db.orders, async () => {
    await requireShift(db);
    const before = await requireOpenOrder(db, orderId);
    const after: Order = {
      ...before,
      ...changes,
      label: changes.label !== undefined ? changes.label?.trim() || null : before.label,
      table_no: changes.table_no !== undefined ? changes.table_no?.trim() || null : before.table_no,
    };
    after.total = orderTotal(after.items);
    await db.orders.put(after);
    const at = clock().toISOString();
    await enqueue(
      db,
      'update_order',
      orderId,
      {
        order_id: orderId,
        point_id: after.point_id,
        dine_type: after.dine_type,
        label: after.label,
        table_no: after.table_no,
        items: after.items,
        total: after.total,
      },
      at,
    );
    return after;
  });
}

export async function serveOrder(db: LaodaiDB, orderId: string, clock: Clock = systemClock): Promise<Order> {
  return db.transaction('rw', db.meta, db.outbox, db.orders, async () => {
    await requireShift(db);
    const o = await requireOpenOrder(db, orderId);
    if (o.status !== 'open') throw new LocalOpError('Đơn đã ra món');
    const served_at = clock().toISOString();
    const after: Order = { ...o, status: 'served', served_at };
    await db.orders.put(after);
    await enqueue(db, 'serve_order', orderId, { order_id: orderId, served_at }, served_at);
    return after;
  });
}

export async function deleteOrder(
  db: LaodaiDB,
  orderId: string,
  reason: DeleteReason,
  clock: Clock = systemClock,
): Promise<void> {
  await db.transaction('rw', db.meta, db.outbox, db.orders, async () => {
    await requireShift(db);
    const o = await requireOpenOrder(db, orderId);
    const deleted_at = clock().toISOString();
    await db.orders.put({ ...o, status: 'deleted', deleted_at, delete_reason: reason });
    await enqueue(db, 'delete_order', orderId, { order_id: orderId, reason, deleted_at, status_before: o.status }, deleted_at);
  });
}

export type PaymentInput =
  | { method: 'cash'; cash_given: Money }
  | { method: 'transfer' }
  | {
      method: 'debt';
      customer: { id?: string; name: string; description?: string | null; phone?: string | null };
    };

/** Thanh toán: tiền tính vào ca đang mở lúc thu. Sau đó đơn biến mất khỏi hàng đợi. */
export async function payOrder(
  db: LaodaiDB,
  orderId: string,
  payment: PaymentInput,
  clock: Clock = systemClock,
): Promise<void> {
  await db.transaction('rw', db.meta, db.outbox, db.orders, async () => {
    const shift = await requireShift(db);
    const o = await requireOpenOrder(db, orderId);
    const paid_at = clock().toISOString();
    let cash_given: Money | null = null;
    let customer: Record<string, unknown> | null = null;

    if (payment.method === 'cash') {
      if (!canConfirmCash(o.total, payment.cash_given)) throw new LocalOpError('Khách đưa chưa đủ tiền');
      cash_given = payment.cash_given;
    } else if (payment.method === 'debt') {
      const name = payment.customer.name.trim();
      if (!name) throw new LocalOpError('Cần tên khách ghi nợ');
      customer = {
        id: payment.customer.id ?? uuidv7(),
        is_new: !payment.customer.id,
        name,
        description: payment.customer.description?.trim() || null,
        phone: payment.customer.phone?.trim() || null,
      };
    }

    await db.orders.put({
      ...o,
      status: 'paid',
      paid_at,
      paid_shift_id: shift.id,
      payment_method: payment.method,
      cash_given,
      customer_id: (customer?.id as string | undefined) ?? null,
    });
    await enqueue(
      db,
      'pay_order',
      orderId,
      { order_id: orderId, paid_shift_id: shift.id, paid_at, method: payment.method, cash_given, total: o.total, customer },
      paid_at,
    );
  });
}

// ---------- Thu nợ ----------

export async function recordDebtPayment(
  db: LaodaiDB,
  input: { customer_id: string; amount: Money; method: 'cash' | 'transfer' },
  clock: Clock = systemClock,
): Promise<string> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new LocalOpError('Số tiền không hợp lệ');
  return db.transaction('rw', db.meta, db.outbox, async () => {
    const shift = await requireShift(db);
    const id = uuidv7();
    const at = clock().toISOString();
    await enqueue(db, 'debt_payment', id, { id, ...input, shift_id: shift.id, at }, at);
    return id;
  });
}

// ---------- Đọc ----------

/** Đơn hiển thị trên tablet: chỉ đơn đang mở. Đơn paid/deleted nằm ẩn chờ sync. */
export async function visibleOrders(db: LaodaiDB): Promise<Order[]> {
  return db.orders.where('status').anyOf('open', 'served').toArray();
}

/**
 * Một đơn đang mở theo id (màn sửa đơn / thanh toán). Đơn đã thanh toán / đã xóa (còn nằm chờ sync)
 * trả `undefined` như không tồn tại: không có màn nào xem lại được đơn đã thanh toán.
 */
export async function getOpenOrder(db: LaodaiDB, orderId: string): Promise<Order | undefined> {
  const o = await db.orders.get(orderId);
  return o && OPEN_STATUSES.has(o.status) ? o : undefined;
}

/** Ca đang mở trên tablet (null nếu chưa mở ca). */
export async function currentShift(db: LaodaiDB): Promise<LocalShift | null> {
  return (await getMeta<LocalShift>(db, META.shift)) ?? null;
}
