import { createContext, useContext, type ReactNode } from 'react';
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
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal aria-label={title}>
      <div data-testid={testId} className="flex max-h-full w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Notice({ testId, tone = 'info', children }: { testId: string; tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  if (!children) return null;
  const cls = tone === 'error' ? 'bg-red-50 text-red-700' : tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-700';
  return (
    <p data-testid={testId} role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-lg ${cls}`}>
      {children}
    </p>
  );
}
