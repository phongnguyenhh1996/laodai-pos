// Nhật ký (audit_log): nhãn, nhóm lọc và mô tả trước/sau cho màn Nhật ký và chi tiết đơn của chủ.
import { itemsSummary } from './cart';
import { formatVnd } from './money';
import { DAY_MARK_LABELS, PAYROLL_KIND_LABELS, formatDate, monthLabel, type DayMarkKind, type PayrollKind } from './payroll';
import { DINE_LABELS, type DeleteReason, type DineType, type OrderItem, type OrderStatus, type PaymentMethod } from './types';

const dineLabel = (t: DineType | undefined) => (t ? (DINE_LABELS[t] ?? t) : '—');

export interface AuditEntry {
  id: string;
  at: string;
  synced_at: string;
  actor_kind: 'staff' | 'owner' | 'system';
  staff_id: string | null;
  tablet_profile_id: string | null;
  shift_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
}

export const ACTION_LABELS: Record<string, string> = {
  tablet_login: 'Tablet đăng nhập',
  owner_mode: 'Vào chế độ chủ trên tablet',
  owner_pin_set: 'Cài mã PIN chế độ chủ',
  owner_pin_removed: 'Xóa mã PIN chế độ chủ',
  owner_pin_locked: 'Mã PIN chế độ chủ bị xóa (sai quá nhiều lần)',
  shift_open: 'Mở ca',
  shift_close: 'Đóng ca',
  shift_adjust: 'Chủ bổ sung giữa ca',
  order_create: 'Tạo đơn',
  order_update: 'Sửa đơn',
  order_serve: 'Ra món',
  order_pay: 'Thanh toán',
  order_delete: 'Xóa đơn',
  owner_edit_order: 'Chủ sửa đơn đã thanh toán',
  customer_create: 'Tạo khách nợ',
  debt_payment: 'Thu nợ',
  debt_transfer: 'Chuyển nợ',
  seq_gap: 'Thiếu số đơn (device_seq)',
  sync_rejected: 'Thao tác bị server từ chối',
  settings_create: 'Thêm cài đặt',
  settings_update: 'Sửa cài đặt',
  payroll_add: 'Ghi sổ lương',
  payroll_void: 'Hủy dòng sổ lương',
  day_off_add: 'Đánh ngày nghỉ',
  day_off_update: 'Sửa lý do nghỉ',
  day_off_remove: 'Bỏ ngày nghỉ',
  day_work_add: 'Đánh ngày có làm',
  day_work_update: 'Sửa ngày có làm',
  day_work_remove: 'Bỏ ngày có làm',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Bộ lọc "loại" trên màn Nhật ký: nhóm vài action hay xem cùng nhau, hoặc một action đơn lẻ. */
export const ACTION_GROUPS: Array<{ id: string; label: string; actions: string[] }> = [
  { id: 'orders', label: 'Đơn (tạo / sửa / ra món / thu / xóa)', actions: ['order_create', 'order_update', 'order_serve', 'order_pay', 'order_delete'] },
  { id: 'edits', label: 'Sửa & xóa đơn', actions: ['order_update', 'order_delete', 'owner_edit_order'] },
  { id: 'shifts', label: 'Ca', actions: ['shift_open', 'shift_close', 'shift_adjust'] },
  { id: 'debts', label: 'Nợ', actions: ['customer_create', 'debt_payment', 'debt_transfer'] },
  { id: 'owner', label: 'Chủ', actions: ['owner_mode', 'owner_pin_set', 'owner_pin_removed', 'owner_edit_order', 'shift_adjust', 'settings_create', 'settings_update', 'payroll_add', 'payroll_void', 'day_off_add', 'day_off_update', 'day_off_remove', 'day_work_add', 'day_work_update', 'day_work_remove'] },
  { id: 'alerts', label: 'Cảnh báo (thiếu số đơn, bị từ chối, đăng nhập)', actions: ['seq_gap', 'sync_rejected', 'tablet_login', 'owner_pin_locked'] },
];

/** Giá trị bộ lọc "loại" (id nhóm hoặc tên action, như link trong tin Telegram) → danh sách action. */
export function actionsForFilter(filter: string | null | undefined): string[] | null {
  if (!filter) return null;
  const g = ACTION_GROUPS.find((x) => x.id === filter);
  return g ? g.actions : [filter];
}

const STATUS: Record<OrderStatus, string> = { open: 'chờ ra món', served: 'đã ra món', paid: 'đã thanh toán', deleted: 'đã xóa' };
const METHOD: Record<PaymentMethod, string> = { cash: 'tiền mặt', transfer: 'chuyển khoản', debt: 'ghi nợ' };
export const DELETE_REASON_LABELS: Record<DeleteReason, string> = {
  mistake: 'Bấm nhầm',
  customer_left: 'Khách bỏ về',
  customer_changed: 'Khách đổi ý',
  other: 'Khác',
};

type OrderSnap = {
  code?: string;
  status?: OrderStatus;
  total?: number;
  dine_type?: DineType;
  address?: string | null;
  label?: string | null;
  payment_method?: PaymentMethod | null;
  items?: Array<Pick<OrderItem, 'qty' | 'name_snap' | 'toppings_snap'>>;
};

const isOrderAction = (a: string) => a.startsWith('order_') || a === 'owner_edit_order' || a === 'debt_transfer';

/** Các dòng mô tả thay đổi trước → sau (chỉ những gì đổi), để chủ chất vấn. */
export function describeAudit(e: Pick<AuditEntry, 'action' | 'before' | 'after' | 'reason' | 'entity'>, names: { customer?: (id: string) => string } = {}): string[] {
  const b = (e.before ?? null) as OrderSnap | null;
  const a = (e.after ?? null) as OrderSnap | null;
  const lines: string[] = [];

  if (isOrderAction(e.action)) {
    const ref = a ?? b;
    if (e.action === 'order_create' && a) {
      lines.push(`${itemsSummary(a.items ?? [])} · ${formatVnd(a.total ?? 0)}`);
      return lines;
    }
    const itemsB = itemsSummary(b?.items ?? []);
    const itemsA = itemsSummary(a?.items ?? []);
    if (b && a && itemsB !== itemsA) lines.push(`Món: ${itemsB} → ${itemsA}`);
    if (b && a && b.total !== a.total) lines.push(`Tổng: ${formatVnd(b.total ?? 0)} → ${formatVnd(a.total ?? 0)}`);
    if (b && a && b.status !== a.status && a.status) lines.push(`Trạng thái: ${STATUS[b.status!] ?? b.status} → ${STATUS[a.status]}`);
    if (b && a && (b.payment_method ?? null) !== (a.payment_method ?? null) && a.payment_method) {
      lines.push(`Hình thức: ${b.payment_method ? METHOD[b.payment_method] : '—'} → ${METHOD[a.payment_method]}`);
    }
    if (b && a && b.dine_type !== a.dine_type) lines.push(`${dineLabel(b.dine_type)} → ${dineLabel(a.dine_type)}`);
    if (b && a && (b.address ?? null) !== (a.address ?? null)) lines.push(`Địa chỉ: ${b.address ?? '—'} → ${a.address ?? '—'}`);
    if (b && a && (b.label ?? null) !== (a.label ?? null)) lines.push(`Nhãn: ${b.label ?? '—'} → ${a.label ?? '—'}`);
    const cb = (e.before as { customer_id?: string } | null)?.customer_id;
    const ca = (e.after as { customer_id?: string } | null)?.customer_id;
    if (b && a && cb !== ca && ca) lines.push(`Khách nợ: ${cb ? (names.customer?.(cb) ?? cb) : '—'} → ${names.customer?.(ca) ?? ca}`);
    if (e.action === 'order_delete') {
      lines.unshift(`Lý do: ${DELETE_REASON_LABELS[e.reason as DeleteReason] ?? e.reason ?? '—'} · lúc xóa ${b?.status === 'served' ? '⚠️ ĐÃ RA MÓN' : 'chưa ra món'}`);
      if (b) lines.push(`${itemsSummary(b.items ?? [])} · ${formatVnd(b.total ?? 0)}`);
    }
    if (lines.length === 0 && ref) lines.push(`${itemsSummary(ref.items ?? [])} · ${formatVnd(ref.total ?? 0)}`);
    return lines;
  }

  const after = (e.after ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case 'shift_close':
      // Nhật ký chỉ ghi số nhân viên đếm; đối soát xem ở báo cáo ca.
      lines.push(`Đếm: hộp ${after.close_boxes_left} · dĩa ${after.close_plates_left} · tiền ${formatVnd(Number(after.close_cash_counted ?? 0))}`);
      break;
    case 'shift_open':
      lines.push(`Đầu ca: hộp ${after.open_boxes} · dĩa ${after.open_plates} · tiền lẻ ${formatVnd(Number(after.open_float ?? 0))}`);
      break;
    case 'shift_adjust':
      lines.push(`+${after.kind === 'cash' ? formatVnd(Number(after.qty)) : after.qty} ${after.kind === 'boxes' ? 'hộp' : after.kind === 'plates' ? 'dĩa' : 'tiền lẻ'}${after.note ? ` · ${after.note}` : ''}`);
      break;
    case 'debt_payment':
      lines.push(`${formatVnd(Number(after.amount ?? 0))} · ${after.method === 'cash' ? 'tiền mặt' : 'chuyển khoản'}`);
      break;
    case 'customer_create':
      lines.push([after.name, after.description, after.phone].filter(Boolean).join(' · '));
      break;
    case 'seq_gap':
      lines.push(`Thiếu số ${(after.missing as number[] | undefined)?.join(', ')} (nhận được số ${after.received})`);
      break;
    case 'sync_rejected':
      lines.push(`${e.entity}: ${e.reason}`);
      break;
    case 'payroll_add':
    case 'payroll_void': {
      const kind = after.kind as PayrollKind;
      const amount = Number(after.amount);
      const value = kind === 'days' ? `${amount > 0 ? '+' : ''}${amount} ngày` : formatVnd(amount);
      const month = String(after.month ?? '').slice(0, 7);
      lines.push(`${after.staff_name ?? ''} · ${monthLabel(month)}: ${PAYROLL_KIND_LABELS[kind] ?? kind} ${value}${after.note ? ` (${after.note})` : ''}`);
      break;
    }
    case 'day_off_add':
    case 'day_off_update':
    case 'day_off_remove':
    case 'day_work_add':
    case 'day_work_update':
    case 'day_work_remove': {
      const prev = (e.before ?? {}) as Record<string, unknown>;
      const label = (k: unknown) => DAY_MARK_LABELS[(k ?? 'off') as DayMarkKind] ?? String(k);
      const parts: string[] = [];
      if (e.action.endsWith('_update')) {
        if ((prev.kind ?? 'off') !== (after.kind ?? 'off')) parts.push(`${label(prev.kind)} → ${label(after.kind)}`);
        if ((prev.reason ?? null) !== (after.reason ?? null)) parts.push(`${prev.reason ?? '—'} → ${after.reason ?? '—'}`);
      } else if (after.reason) parts.push(String(after.reason));
      lines.push(`${after.staff_name ?? ''} · ${after.day ? formatDate(String(after.day)) : ''}${parts.length ? ` (${parts.join(', ')})` : ''}`);
      break;
    }
    case 'settings_create':
    case 'settings_update': {
      const before = (e.before ?? {}) as Record<string, unknown>;
      const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]) && k !== 'updated_at');
      lines.push(`${e.entity}${after.name ? ` "${after.name}"` : ''}${e.action === 'settings_update' ? `: ${changed.map((k) => `${k} ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`).join(', ')}` : ''}`);
      break;
    }
  }
  return lines;
}
