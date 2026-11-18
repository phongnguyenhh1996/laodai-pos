import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CloudOff, HandCoins, KeyRound, ListOrdered, Plus, Power, RefreshCw, Store, UserRound, type LucideIcon } from 'lucide-react';
import { startTablet, tabletStore } from '@/lib/pos';
import { ConnectionBadge } from '@/app/ConnectionBadge';
import { APP_VERSION } from '@/app/version';
import { useTabletName } from '@/app/useActivation';
import { Splash } from '@/app/ui';
import { hhmm } from '@/domain/time';
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
 *
 * Khung theo Figma "Makaryo":
 * - Tablet (md+): sidebar trắng bên trái (tên quầy, ca đang mở, menu Hàng đợi / Đơn mới / Thu nợ / Đóng ca, chế độ chủ, kết nối).
 *   Màn gọi món / thanh toán chiếm trọn màn hình (không sidebar).
 * - Điện thoại: chỉ màn hàng đợi có header một dòng + thanh đáy (Thu nợ · Đóng ca · Đơn mới); màn khác tự có header riêng.
 * Mỗi phần tử có data-testid chỉ có một bản trong DOM, đổi vị trí theo cỡ màn bằng CSS.
 */
export function TabletHome({ activation }: { activation: Activation }) {
  const snap = useSyncExternalStore(tabletStore.subscribe, tabletStore.getSnapshot);
  const [lastPointId, setLastPointId] = useState<string | null>(null);
  const tabletName = useTabletName(activation);
  const { pathname } = useLocation();

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

  const onQueue = pathname === '/';
  /** Gọi món / thanh toán: toàn màn hình, không sidebar. */
  const fullScreen = pathname.startsWith('/order');
  const shift = ctx?.shift ?? null;

  return (
    <div data-testid="tablet-home" className="flex h-full flex-col bg-canvas md:flex-row">
      <aside
        className={`${onQueue || !ctx ? 'flex' : 'hidden'} ${fullScreen ? 'md:hidden' : 'md:flex'} shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 md:w-60 md:flex-col md:items-stretch md:gap-5 md:overflow-y-auto md:border-b-0 md:border-r md:px-4 md:pb-5 md:pt-6`}
      >
        <div className="order-1 flex min-w-0 items-center gap-2 md:order-none md:gap-3 md:px-1">
          <span aria-hidden className="icon-tile h-9 w-9 bg-brand text-white md:h-10 md:w-10">
            <Store className="h-5 w-5 md:h-[22px] md:w-[22px]" />
          </span>
          <h1 className="min-w-0 truncate text-lg font-bold md:text-[19px]" data-testid="tablet-name">
            {tabletName}
          </h1>
        </div>

        {shift && (
          <div
            data-testid="shift-staff"
            className="order-2 flex min-w-0 shrink items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-sm font-medium text-brand-deep md:order-none md:flex-col md:items-stretch md:gap-2 md:rounded-xl md:border md:border-line md:bg-surface md:p-3 md:text-ink"
          >
            <span className="hidden text-xs font-normal text-ink-subtle md:block">Ca đang mở</span>
            <span className="flex min-w-0 items-center gap-1.5 md:gap-2.5">
              <span aria-hidden className="icon-tile rounded-full md:h-9 md:w-9 md:bg-brand-tint md:text-brand-deep">
                <UserRound className="h-4 w-4 md:h-[18px] md:w-[18px]" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate md:text-[15px] md:font-semibold">
                  <span className="md:hidden">Ca của </span>
                  {shift.staff_name}
                </span>
                <span className="hidden truncate text-[13px] font-normal text-ink-subtle md:block">từ {hhmm(shift.opened_at)}</span>
              </span>
            </span>
          </div>
        )}

        {shift && <SideNav onQueue={onQueue} />}

        <div className="hidden flex-1 md:block" />

        <Link
          to="/owner"
          className="btn btn-secondary order-4 min-h-[44px] min-w-[44px] shrink-0 px-2.5 md:order-none md:min-h-[48px] md:w-full md:justify-start md:gap-3 md:text-[15px] md:font-medium md:text-ink-muted"
          data-testid="open-owner-mode"
          aria-label="Chế độ chủ"
        >
          <KeyRound aria-hidden className="h-5 w-5" />
          <span className="hidden md:inline">Chế độ chủ</span>
        </Link>

        <div className="order-3 ml-auto flex items-center gap-2 md:order-none md:ml-0 md:px-1">
          <ConnectionBadge state={snap.conn} />
          <span className="hidden text-xs text-ink-subtle md:inline" data-testid="app-version" title="Phiên bản app">
            v{APP_VERSION.split('-')[0]}
          </span>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
    </div>
  );
}

/**
 * Menu chính. Tablet: danh sách trong sidebar. Điện thoại: thanh cố định ở đáy màn hàng đợi
 * (Thu nợ · Đóng ca là ô nhỏ, "Đơn mới" là nút cam lớn trong tầm ngón cái).
 */
function SideNav({ onQueue }: { onQueue: boolean }) {
  return (
    <nav
      aria-label="Menu bán hàng"
      className={`${onQueue ? 'flex' : 'hidden'} fixed inset-x-0 bottom-0 z-10 gap-2.5 border-t border-line bg-surface px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-raised md:static md:z-auto md:flex md:flex-col md:gap-1.5 md:border-0 md:p-0 md:shadow-none`}
    >
      <NavItem to="/" end icon={ListOrdered} className="hidden md:flex">
        Hàng đợi
      </NavItem>
      <NavItem
        to="/order/new"
        icon={Plus}
        testId="new-order"
        className="btn btn-primary order-last min-h-[64px] flex-1 rounded-2xl text-xl md:order-none md:flex-none"
      >
        Đơn mới
      </NavItem>
      <NavItem to="/debt" icon={HandCoins} testId="open-debt" className="btn btn-secondary w-[76px] flex-col gap-1 px-1 text-sm">
        Thu nợ
      </NavItem>
      <NavItem to="/shift/close" icon={Power} testId="open-close-shift" className="btn btn-secondary w-[76px] flex-col gap-1 px-1 text-sm">
        Đóng ca
      </NavItem>
    </nav>
  );
}

/** Ô menu: điện thoại theo `className`; tablet đổi thành dòng menu Makaryo (đang mở = nền cam, chữ trắng). */
function NavItem({
  to,
  end,
  icon: Icon,
  testId,
  className,
  children,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  testId?: string;
  className: string;
  children: ReactNode;
}) {
  const desktop =
    'items-center md:min-h-[52px] md:w-full md:flex-row md:justify-start md:gap-3 md:rounded-xl md:border-0 md:px-3 md:text-base md:shadow-none';
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      className={({ isActive }) =>
        `${className} ${desktop} ${
          isActive
            ? 'md:bg-brand-strong md:font-semibold md:text-white md:shadow-xs md:hover:bg-brand-deep'
            : 'md:bg-transparent md:font-medium md:text-ink-muted md:hover:bg-surface-muted'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={`flex items-center justify-center md:h-8 md:w-8 md:shrink-0 md:rounded-full ${
              isActive ? 'md:bg-brand md:text-white' : 'md:bg-surface-muted md:text-ink-muted'
            }`}
          >
            <Icon className="h-6 w-6 md:h-[18px] md:w-[18px]" strokeWidth={2.25} />
          </span>
          {children}
        </>
      )}
    </NavLink>
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
