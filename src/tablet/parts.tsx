import { createContext, useContext, type ReactNode } from 'react';
import { CircleAlert, CircleCheckBig, Info } from 'lucide-react';
import type { Catalog } from '@/sync';
import type { Activation, LocalShift } from '@/sync/db';

/** Dữ liệu chung của màn bán hàng: máy, danh mục trên máy, ca đang mở. */
export interface TabletCtx {
  activation: Activation;
  catalog: Catalog | undefined;
  shift: LocalShift | null;
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

/** Bảng chọn nổi ở giữa màn hình (topping, lý do xóa, xác nhận). */
export function Sheet({ testId, title, children }: { testId: string; title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-[2px]" role="dialog" aria-modal aria-label={title}>
      <div data-testid={testId} className="flex max-h-full w-full max-w-xl flex-col gap-5 overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-raised">
        <h2 className="text-2xl font-bold">{title}</h2>
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
