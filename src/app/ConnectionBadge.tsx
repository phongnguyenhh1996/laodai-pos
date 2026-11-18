import { CircleCheck, CloudOff, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ConnState } from '@/pos';

const STYLE: Record<ConnState, string> = {
  live: 'bg-success-soft text-success-strong border-success-line',
  connecting: 'bg-warning-soft text-warning-strong border-warning-line',
  offline: 'bg-danger-soft text-danger-strong border-danger-line',
};

const ICON: Record<ConnState, LucideIcon> = {
  live: CircleCheck,
  connecting: RefreshCw,
  offline: CloudOff,
};

export const CONN_LABELS: Record<ConnState, string> = {
  live: 'Đã kết nối',
  connecting: 'Đang kết nối…',
  offline: 'Mất kết nối',
};

/** Chỉ báo kết nối máy chủ (mục 7). Mất kết nối ⇒ thao tác không lưu được. */
export function ConnectionBadge({ state }: { state: ConnState }) {
  const Icon = ICON[state];
  return (
    <span
      data-testid="conn-status"
      data-state={state}
      role="status"
      title={CONN_LABELS[state]}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-sm font-semibold md:px-3 ${STYLE[state]}`}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      {/* Điện thoại chỉ hiện biểu tượng (màu vẫn báo trạng thái); chữ vẫn đọc được cho trình đọc màn hình. */}
      <span className="sr-only md:not-sr-only">{CONN_LABELS[state]}</span>
    </span>
  );
}
