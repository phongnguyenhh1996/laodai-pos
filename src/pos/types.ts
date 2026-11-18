import type { Order, Shift } from '@/domain/types';

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
  'id' | 'tablet_profile_id' | 'staff_id' | 'opened_at' | 'open_boxes' | 'open_plates' | 'open_float'
> & { staff_name: string };

export type OpKind =
  | 'open_shift'
  | 'close_shift'
  | 'create_order'
  | 'update_order'
  | 'serve_order'
  | 'pay_order'
  | 'delete_order'
  | 'debt_payment';

/** Một thao tác gửi lên RPC `sync_push`. `op_id` là khóa idempotent: gửi lại sau khi mất phản hồi không bị ghi hai lần. */
export interface WireOp {
  op_id: string;
  kind: OpKind;
  entity_id: string;
  payload: Record<string, unknown>;
  /** Chỉ có ở thao tác cũ còn kẹt trên máy từ bản offline; thao tác mới dùng giờ server. */
  performed_at?: string;
}

export type PushResult =
  | { status: 'ok' | 'duplicate'; order?: Order; shift?: TabletShift }
  | { status: 'rejected'; reason: string };

/** Trạng thái hiện tại của hồ sơ tablet trên server. */
export interface OpenState {
  shift: TabletShift | null;
  orders: Order[];
}
