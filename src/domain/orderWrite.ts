import { orderTotal } from './pricing';
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
  | 'bad_qty'
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

// ---------------------------------------------------------------- luật ghi đơn (như SQL)

/** Phí ship tối đa, tiền trả shipper tối thiểu / tối đa (bội 1.000) — `private.order_ship_fee` / `order_ship_payout`. */
export const SHIP_FEE_MAX: Money = 50_000;
export const SHIP_PAYOUT_MIN: Money = 1_000;
export const SHIP_PAYOUT_MAX: Money = 50_000;
/** Độ dài tối đa server giữ (`left(...)` trong `op_create_order` / `op_update_order` / `order_customer`). */
export const MAX_LEN = { label: 40, table_no: 10, address: 200, customer_name: 60, customer_description: 80, customer_phone: 20 } as const;

const DINE_TYPES: readonly DineType[] = ['dinein', 'takeaway', 'delivery'];
const SHIP_MODES: readonly ShipMode[] = ['shop', 'external'];

/** Câu báo lỗi luật ship: dùng chung cho tablet (`pos/ops.ts`) và form chủ sửa đơn (`ownerEdit.ts`). */
export const SHIP_MESSAGES = {
  bad_ship_fee: 'Phí ship không hợp lệ',
  bad_ship_mode: 'Kiểu ship không hợp lệ',
  bad_ship_payout: 'Chưa chọn tiền trả shipper',
} as const satisfies Partial<Record<RejectReason, string>>;
export type ShipReason = keyof typeof SHIP_MESSAGES;

/** `trim`, rỗng ⇒ null, rồi cắt như `left(nullif(trim(x), ''), n)`. */
function clip(v: string | null | undefined, n: number): string | null {
  return v?.trim().slice(0, n) || null;
}

const isThousands = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max && v % 1000 === 0;

export interface ShipInput {
  dine_type: DineType;
  ship_mode?: ShipMode | null;
  ship_fee?: Money | null;
  ship_payout?: Money | null;
}

export interface ShipFields {
  ship_mode: ShipMode;
  ship_fee: Money;
  ship_payout: Money;
}

/**
 * Kiểu / phí / tiền trả shipper server sẽ lưu (chưa kiểm): không phải đơn ship ⇒ shop / 0 / 0;
 * thiếu / rỗng kiểu ⇒ quán ship; quán ship ⇒ bỏ tiền trả shipper.
 */
export function shipFields(s: ShipInput): ShipFields {
  if (s.dine_type !== 'delivery') return { ship_mode: 'shop', ship_fee: 0, ship_payout: 0 };
  const ship_mode = s.ship_mode || 'shop'; // rỗng như thiếu (`nullif(..., '')`)
  return { ship_mode, ship_fee: s.ship_fee ?? 0, ship_payout: ship_mode === 'external' ? s.ship_payout ?? 0 : 0 };
}

/**
 * Lý do server từ chối phần ship, hoặc null. Phí 0–50.000, shipper ngoài bắt buộc trả 1.000–50.000, bội 1.000.
 * Phí gửi lên phải là số nguyên ≥ 0 cả khi không phải đơn ship (`as_int` của `order_ship_fee` chạy trước khi bỏ phí).
 */
export function shipProblem(s: ShipInput): ShipReason | null {
  const rawFee = s.ship_fee ?? 0;
  if (!Number.isInteger(rawFee) || rawFee < 0) return 'bad_ship_fee';
  const f = shipFields(s);
  if (!isThousands(f.ship_fee, 0, SHIP_FEE_MAX)) return 'bad_ship_fee';
  if (!SHIP_MODES.includes(f.ship_mode)) return 'bad_ship_mode';
  if (f.ship_mode === 'external' && !isThousands(f.ship_payout, SHIP_PAYOUT_MIN, SHIP_PAYOUT_MAX)) return 'bad_ship_payout';
  return null;
}

