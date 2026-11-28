import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CloudOff, HandCoins, KeyRound, Menu as MenuIcon, Power, RefreshCw, ShoppingBag, Store, UserRound, Wallet, type LucideIcon } from 'lucide-react';
import { startTablet, tabletStore } from '@/lib/pos';
import { startPrinting } from '@/lib/print';
import { ConnectionBadge } from '@/app/ConnectionBadge';
import { APP_VERSION } from '@/app/version';
import { useTabletName } from '@/app/useActivation';
import { Splash } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { hhmm } from '@/domain/time';
import type { Activation } from '@/pos';
import { CloseShiftScreen } from './CloseShiftScreen';
import { DebtScreen } from './DebtScreen';
import { ExpenseScreen } from './ExpenseScreen';
import { OpenShiftScreen } from './OpenShiftScreen';
import { PayScreen } from './PayScreen';
import { SalesScreen } from './SalesScreen';
import { LeaveGuardContext, Sheet, TabletContext, useLeave, type LeaveGuard, type TabletCtx } from './parts';

/**
 * Màn bán hàng của tablet (mục 7): chưa có ca ⇒ chọn tên + Mở ca; có ca ⇒ màn Bán hàng (hàng đợi + thực đơn + giỏ), thanh toán, đóng ca.
 * Dữ liệu lấy thẳng từ server và cập nhật realtime (src/pos): mọi máy dùng chung hồ sơ tablet thấy cùng ca, cùng hàng đợi.
 * Mọi thao tác ghi thẳng lên server; mất kết nối thì không lưu được (báo rõ trên màn hình).
 *
 * Khung theo Figma "Makaryo":
 * - Tablet (md+): sidebar trắng bên trái (tên quầy, ca đang mở, menu Bán hàng / Thu nợ / Chi tiền / Đóng ca, chế độ chủ, kết nối).
 *   Màn Bán hàng có sidebar; chỉ màn thanh toán chiếm trọn màn hình.
 * - Điện thoại: chỉ màn Bán hàng có header một dòng, menu phụ (Thu nợ · Chi tiền · Đóng ca) trong nút ☰; màn khác tự có header riêng.
 * Mỗi phần tử có data-testid chỉ có một bản trong DOM, đổi vị trí theo cỡ màn bằng CSS.
 */
export function TabletHome({ activation }: { activation: Activation }) {
  const snap = useSyncExternalStore(tabletStore.subscribe, tabletStore.getSnapshot);
  const [lastPointId, setLastPointId] = useState<string | null>(null);
  const tabletName = useTabletName(activation);
  const { pathname } = useLocation();
  const isTablet = useIsTablet();
  /** Luật rời đơn của giỏ trên màn Bán hàng: menu gọi trước khi sang màn khác. */
  const leaveGuard = useRef<LeaveGuard | null>(null);

  // Chạy suốt vòng đời app từ lúc vào màn bán hàng (kể cả khi chuyển sang chế độ chủ): không dừng khi rời màn.
  // Mỗi lần quay lại màn bán hàng (vd. vừa thoát chế độ chủ) thì tải lại ngay.
  useEffect(() => {
    startTablet(activation.tablet_profile_id);
    startPrinting(activation.tablet_profile_id);
    void tabletStore.refresh();
  }, [activation.tablet_profile_id]);

  const ctx = useMemo<TabletCtx | null>(
    () =>
      snap.open
        ? { activation, catalog: snap.catalog, shift: snap.open.shift, orders: snap.open.orders, expenses: snap.open.expenses ?? [], lastPointId, setLastPointId }
        : null,
    [activation, snap.catalog, snap.open, lastPointId],
  );

  const onQueue = pathname === '/';
  /** Thanh toán: toàn màn hình, không sidebar. */
  const fullScreen = pathname.startsWith('/order');
  const shift = ctx?.shift ?? null;

  return (
    <LeaveGuardContext.Provider value={leaveGuard}>
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

          {shift && isTablet && <SideNav />}

          <div className="hidden flex-1 md:block" />

          <GuardedLink
            to="/owner"
            className="btn btn-secondary order-4 min-h-[44px] min-w-[44px] shrink-0 px-2.5 md:order-none md:min-h-[48px] md:w-full md:justify-start md:gap-3 md:text-[15px] md:font-medium md:text-ink-muted"
            data-testid="open-owner-mode"
            aria-label="Chế độ chủ"
          >
            <KeyRound aria-hidden className="h-5 w-5" />
            <span className="hidden md:inline">Chế độ chủ</span>
          </GuardedLink>

          <div className="order-3 ml-auto flex items-center gap-2 md:order-none md:ml-0 md:px-1">
            <ConnectionBadge state={snap.conn} />
            <span className="hidden text-xs text-ink-subtle md:inline" data-testid="app-version" title="Phiên bản app">
              v{APP_VERSION.split('-')[0]}
            </span>
          </div>

          {shift && !isTablet && <PhoneMenu />}
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
    </LeaveGuardContext.Provider>
  );
}

