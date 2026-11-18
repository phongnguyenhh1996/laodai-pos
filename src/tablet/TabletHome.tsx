import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { CloudOff, LockKeyhole, RefreshCw, Store, UserRound } from 'lucide-react';
import { startTablet, tabletStore } from '@/lib/pos';
import { ConnectionBadge } from '@/app/ConnectionBadge';
import { Splash } from '@/app/ui';
import type { Activation } from '@/pos';
import { CloseShiftScreen } from './CloseShiftScreen';
import { DebtScreen } from './DebtScreen';
import { OpenShiftScreen } from './OpenShiftScreen';
import { OrderScreen } from './OrderScreen';
import { PayScreen } from './PayScreen';
import { QueueScreen } from './QueueScreen';
import { TabletContext, type TabletCtx } from './parts';

/**
 * Màn bán hàng của tablet (mục 7): chưa có ca ⇒ chọn tên + Mở ca; có ca ⇒ hàng đợi, đơn, thanh toán, đóng ca.
 * Dữ liệu lấy thẳng từ server và cập nhật realtime (src/pos): mọi máy dùng chung hồ sơ tablet thấy cùng ca, cùng hàng đợi.
 * Mọi thao tác ghi thẳng lên server; mất kết nối thì không lưu được (báo rõ trên màn hình).
 */
export function TabletHome({ activation }: { activation: Activation }) {
  const snap = useSyncExternalStore(tabletStore.subscribe, tabletStore.getSnapshot);
  const [lastPointId, setLastPointId] = useState<string | null>(null);

  // Chạy suốt vòng đời app từ lúc vào màn bán hàng (kể cả khi chuyển sang chế độ chủ): không dừng khi rời màn.
  // Mỗi lần quay lại màn bán hàng (vd. vừa thoát chế độ chủ) thì tải lại ngay.
  useEffect(() => {
    startTablet(activation.tablet_profile_id);
    void tabletStore.refresh();
  }, [activation.tablet_profile_id]);

  const ctx = useMemo<TabletCtx | null>(
    () =>
      snap.open
        ? { activation, catalog: snap.catalog, shift: snap.open.shift, orders: snap.open.orders, lastPointId, setLastPointId }
        : null,
    [activation, snap.catalog, snap.open, lastPointId],
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
          <ConnectionBadge state={snap.conn} />
        </div>
        <Link to="/owner" className="btn btn-secondary shrink-0" data-testid="open-owner-mode">
          <LockKeyhole aria-hidden className="h-5 w-5" />
          Chế độ chủ
        </Link>
      </header>
      {ctx && snap.conn === 'offline' && (
        <p data-testid="offline-banner" role="alert" className="flex items-center gap-3 border-b border-danger-line bg-danger-soft px-4 py-2 text-base font-medium text-danger-strong md:px-6">
          <CloudOff aria-hidden className="h-5 w-5 shrink-0" />
          Mất kết nối máy chủ: đơn, thanh toán, đóng ca… sẽ không lưu được cho tới khi có mạng.
        </p>
      )}
      <div className="min-h-0 flex-1">
        {!ctx ? (
          snap.error ? <LoadError /> : <Splash />
        ) : (
          <TabletContext.Provider value={ctx}>
            <TabletRoutes hasShift={!!ctx.shift} />
          </TabletContext.Provider>
        )}
      </div>
    </div>
  );
}

/** Chưa tải được ca / đơn lần nào (máy mất mạng lúc mở app). */
function LoadError() {
  return (
    <main data-testid="load-error" className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-soft text-danger">
        <CloudOff className="h-9 w-9" />
      </span>
      <p className="max-w-md text-2xl font-semibold">Không kết nối được máy chủ. Cần có mạng để bán hàng.</p>
      <button type="button" className="btn btn-secondary min-w-[200px]" onClick={() => void tabletStore.refresh()} data-testid="load-retry">
        <RefreshCw aria-hidden className="h-5 w-5" />
        Thử lại
      </button>
    </main>
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
