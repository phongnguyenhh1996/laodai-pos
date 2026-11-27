import type { CreateOrderPayload, RejectReason, UpdateOrderPayload } from '@/domain/orderWrite';
import type { DeleteReason, Money, Order, OrderStatus, PaymentMethod, Shift, ShiftExpense } from '@/domain/types';

/** Máy đã kích hoạt cho hồ sơ tablet nào (lưu trên máy, kèm phiên vai trò `tablet` của supabase-js). */
export interface Activation {
  tablet_profile_id: string;
  tablet_name: string;
  activated_at: string;
  /** Email chủ đã kích hoạt máy: chế độ chủ trên tablet chỉ cần nhập lại mật khẩu. */
  owner_email: string;
}

/** Ca đang mở của hồ sơ tablet (trên server: chung cho mọi máy dùng hồ sơ này). */
export type TabletShift = Pick<
  Shift,
  'id' | 'tablet_profile_id' | 'staff_id' | 'opened_at' | 'open_boxes' | 'open_plates' | 'open_cans' | 'open_float' | 'count_items'
> & { staff_name: string };

/** Payload theo từng `kind` của `sync_push` (khớp `private.op_*` trong migrations). */
export type OpPayloads = {
  open_shift: { shift_id: string; staff_id: string };
  /** Chỉ gửi (và server chỉ đòi) số của các thứ ca này đếm (`shift.count_items`). */
  close_shift: { shift_id: string } & Partial<Record<CloseKey, number>>;
  create_order: CreateOrderPayload;
  update_order: UpdateOrderPayload;
  serve_order: { order_id: string };
  delete_order: { order_id: string; reason: DeleteReason; status_before: OrderStatus };
  pay_order: {
    order_id: string;
    paid_shift_id: string;
    method: PaymentMethod;
    cash_given: Money | null;
    total: Money;
    /** Chỉ khi ghi nợ: khách có sẵn (`is_new: false`) hoặc khách mới. */
    customer: DebtCustomerPayload | null;
  };
  debt_payment: { id: string; customer_id: string; amount: Money; method: 'cash' | 'transfer'; shift_id: string };
  set_sold_out: { point_id: string; item_kind: 'product' | 'topping'; item_id: string; sold_out: boolean; shift_id: string };
  /** `amount` null ⇒ server từ chối `bad_expense_amount` (máy đã kiểm trước). */
  create_expense: { id: string; shift_id: string; amount: Money | null; note: string };
  void_expense: { expense_id: string };
};

export type OpKind = keyof OpPayloads;

/** Khóa số gửi lên khi đóng ca. */
export type CloseKey = 'cash_counted' | 'boxes_left' | 'plates_left' | 'cans_left';

export type DebtCustomerPayload = { id: string; is_new: boolean; name: string; description: string | null; phone: string | null };

/** Thao tác một `kind` cụ thể. */
export type WireOpOf<K extends OpKind> = {
  op_id: string;
  kind: K;
  entity_id: string;
  payload: OpPayloads[K];
  /** Chỉ có ở thao tác cũ còn kẹt trên máy từ bản offline; thao tác mới dùng giờ server. */
  performed_at?: string;
};

/**
 * Một thao tác gửi lên RPC `sync_push`, phân biệt theo `kind`. `op_id` là khóa idempotent:
 * gửi lại sau khi mất phản hồi không bị ghi hai lần.
 */
export type WireOp = { [K in OpKind]: WireOpOf<K> }[OpKind];

export type PushResult =
  | { status: 'ok' | 'duplicate'; order?: Order; shift?: TabletShift; expense?: ShiftExpense }
  | { status: 'rejected'; reason: RejectReason };

/** Trạng thái hiện tại của hồ sơ tablet trên server. */
export interface OpenState {
  shift: TabletShift | null;
  orders: Order[];
  /** Khoản chi của ca đang mở (cả khoản chủ ghi, cả khoản đã hủy), theo giờ ghi. Thiếu ⇒ chưa có. */
  expenses?: ShiftExpense[];
}
