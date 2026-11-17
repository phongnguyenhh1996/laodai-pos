import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { LockKeyhole, Store, UserRound } from 'lucide-react';
import { localDb } from '@/lib/localdb';
import { catalogRefresher, ensureSyncStarted, syncRunner } from '@/lib/sync';
import { SyncBadge } from '@/app/SyncBadge';
import { Splash } from '@/app/ui';
import { useCatalog } from '@/app/useCatalog';
import { useLive } from '@/app/useLive';
import { currentShift } from '@/sync';
import type { Activation } from '@/sync/db';
import { CloseShiftScreen } from './CloseShiftScreen';
import { DebtScreen } from './DebtScreen';
import { OpenShiftScreen } from './OpenShiftScreen';
import { OrderScreen } from './OrderScreen';
import { PayScreen } from './PayScreen';
import { QueueScreen } from './QueueScreen';
import { TabletContext, type TabletCtx } from './parts';

/**
 * Màn bán hàng của tablet (mục 7): chưa có ca ⇒ chọn tên + Mở ca; có ca ⇒ hàng đợi, đơn, thanh toán, đóng ca.
 * Mọi thao tác ghi IndexedDB + outbox trước (src/sync/localOps), bộ đồng bộ đẩy lên server sau.
 */
export function TabletHome({ activation }: { activation: Activation }) {
  const catalog = useCatalog(localDb);
  const shift = useLive(() => currentShift(localDb), []);
  const [lastPointId, setLastPointId] = useState<string | null>(null);

  // Đồng bộ chạy suốt vòng đời app từ lúc vào màn bán hàng (kể cả khi chuyển sang chế độ chủ): không dừng khi rời màn.
  // Mỗi lần quay lại màn bán hàng (vd. vừa thoát chế độ chủ) thì làm mới danh mục ngay.
  useEffect(() => {
    ensureSyncStarted();
    void catalogRefresher.refresh();
  }, []);

  const ctx = useMemo<TabletCtx | null>(
    () =>
      catalog.status === 'ready' && shift.status === 'ready'
        ? { activation, catalog: catalog.catalog, shift: shift.value, lastPointId, setLastPointId }
        : null,
    [activation, catalog, shift, lastPointId],
  );

  return (
    <div data-testid="tablet-home" className="flex h-full flex-col bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-3 shadow-xs md:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-strong text-white">
            <Store className="h-6 w-6" />
          </span>
          <h1 className="truncate text-xl font-bold" data-testid="tablet-name">
            {activation.tablet_name}
          </h1>
          {ctx?.shift && (
            <span className="badge gap-1.5 bg-surface-sunken py-1 text-base text-ink-muted" data-testid="shift-staff">
              <UserRound aria-hidden className="h-4 w-4" />
              Ca của {ctx.shift.staff_name}
            </span>
          )}
          <SyncBadge runner={syncRunner} />
        </div>
        <Link to="/owner" className="btn btn-secondary shrink-0" data-testid="open-owner-mode">
          <LockKeyhole aria-hidden className="h-5 w-5" />
          Chế độ chủ
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        {!ctx ? (
          <Splash />
        ) : (
          <TabletContext.Provider value={ctx}>
            <TabletRoutes hasShift={!!ctx.shift} />
          </TabletContext.Provider>
        )}
      </div>
    </div>
  );
}

function TabletRoutes({ hasShift }: { hasShift: boolean }) {
  const needShift = (el: JSX.Element) => (hasShift ? el : <Navigate to="/" replace />);
  return (
    <Routes>
      <Route path="/" element={hasShift ? <QueueScreen /> : <OpenShiftScreen />} />
      <Route path="/order/new" element={needShift(<OrderScreen />)} />
      <Route path="/order/:orderId" element={needShift(<OrderScreen />)} />
      <Route path="/order/:orderId/pay" element={needShift(<PayScreen />)} />
      <Route path="/debt" element={needShift(<DebtScreen />)} />
      {/* Đóng ca tự xử lý lúc không còn ca (ngay sau khi đóng: chỉ hiện "Đã đóng ca"). */}
      <Route path="/shift/close" element={<CloseShiftScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
