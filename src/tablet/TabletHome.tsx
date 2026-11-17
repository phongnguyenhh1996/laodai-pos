import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { localDb } from '@/lib/localdb';
import { catalogRefresher, ensureSyncStarted, syncRunner } from '@/lib/sync';
import { SyncBadge } from '@/app/SyncBadge';
import { Splash } from '@/app/ui';
import { useCatalog } from '@/app/useCatalog';
import { useLive } from '@/app/useLive';
import { currentShift } from '@/sync';
import type { Activation } from '@/sync/db';
import { CloseShiftScreen } from './CloseShiftScreen';
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
    <div data-testid="tablet-home" className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="tablet-name">
            {activation.tablet_name}
          </h1>
          {ctx?.shift && (
            <span className="text-lg text-stone-600" data-testid="shift-staff">
              · Ca của {ctx.shift.staff_name}
            </span>
          )}
          <SyncBadge runner={syncRunner} />
        </div>
        <Link to="/owner" className="btn flex items-center border border-stone-300 bg-white" data-testid="open-owner-mode">
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
      {/* Đóng ca tự xử lý lúc không còn ca (ngay sau khi đóng: chỉ hiện "Đã đóng ca"). */}
      <Route path="/shift/close" element={<CloseShiftScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
