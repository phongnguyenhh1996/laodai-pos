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
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${STYLE[state]}`}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      {CONN_LABELS[state]}
    </span>
  );
}
