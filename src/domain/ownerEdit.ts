// Chủ sửa đơn đã thanh toán (mục 4.7): sửa món / hình thức thanh toán / khách nợ;
// đơn ship sửa thêm kiểu ship, phí ship / phụ thu, tiền trả shipper.
// Hàm thuần: màn sửa giữ bản nháp, chỉ gửi những phần đã đổi lên RPC `owner_edit_order`
// (server ghi nhật ký trước/sau, đặt owner_edited, tính lại ca đã đóng, báo Telegram).
import { SHIP_MESSAGES, shipProblem } from './orderWrite';
import { orderTotal } from './pricing';
import type { DineType, Money, OrderItem, PaymentMethod, ShipMode } from './types';

export interface PaidOrderSnapshot {
  items: OrderItem[];
  payment_method: PaymentMethod;
  customer_id: string | null;
  total: Money;
  /** Đơn ship mới sửa được kiểu / phí / tiền trả shipper. Thiếu (dữ liệu cũ) ⇒ không phải ship, shop, 0. */
  dine_type?: DineType;
  ship_mode?: ShipMode;
  ship_fee?: Money;
  ship_payout?: Money;
}

export interface OwnerEditDraft {
  items: OrderItem[];
  payment_method: PaymentMethod;
  /** Giữ lại khi tạm chuyển sang TM / CK để quay lại Ghi nợ không phải chọn lại; chỉ gửi khi Ghi nợ. */
  customer_id: string | null;
  ship_mode: ShipMode;
  ship_fee: Money;
  /** 0 = chưa chọn (shipper ngoài bắt buộc chọn). */
  ship_payout: Money;
}

/** Tham số của RPC `owner_edit_order` (ngoài `p_order`); phần không đổi là null. */
export interface OwnerEditPayload {
  p_items: OrderItem[] | null;
  p_payment_method: PaymentMethod | null;
  p_customer_id: string | null;
  p_ship_mode: ShipMode | null;
  p_ship_fee: Money | null;
  p_ship_payout: Money | null;
}

export function editDraftFrom(o: PaidOrderSnapshot): OwnerEditDraft {
  return {
    items: o.items.map((it) => ({ ...it, toppings_snap: [...it.toppings_snap] })),
    payment_method: o.payment_method,
    customer_id: o.customer_id,
    ship_mode: o.ship_mode ?? 'shop',
    ship_fee: o.ship_fee ?? 0,
    ship_payout: o.ship_payout ?? 0,
  };
}

/** Công tắc Quán ship / Shipper ngoài trên form sửa. Về Quán ship ⇒ bỏ tiền trả shipper. */
export function setEditShipMode(d: OwnerEditDraft, ship_mode: ShipMode): OwnerEditDraft {
  return { ...d, ship_mode, ship_payout: ship_mode === 'external' ? d.ship_payout : 0 };
}

/** Bấm mức phí ship / phụ thu; bấm lại ⇒ 0 (như tablet). */
export function toggleEditShipFee(d: OwnerEditDraft, fee: Money): OwnerEditDraft {
  return { ...d, ship_fee: d.ship_fee === fee ? 0 : fee };
}

/** Chọn mức trả shipper; bấm lại không bỏ (bắt buộc). */
export function setEditShipPayout(d: OwnerEditDraft, payout: Money): OwnerEditDraft {
  return { ...d, ship_payout: payout };
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
  // Cùng luật ship với tablet và server (`orderWrite.ts`): mức phí hợp lệ, shipper ngoài bắt buộc tiền trả shipper.
  const ship = original.dine_type === 'delivery' ? shipProblem({ ...d, dine_type: 'delivery' }) : null;
  if (ship) return SHIP_MESSAGES[ship];
  if (!editPayload(d, original)) return 'Chưa thay đổi gì';
  return null;
}

/** Chỉ những phần đã đổi; không đổi gì ⇒ null. */
export function editPayload(d: OwnerEditDraft, original: PaidOrderSnapshot): OwnerEditPayload | null {
  const items = itemsChanged(d.items, original.items);
  const method = d.payment_method !== original.payment_method;
  const customer = debtCustomer(d) !== debtCustomer(original);
  // Chỉ đơn ship mới gửi kiểu / phí / tiền trả shipper (server cũng bỏ với đơn không phải ship).
  const ship = original.dine_type === 'delivery';
  const mode = ship && d.ship_mode !== (original.ship_mode ?? 'shop');
  const fee = ship && d.ship_fee !== (original.ship_fee ?? 0);
  const payout = ship && d.ship_mode === 'external' && d.ship_payout !== (original.ship_payout ?? 0);
  if (!items && !method && !customer && !mode && !fee && !payout) return null;
  return {
    p_items: items ? d.items : null,
    p_payment_method: method ? d.payment_method : null,
    p_customer_id: customer ? debtCustomer(d) : null,
    p_ship_mode: mode ? d.ship_mode : null,
    p_ship_fee: fee ? d.ship_fee : null,
    p_ship_payout: payout ? d.ship_payout : null,
  };
}

export interface EditSummary {
  before: Money;
  after: Money;
  diff: Money;
}

/** Tổng mới = tiền món + phí ship / phụ thu (đã sửa hoặc giữ nguyên). Tiền trả shipper không nằm trong tổng. */
export function editSummary(
  d: Pick<OwnerEditDraft, 'items'> & Partial<Pick<OwnerEditDraft, 'ship_fee'>>,
  original: Pick<PaidOrderSnapshot, 'total' | 'ship_fee'>,
): EditSummary {
  const after = orderTotal(d.items) + (d.ship_fee ?? original.ship_fee ?? 0);
  return { before: original.total, after, diff: after - original.total };
}
