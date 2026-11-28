import { createContext, useContext, type MutableRefObject, type ReactNode } from 'react';
import { CircleAlert, CircleCheckBig, Info, X } from 'lucide-react';
import type { Order, ShiftExpense } from '@/domain/types';
import type { Activation, Catalog, TabletShift } from '@/pos';
import { SheetHandle, iconBtn } from '@/app/kit';

/** Dữ liệu chung của màn bán hàng (lấy từ server, cập nhật realtime): máy, danh mục, ca đang mở, đơn đang mở. */
export interface TabletCtx {
  activation: Activation;
  catalog: Catalog | undefined;
  shift: TabletShift | null;
  /** Đơn đang mở của hồ sơ tablet (chung cho mọi máy dùng hồ sơ này). */
  orders: Order[];
  /** Khoản chi của ca đang mở (cả khoản chủ ghi / đã hủy). */
  expenses: ShiftExpense[];
  /** Điểm bán của đơn gần nhất: đơn mới mở đúng tab đang bán (vd. trưa bán cơm gà). */
  lastPointId: string | null;
  setLastPointId(id: string): void;
}

export const TabletContext = createContext<TabletCtx | null>(null);

export function useTablet(): TabletCtx {
  const c = useContext(TabletContext);
  if (!c) throw new Error('useTablet() phải nằm trong TabletContext');
  return c;
}

/**
 * Rời đơn đang sửa trong giỏ (mục 4.2): gọi `go` khi được rời (đã tự lưu, đã bấm "Bỏ thay đổi", hoặc không có gì để giữ).
 * Màn Bán hàng đặt hàm này; menu (sidebar / ☰) gọi trước khi sang màn khác.
 */
export type LeaveGuard = (go: () => void) => void;

export const LeaveGuardContext = createContext<MutableRefObject<LeaveGuard | null> | null>(null);

/** Hàm rời đơn đang sửa (không có màn Bán hàng ⇒ đi luôn). */
export function useLeave(): LeaveGuard {
  const ref = useContext(LeaveGuardContext);
  return (go) => (ref?.current ? ref.current(go) : go());
}

/** Bề rộng hộp trên tablet: `sm` 420 (Bỏ thay đổi?, BH13), `md` 440 (Xóa đơn, BH14); mặc định 520 cho bảng chưa có khung (topping, chi tiền…). */
const SHEET_WIDTH = { sm: 'md:max-w-[420px]', md: 'md:max-w-[440px]', lg: 'md:max-w-[520px]' } as const;

/**
 * Bảng chọn (topping, lý do xóa, xác nhận). Figma BH13 / BH14 / BHP11.
 * Điện thoại: sheet trồi từ đáy, bo trên 24, tay nắm, bóng lên. Tablet: hộp giữa màn bo 20, đổ bóng, nền tối 45%.
 * `icon`: ô icon 44 cạnh tiêu đề (Xóa đơn: thùng rác đỏ), khi đó dòng phụ nhỏ xám 13.
 */
export function Sheet({
  testId,
  title,
  subtitle,
  icon,
  size = 'lg',
  onClose,
  children,
}: {
  testId: string;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  size?: keyof typeof SHEET_WIDTH;
  /** Có ⇒ hiện nút X ở góc. */
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 md:items-center md:p-4" role="dialog" aria-modal aria-label={title}>
      <div
        data-testid={testId}
        className={`flex max-h-[92%] w-full flex-col gap-3.5 overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-6px_24px_rgba(0,0,0,0.08)] md:max-h-full md:gap-4 md:rounded-[20px] md:p-6 md:shadow-[0_12px_32px_rgba(0,0,0,0.16)] ${SHEET_WIDTH[size]}`}
      >
        <SheetHandle className="md:hidden" />
        <div className="flex items-start gap-3">
          {icon}
          <div className={`flex min-w-0 flex-1 flex-col ${icon ? 'gap-0.5' : 'gap-1.5'}`}>
            <h2 className="text-xl font-bold leading-[25px] text-[#111]">{title}</h2>
            {subtitle && <p className={icon ? 'text-[13px] leading-4 text-[#888]' : 'text-sm leading-5 text-[#6d6d6d]'}>{subtitle}</p>}
          </div>
          {onClose && (
            <button type="button" className={iconBtn()} onClick={onClose} aria-label="Đóng">
              <X aria-hidden className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Notice({ testId, tone = 'info', children }: { testId: string; tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  if (!children) return null;
  const cls =
    tone === 'error' ? 'border-danger-line bg-danger-soft text-danger-strong' : tone === 'ok' ? 'border-success-line bg-success-soft text-success-strong' : 'border-line bg-surface-sunken text-ink';
  const Icon = tone === 'error' ? CircleAlert : tone === 'ok' ? CircleCheckBig : Info;
  return (
    <p data-testid={testId} role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-lg font-medium ${cls}`}>
      <Icon aria-hidden className="mt-1 h-5 w-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
