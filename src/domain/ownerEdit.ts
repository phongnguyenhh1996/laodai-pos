// Chủ sửa đơn đã thanh toán (mục 4.7): sửa món / hình thức thanh toán / khách nợ.
// Hàm thuần: màn sửa giữ bản nháp, chỉ gửi những phần đã đổi lên RPC `owner_edit_order`
// (server ghi nhật ký trước/sau, đặt owner_edited, tính lại ca đã đóng, báo Telegram).
import { orderTotal } from './pricing';
import type { Money, OrderItem, PaymentMethod } from './types';

export interface PaidOrderSnapshot {
  items: OrderItem[];
  payment_method: PaymentMethod;
  customer_id: string | null;
  total: Money;
}

export interface OwnerEditDraft {
  items: OrderItem[];
  payment_method: PaymentMethod;
  /** Giữ lại khi tạm chuyển sang TM / CK để quay lại Ghi nợ không phải chọn lại; chỉ gửi khi Ghi nợ. */
  customer_id: string | null;
}

/** Tham số của RPC `owner_edit_order` (ngoài `p_order`); phần không đổi là null. */
export interface OwnerEditPayload {
  p_items: OrderItem[] | null;
  p_payment_method: PaymentMethod | null;
  p_customer_id: string | null;
}

export function editDraftFrom(o: PaidOrderSnapshot): OwnerEditDraft {
  return { items: o.items.map((it) => ({ ...it, toppings_snap: [...it.toppings_snap] })), payment_method: o.payment_method, customer_id: o.customer_id };
}

export function setEditMethod(d: OwnerEditDraft, method: PaymentMethod): OwnerEditDraft {
  return { ...d, payment_method: method };
}

export function setEditCustomer(d: OwnerEditDraft, customerId: string | null): OwnerEditDraft {
  return { ...d, customer_id: customerId };
}

const lineKey = (it: OrderItem) =>
  [it.id, it.product_id, it.qty, it.unit_price_snap, ...it.toppings_snap.map((t) => `${t.id}:${t.price}`).sort()].join('|');

export function itemsChanged(a: readonly OrderItem[], b: readonly OrderItem[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((it, i) => lineKey(it) !== lineKey(b[i]));
}

/** Khách nợ thực sự gửi đi: chỉ khi Ghi nợ. */
const debtCustomer = (d: Pick<OwnerEditDraft, 'payment_method' | 'customer_id'>) => (d.payment_method === 'debt' ? d.customer_id : null);

/** Lý do chưa lưu được, hoặc null. */
export function editProblem(d: OwnerEditDraft, original: PaidOrderSnapshot): string | null {
  if (d.items.length === 0) return 'Đơn phải còn ít nhất một món';
  if (d.payment_method === 'debt' && !d.customer_id) return 'Ghi nợ cần chọn khách';
  if (!editPayload(d, original)) return 'Chưa thay đổi gì';
  return null;
}

/** Chỉ những phần đã đổi; không đổi gì ⇒ null. */
export function editPayload(d: OwnerEditDraft, original: PaidOrderSnapshot): OwnerEditPayload | null {
  const items = itemsChanged(d.items, original.items);
  const method = d.payment_method !== original.payment_method;
  const customer = debtCustomer(d) !== debtCustomer(original);
  if (!items && !method && !customer) return null;
  return {
    p_items: items ? d.items : null,
    p_payment_method: method ? d.payment_method : null,
    p_customer_id: customer ? debtCustomer(d) : null,
  };
}

export interface EditSummary {
  before: Money;
  after: Money;
  diff: Money;
}

export function editSummary(d: Pick<OwnerEditDraft, 'items'>, original: Pick<PaidOrderSnapshot, 'total'>): EditSummary {
  const after = orderTotal(d.items);
  return { before: original.total, after, diff: after - original.total };
}
