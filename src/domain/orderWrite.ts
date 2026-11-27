import type { DineType, Money, OrderItem, ShipMode } from './types';

/**
 * Hợp đồng ghi đơn: payload `create_order` / `update_order` gửi lên `sync_push` và các lý do server từ chối.
 * Client (`pos/ops.ts`), bản giả (`test-utils/fakeServer.ts`) và SQL cùng theo một hình dạng.
 */

/** Khách đơn ship trong payload: khách có sẵn chỉ cần id; khách mới (`is_new`) server tạo cùng lúc lưu đơn. */
export type OrderCustomerPayload =
  | { id: string; is_new?: false }
  | { id: string; is_new: true; name: string; description: string | null; phone: string | null };

/** Phần đơn của `create_order` (như `private.op_create_order`). Server cấp mã đơn + số thứ tự. */
export type CreateOrderFields = {
  id: string;
  point_id: string;
  label: string | null;
  table_no: string | null;
  dine_type: DineType;
  address: string | null;
  opened_shift_id: string;
  ship_fee: Money;
  ship_mode: ShipMode;
  ship_payout: Money;
  /** Tổng món + phí ship; server tính lại, lệch ⇒ `total_mismatch`. */
  total: Money;
};

export type CreateOrderPayload = {
  order: CreateOrderFields;
  customer: OrderCustomerPayload | null;
  items: OrderItem[];
};

/** `update_order` gửi lại toàn bộ đơn (không phải phần thay đổi). */
export type UpdateOrderPayload = {
  order_id: string;
  point_id: string;
  dine_type: DineType;
  address: string | null;
  customer: OrderCustomerPayload | null;
  label: string | null;
  table_no: string | null;
  items: OrderItem[];
  ship_fee: Money;
  ship_mode: ShipMode;
  ship_payout: Money;
  total: Money;
};

/**
 * Mã `sync_push` trả khi không ghi thao tác (`private.reject` trong migrations).
 * `bad_<trường>`: trường không đọc được (`private.as_uuid` / `as_int` / `as_ts`, vd. `bad_cash_counted`).
 * `unknown`: phản hồi không có lý do (chỉ từ `parsePushResult`).
 * Danh mục kèm test so với migrations: ứng viên 6 của docs/plans/cai-thien-kien-truc.md.
 */
export type RejectReason =
  // ca
  | 'shift_already_open'
  | 'shift_exists'
  | 'shift_not_open'
  | 'bad_shift'
  | 'bad_staff'
  // đơn
  | 'order_exists'
  | 'order_not_found'
  | 'order_not_open'
  | 'order_codes_exhausted'
  | 'already_served'
  | 'empty_items'
  | 'duplicate_item'
  | 'item_id_conflict'
  | 'bad_item'
  | 'bad_product'
  | 'bad_topping'
  | 'bad_toppings'
  | 'bad_dine_type'
  | 'bad_code'
  | 'bad_reason'
  | 'device_seq_exists'
  | 'price_mismatch'
  | 'total_mismatch'
  | 'product_inactive'
  | 'topping_inactive'
  | 'point_not_allowed'
  | 'point_inactive'
  | 'address_required'
  | 'customer_required'
  | 'bad_customer'
  | 'bad_ship_fee'
  | 'bad_ship_mode'
  | 'bad_ship_payout'
  // thanh toán / thu nợ
  | 'bad_method'
  | 'cash_short'
  | 'payment_exists'
  // hết món
  | 'bad_item_kind'
  | 'bad_sold_out'
  // khoản chi
  | 'bad_expense_amount'
  | 'bad_expense_note'
  | 'expense_exists'
  | 'expense_not_voidable'
  // chung
  | 'performed_at_in_future'
  | 'unknown_kind'
  | 'unknown'
  | `bad_${string}`;

/**
 * Lý do đọc từ phản hồi server. Server mới hơn có thể trả mã chưa có trong danh mục:
 * vẫn giữ nguyên chuỗi (`rejectMessage` có câu dự phòng), không đổi thành `unknown`.
 */
export function parseRejectReason(v: unknown): RejectReason {
  return typeof v === 'string' && v !== '' ? (v as RejectReason) : 'unknown';
}
