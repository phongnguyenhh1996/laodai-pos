// Kiểu dữ liệu nghiệp vụ dùng chung cho client, test và fixture đối soát.
// Tiền là số nguyên VND.

export type Money = number;
export type DineType = 'dinein' | 'takeaway' | 'delivery';
/** Mặc định của điểm bán chỉ là Tại chỗ / Mang về; Ship do nhân viên chọn từng đơn. */
export type PointDineType = Exclude<DineType, 'delivery'>;

export const DINE_LABELS: Record<DineType, string> = { dinein: 'Tại chỗ', takeaway: 'Mang về', delivery: 'Ship' };
export type OrderStatus = 'open' | 'served' | 'paid' | 'deleted';
export type PaymentMethod = 'cash' | 'transfer' | 'debt';
export type AdjustmentKind = 'boxes' | 'plates' | 'cans' | 'cash';
/** Những thứ nhân viên đếm khi đóng ca (bật/tắt theo quầy). */
export type CountItem = 'cash' | 'boxes' | 'plates' | 'cans';
export const COUNT_ITEMS: readonly CountItem[] = ['cash', 'boxes', 'plates', 'cans'];
/** Quầy cũ / chưa đặt: đếm tiền mặt, hộp, dĩa (chưa đếm lon). */
export const DEFAULT_COUNT_ITEMS: readonly CountItem[] = ['cash', 'boxes', 'plates'];
export type DeleteReason = 'mistake' | 'customer_left' | 'customer_changed' | 'other';

export interface Settings {
  wait_yellow_min: number;
  wait_red_min: number;
  timezone: string;
  daily_summary_time: string; // "14:30"
}

export interface Menu {
  id: string;
  name: string;
}

export interface Point {
  id: string;
  name: string;
  menu_id: string;
  active: boolean;
  /** Mặc định Tại chỗ / Mang về khi tạo đơn ở điểm này. */
  default_dine_type: PointDineType;
  sort: number;
}

export interface TabletProfile {
  id: string;
  name: string;
  point_ids: string[];
  default_boxes: number;
  default_plates: number;
  default_cans: number;
  default_float: Money;
  /** Các thứ phải đếm khi đóng ca; ca chụp lại lúc mở ⇒ đổi công tắc áp dụng từ ca sau. */
  count_items: CountItem[];
  /** Công tắc in tự động (SPEC 12.2). Thiếu (dữ liệu cũ) ⇒ coi như bật. In tay lúc nào cũng in được. */
  auto_print_kitchen?: boolean;
  auto_reprint_kitchen_on_edit?: boolean;
  auto_print_bill?: boolean;
}

export interface Staff {
  id: string;
  name: string;
  active: boolean;
  sort: number;
}

export interface Product {
  id: string;
  menu_id: string;
  name: string;
  price: Money;
  sort: number;
  active: boolean;
  boxes_takeaway: number;
  boxes_dinein: number;
  plates_dinein: number;
  /** Lon mỗi phần (nước uống), tính như nhau cho mọi loại đơn. */
  cans: number;
}

export interface Topping {
  id: string;
  menu_id: string;
  name: string;
  price: Money;
  extra_box_takeaway: boolean;
  sort: number;
  active: boolean;
}

export interface Combo {
  id: string;
  menu_id: string;
  name: string;
  product_id: string;
  topping_ids: string[];
  sort: number;
  active: boolean;
}

export interface ToppingSnap {
  id: string;
  name: string;
  price: Money;
  extra_box: boolean;
}

export interface OrderItem {
  id: string;
  product_id: string;
  name_snap: string;
  unit_price_snap: Money;
  qty: number;
  toppings_snap: ToppingSnap[];
}

/** Kiểu ship (SPEC 4.2): `shop` quán ship, `external` shipper ngoài. Không phải đơn ship ⇒ `shop`. */
export type ShipMode = 'shop' | 'external';

export const SHIP_MODE_LABELS: Record<ShipMode, string> = { shop: 'Quán ship', external: 'Shipper ngoài' };

/** Mặc định cho đơn ship mới = đơn ship gần nhất của ca (RPC `shift_ship_defaults`). */
export interface ShipDefaults {
  ship_mode: ShipMode;
  ship_fee: Money;
  ship_payout: Money;
}

export interface Order {
  id: string;
  device_seq: number;
  tablet_profile_id: string;
  point_id: string;
  code: string;
  label: string | null;
  table_no: string | null;
  dine_type: DineType;
  /** Địa chỉ giao (chỉ đơn ship, bắt buộc). */
  address: string | null;
  status: OrderStatus;
  opened_shift_id: string;
  paid_shift_id: string | null;
  created_at: string;
  served_at: string | null;
  paid_at: string | null;
  deleted_at: string | null;
  delete_reason: DeleteReason | null;
  /** Phí ship (chỉ đơn ship, 0 nếu không có), đã nằm trong `total`. */
  ship_fee: Money;
  /** Kiểu ship; không phải đơn ship ⇒ `shop`. */
  ship_mode: ShipMode;
  /** Tiền mặt lấy từ két trả shipper ngoài (chỉ `external`); KHÔNG nằm trong `total`. */
  ship_payout: Money;
  /** Tiền món + phí ship. */
  total: Money;
  payment_method: PaymentMethod | null;
  cash_given: Money | null;
  /** Khách ghi nợ, hoặc khách của đơn ship (giữ cả khi trả tiền mặt / chuyển khoản). */
  customer_id: string | null;
  owner_edited: boolean;
  items: OrderItem[];
}

export interface Shift {
  id: string;
  tablet_profile_id: string;
  staff_id: string;
  opened_at: string;
  closed_at: string | null;
  open_boxes: number;
  open_plates: number;
  open_cans: number;
  open_float: Money;
  count_items: CountItem[];
  close_boxes_left: number | null;
  close_plates_left: number | null;
  close_cans_left: number | null;
  close_cash_counted: Money | null;
  status: 'open' | 'closed';
  recalculated_at: string | null;
}

export interface ShiftAdjustment {
  id: string;
  shift_id: string;
  kind: AdjustmentKind;
  qty: number;
  note: string | null;
  at: string;
}

export interface Customer {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  /** Địa chỉ giao gần nhất (đơn ship): chọn khách ⇒ điền sẵn. */
  address: string | null;
  merged_into_id: string | null;
}

export interface DebtPayment {
  id: string;
  customer_id: string;
  amount: Money;
  method: 'cash' | 'transfer';
  shift_id: string | null;
  at: string;
}
