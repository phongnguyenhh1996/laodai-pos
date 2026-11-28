import { CircleCheck, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react';
import type { ConnState } from '@/pos';

/** Điện thoại (header, Figma BHP1 / BHP13): ô icon 40 bo 12; tablet (sidebar, Figma BH1): huy hiệu nhỏ bo 6 như `Badge` của kit. */
const STYLE: Record<ConnState, string> = {
  live: 'bg-[#e8f7ee] text-[#16a34a] md:text-[#15803d]',
  connecting: 'bg-[#fef5e1] text-[#d97706] md:text-[#a16207]',
  offline: 'bg-[#fdecec] text-[#dc2626] md:text-[#b91c1c]',
};

const ICON: Record<ConnState, LucideIcon> = {
  live: CircleCheck,
  connecting: RefreshCw,
  offline: WifiOff,
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
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl md:h-auto md:w-auto md:justify-start md:gap-1 md:rounded-md md:px-2 md:py-[3px] md:text-xs md:font-semibold md:leading-[15px] ${STYLE[state]}`}
    >
      <Icon aria-hidden className="h-[18px] w-[18px] shrink-0 md:h-3 md:w-3" />
      {/* Điện thoại chỉ hiện biểu tượng (màu vẫn báo trạng thái); chữ vẫn đọc được cho trình đọc màn hình. */}
      <span className="sr-only md:not-sr-only">{CONN_LABELS[state]}</span>
    </span>
  );
}