/** Các mục menu bán hàng (sidebar tablet, bảng ☰ điện thoại). */
const NAV: ReadonlyArray<{ to: string; icon: LucideIcon; label: string; testId: string; end?: boolean }> = [
  { to: '/', icon: ShoppingBag, label: 'Bán hàng', testId: 'nav-sales', end: true },
  { to: '/debt', icon: HandCoins, label: 'Thu nợ', testId: 'open-debt' },
  { to: '/expenses', icon: Wallet, label: 'Chi tiền', testId: 'open-expenses' },
  { to: '/shift/close', icon: Power, label: 'Đóng ca', testId: 'open-close-shift' },
];

/**
 * Bấm sang màn khác: đi qua luật rời đơn của giỏ (đơn đã lưu ⇒ tự lưu; đơn mới có món ⇒ hỏi "Bỏ thay đổi?").
 * Bấm lại đúng màn đang mở thì không làm gì.
 */
function useGuardedClick(to: string, after?: () => void) {
  const leave = useLeave();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return (e: MouseEvent) => {
    e.preventDefault();
    if (pathname + search === to) return after?.();
    leave(() => {
      after?.();
      navigate(to);
    });
  };
}

function GuardedLink({ to, className, children, ...rest }: { to: string; className: string; children: ReactNode; 'data-testid'?: string; 'aria-label'?: string }) {
  const onClick = useGuardedClick(to);
  return (
    <Link to={to} className={className} onClick={onClick} {...rest}>
      {children}
    </Link>
  );
}

/** Menu chính trong sidebar tablet (dòng menu Makaryo: đang mở = nền cam, chữ trắng). */
function SideNav() {
  return (
    <nav aria-label="Menu bán hàng" className="flex flex-col gap-1.5">
      {NAV.map((n) => (
        <NavItem key={n.to} {...n} />
      ))}
    </nav>
  );
}

function NavItem({ to, end, icon: Icon, testId, label, onNavigate }: (typeof NAV)[number] & { onNavigate?: () => void }) {
  const onClick = useGuardedClick(to, onNavigate);
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testId}
      onClick={onClick}
      className={({ isActive }) =>
        `flex min-h-[56px] items-center gap-3 rounded-xl px-3 text-[17px] md:min-h-[52px] md:text-base ${
          isActive ? 'bg-brand-strong font-semibold text-white shadow-xs hover:bg-brand-deep' : 'border border-line font-medium text-ink-muted hover:bg-surface-muted md:border-0'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full md:h-8 md:w-8 ${isActive ? 'bg-brand text-white' : 'bg-surface-muted text-ink-muted'}`}
          >
            <Icon className="h-5 w-5 md:h-[18px] md:w-[18px]" strokeWidth={2.25} />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}

/** Điện thoại: nút ☰ trên header màn Bán hàng mở bảng menu (thay thanh đáy cũ). */
function PhoneMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`btn order-5 h-11 min-h-0 w-11 min-w-0 shrink-0 px-0 ${open ? 'btn-dark' : 'btn-secondary'}`}
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="open-menu"
      >
        <MenuIcon aria-hidden className="h-5 w-5" />
      </button>
      {open && (
        <Sheet testId="menu-sheet" title="Menu" onClose={() => setOpen(false)}>
          <nav aria-label="Menu bán hàng" className="flex flex-col gap-2">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} onNavigate={() => setOpen(false)} />
            ))}
          </nav>
        </Sheet>
      )}
    </>
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
      <Route path="/" element={hasShift ? <SalesScreen /> : <OpenShiftScreen />} />
      {/* Đường dẫn cũ của màn đơn: gọi món nay nằm trong màn Bán hàng. */}
      <Route path="/order/new" element={<Navigate to="/" replace />} />
      <Route path="/order/:orderId" element={<OldOrderRedirect />} />
      <Route path="/order/:orderId/pay" element={needShift(<PayScreen />)} />
      <Route path="/debt" element={needShift(<DebtScreen />)} />
      <Route path="/expenses" element={needShift(<ExpenseScreen />)} />
      {/* Đóng ca tự xử lý lúc không còn ca (ngay sau khi đóng: chỉ hiện "Đã đóng ca"). */}
      <Route path="/shift/close" element={<CloseShiftScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** `/order/:id` (đường dẫn cũ) ⇒ màn Bán hàng, đơn đó đang chọn. */
function OldOrderRedirect() {
  const { orderId } = useParams();
  return <Navigate to={orderId ? `/?order=${encodeURIComponent(orderId)}` : '/'} replace />;
}
