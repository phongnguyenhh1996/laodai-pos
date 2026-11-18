import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { CloudOff, LockKeyhole, RefreshCw, Store, UserRound } from 'lucide-react';
import { startTablet, tabletStore } from '@/lib/pos';
import { ConnectionBadge } from '@/app/ConnectionBadge';
import { APP_VERSION } from '@/app/version';
import { useTabletName } from '@/app/useActivation';
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
  const tabletName = useTabletName(activation);

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
      {/* Điện thoại: gọn một dòng (chỉ báo kết nối, nút chế độ chủ chỉ còn biểu tượng) để dành chỗ cho thực đơn / hàng đợi. */}
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2 shadow-xs md:gap-x-4 md:gap-y-2 md:px-6 md:py-3">
        <div className="flex min-w-0 items-center gap-2 md:flex-wrap md:gap-x-3 md:gap-y-2">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-strong text-white md:h-11 md:w-11">
            <Store className="h-5 w-5 md:h-6 md:w-6" />
          </span>
          <h1 className="min-w-0 truncate text-lg font-bold md:text-xl" data-testid="tablet-name">
            {tabletName}
          </h1>
          {ctx?.shift && (
            <span className="badge min-w-0 shrink gap-1.5 truncate bg-surface-sunken py-1 text-sm text-ink-muted md:text-base" data-testid="shift-staff">
              <UserRound aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">Ca của {ctx.shift.staff_name}</span>
            </span>
          )}
          <ConnectionBadge state={snap.conn} />
          <span className="hidden text-xs text-ink-subtle md:inline" data-testid="app-version" title="Phiên bản app">
            v{APP_VERSION}
          </span>
        </div>
        <Link to="/owner" className="btn btn-secondary shrink-0 px-3 md:px-4" data-testid="open-owner-mode" aria-label="Chế độ chủ">
          <LockKeyhole aria-hidden className="h-5 w-5" />
          <span className="hidden md:inline">Chế độ chủ</span>
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