/** Địa chỉ server sẽ lưu (chưa kiểm): chỉ đơn ship. */
export function orderAddress(dine_type: DineType, address: string | null | undefined): string | null {
  return dine_type === 'delivery' ? clip(address, MAX_LEN.address) : null;
}

/** Khách gửi lên: id có sẵn, hoặc khách mới (`is_new`) kèm tên / mô tả / số điện thoại chưa chuẩn hóa. */
export interface OrderCustomerInput {
  id: string;
  is_new?: boolean;
  name?: string | null;
  description?: string | null;
  phone?: string | null;
}

/** Đầu vào tạo / sửa đơn (nháp của màn đơn, hoặc payload đã gửi). Trường ngoài đơn ship bị bỏ khi chuẩn hóa. */
export interface OrderWriteInput extends ShipInput {
  point_id: string;
  label?: string | null;
  table_no?: string | null;
  address?: string | null;
  customer?: OrderCustomerInput | null;
  items: readonly OrderItem[];
}

/** Đơn đã chuẩn hóa: đúng những gì server lưu. */
export interface OrderWriteFields extends ShipFields {
  point_id: string;
  dine_type: DineType;
  label: string | null;
  table_no: string | null;
  address: string | null;
  customer: OrderCustomerPayload | null;
  items: OrderItem[];
  /** Tiền món + phí ship (tiền trả shipper không nằm trong tổng). */
  total: Money;
}

export type OrderWriteResult = { ok: true; order: OrderWriteFields } | { ok: false; reason: RejectReason };

/**
 * Chuẩn hóa + kiểm một lần tạo / sửa đơn theo đúng thứ tự `op_create_order` / `op_update_order`
 * (phần không cần dữ liệu server: không kiểm điểm bán, giá, món ngừng bán, ca).
 * Không ném: lỗi trả `{ ok: false, reason }`.
 */
export function normalizeOrderWrite(input: OrderWriteInput): OrderWriteResult {
  const fail = (reason: RejectReason): OrderWriteResult => ({ ok: false, reason });
  const { dine_type } = input;
  if (!DINE_TYPES.includes(dine_type)) return fail('bad_dine_type');
  const address = orderAddress(dine_type, input.address);
  if (dine_type === 'delivery' && !address) return fail('address_required');
  const ship = shipProblem(input);
  if (ship) return fail(ship);

  let customer: OrderCustomerPayload | null = null;
  const c = input.customer;
  if (address && c) {
    if (!c.is_new) customer = { id: c.id };
    else {
      const name = clip(c.name, MAX_LEN.customer_name);
      if (!name) return fail('customer_required');
      customer = {
        id: c.id,
        is_new: true,
        name,
        description: clip(c.description, MAX_LEN.customer_description),
        phone: clip(c.phone, MAX_LEN.customer_phone),
      };
    }
  }

  if (input.items.length === 0) return fail('empty_items');
  if (input.items.some((it) => !Number.isInteger(it.qty) || it.qty < 1)) return fail('bad_qty');

  const fields = shipFields(input);
  const items = [...input.items];
  return {
    ok: true,
    order: {
      point_id: input.point_id,
      dine_type,
      label: clip(input.label, MAX_LEN.label),
      table_no: clip(input.table_no, MAX_LEN.table_no),
      address,
      customer,
      ...fields,
      items,
      total: orderTotal(items) + fields.ship_fee,
    },
  };
}

/** Payload `create_order` từ đơn đã chuẩn hóa. */
export function createOrderPayload(o: OrderWriteFields, ids: { id: string; opened_shift_id: string }): CreateOrderPayload {
  const { customer, items, ...rest } = o;
  return { order: { id: ids.id, ...rest, opened_shift_id: ids.opened_shift_id }, customer, items };
}

/** Payload `update_order` từ đơn đã chuẩn hóa. */
export function updateOrderPayload(order_id: string, o: OrderWriteFields): UpdateOrderPayload {
  return { order_id, ...o };
}
