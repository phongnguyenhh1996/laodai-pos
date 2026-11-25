import { createContext, useContext, type ReactNode } from 'react';
import { CircleAlert, CircleCheckBig, Info, X } from 'lucide-react';
import type { Order, ShiftExpense } from '@/domain/types';
import type { Activation, Catalog, TabletShift } from '@/pos';

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
 * Bảng chọn (topping, lý do xóa, xác nhận). Điện thoại: tấm trượt từ đáy lên; tablet: hộp giữa màn hình (Makaryo).
 */
export function Sheet({
  testId,
  title,
  subtitle,
  onClose,
  children,
}: {
  testId: string;
  title: string;
  subtitle?: ReactNode;
  /** Có ⇒ hiện nút X ở góc. */
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 md:items-center md:p-4" role="dialog" aria-modal aria-label={title}>
      <div
        data-testid={testId}
        className="flex max-h-[92%] w-full flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-raised md:max-h-full md:max-w-[520px] md:gap-[18px] md:rounded-[20px] md:p-6"
      >
        <span aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-line-strong md:hidden" />
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-[22px] font-bold leading-tight">{title}</h2>
            {subtitle && <p className="text-sm text-ink-subtle">{subtitle}</p>}
          </div>
          {onClose && (
            <button type="button" className="btn btn-secondary h-11 min-h-0 w-11 min-w-0 shrink-0 px-0" onClick={onClose} aria-label="Đóng">
              <X aria-hidden className="h-5 w-5 text-ink-muted" />
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
    tone === 'error'
      ? 'border-danger-line bg-danger-soft text-danger-strong'
      : tone === 'ok'
        ? 'border-success-line bg-success-soft text-success-strong'
        : 'border-line bg-surface-sunken text-ink';
  const Icon = tone === 'error' ? CircleAlert : tone === 'ok' ? CircleCheckBig : Info;
  return (
    <p data-testid={testId} role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-lg font-medium ${cls}`}>
      <Icon aria-hidden className="mt-1 h-5 w-5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
