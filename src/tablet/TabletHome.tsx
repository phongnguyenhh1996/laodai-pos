import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CloudOff, HandCoins, KeyRound, Menu as MenuIcon, Power, RefreshCw, ShoppingBag, Store, UserRound, Wallet, X, type LucideIcon } from 'lucide-react';
import { startTablet, tabletStore } from '@/lib/pos';
import { startPrinting } from '@/lib/print';
import { ConnectionBadge } from '@/app/ConnectionBadge';
import { APP_VERSION } from '@/app/version';
import { useTabletName } from '@/app/useActivation';
import { Splash } from '@/app/ui';
import { useIsTablet } from '@/app/useMediaQuery';
import { hhmm } from '@/domain/time';
import type { Activation, TabletShift } from '@/pos';
import { CloseShiftScreen } from './CloseShiftScreen';
import { DebtScreen } from './DebtScreen';
import { ExpenseScreen } from './ExpenseScreen';
import { OpenShiftScreen } from './OpenShiftScreen';
import { PrintErrorToast, PrinterButton } from './PrinterStatus';
import { SalesScreen } from './SalesScreen';
import { ToastHost } from './Toast';
import { LeaveGuardContext, TabletContext, useLeave, type LeaveGuard, type TabletCtx } from './parts';

/**
 * Màn bán hàng của tablet (mục 7): chưa có ca ⇒ chọn tên + Mở ca; có ca ⇒ màn Bán hàng (hàng đợi + thực đơn + giỏ), thanh toán, đóng ca.
 * Dữ liệu lấy thẳng từ server và cập nhật realtime (src/pos): mọi máy dùng chung hồ sơ tablet thấy cùng ca, cùng hàng đợi.
 * Mọi thao tác ghi thẳng lên server; mất kết nối thì không lưu được (báo rõ trên màn hình).
 *
 * Khung theo Figma "Makaryo":
 * - Tablet (md+): sidebar trắng bên trái (tên quầy, ca đang mở, menu Bán hàng / Thu nợ / Chi tiền / Đóng ca, chế độ chủ, kết nối).
 *   Màn Bán hàng có sidebar; chỉ màn thanh toán chiếm trọn màn hình.
 * - Điện thoại: chỉ màn Bán hàng có header một dòng, menu phụ (Thu nợ · Chi tiền · Đóng ca · Chế độ chủ) trong nút ☰; màn khác tự có header riêng.
 * Trạng thái máy in là icon nhỏ cạnh chỉ báo kết nối; sự kiện một lần (đã thu, in lỗi…) là toast.
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
    () => (snap.open ? { activation, catalog: snap.catalog, shift: snap.open.shift, orders: snap.open.orders, expenses: snap.open.expenses ?? [], lastPointId, setLastPointId } : null),
    [activation, snap.catalog, snap.open, lastPointId],
  );

  const onQueue = pathname === '/';
  /** Thanh toán: toàn màn hình, không sidebar. */
  const fullScreen = pathname.startsWith('/order');
  const shift = ctx?.shift ?? null;
  /** Điện thoại có ca: Chế độ chủ nằm trong ☰ (thay thanh đáy cũ). */
  const phoneMenu = !!shift && !isTablet;
  const orders = ctx?.orders;

  return (
    <LeaveGuardContext.Provider value={leaveGuard}>
      <ToastHost extra={<PrintErrorToast canReprint={(id) => !!orders?.some((o) => o.id === id)} />}>
        <div data-testid="tablet-home" className="flex h-full flex-col bg-canvas md:flex-row">
          <aside
            className={`${onQueue || !ctx ? 'flex' : 'hidden'} ${fullScreen ? 'md:hidden' : 'md:flex'} shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 md:w-60 md:flex-col md:items-stretch md:gap-5 md:overflow-y-auto md:border-b-0 md:border-r md:px-4 md:pb-4 md:pt-5`}
          >
            <div className="order-1 flex min-w-0 items-center gap-2 md:order-none md:gap-2.5">
              <span aria-hidden className="icon-tile h-9 w-9 bg-brand text-white md:h-10 md:w-10 md:rounded-xl">
                <Store className="h-5 w-5 md:h-[22px] md:w-[22px]" />
              </span>
              <h1 className="min-w-0 truncate text-lg font-bold md:text-[19px] md:leading-6 md:text-[#111]" data-testid="tablet-name">
                {tabletName}
              </h1>
            </div>

            {shift && (
              <div
                data-testid="shift-staff"
                className="order-2 flex min-w-0 shrink items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-sm font-medium text-brand-deep md:order-none md:flex-col md:items-stretch md:gap-2 md:rounded-[14px] md:border md:border-line md:bg-white md:p-3 md:text-[#111]"
              >
                <span className="hidden text-xs font-normal leading-[15px] text-[#888] md:block">Ca đang mở</span>
                <span className="flex min-w-0 items-center gap-1.5 md:gap-2.5">
                  <span aria-hidden className="icon-tile rounded-full md:hidden">
                    <UserRound className="h-4 w-4" />
                  </span>
                  {/* Tablet: avatar chữ cái đầu tên (Figma BH1). */}
                  <span aria-hidden className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ffeee7] text-[15px] font-bold text-[#c2380a] md:flex">
                    {initial(shift.staff_name)}
                  </span>
                  <span className="flex min-w-0 flex-col md:gap-px">
                    <span className="truncate md:text-[15px] md:font-bold md:leading-[19px]">
                      <span className="sr-only">Ca của </span>
                      {shift.staff_name}
                    </span>
                    <span className="hidden truncate text-xs font-normal leading-[15px] text-[#888] md:block">từ {hhmm(shift.opened_at)}</span>
                  </span>
                </span>
              </div>
            )}

            {shift && isTablet && <SideNav />}

            <div className="hidden flex-1 md:block" />

            {!phoneMenu && (
              <GuardedLink
                to="/owner"
                className="btn btn-secondary order-4 min-h-[44px] min-w-[44px] shrink-0 px-2.5 md:order-none md:min-h-[50px] md:w-full md:justify-start md:gap-2.5 md:rounded-xl md:px-2.5 md:py-2 md:text-sm md:font-medium md:text-[#6d6d6d] md:shadow-none"
                data-testid="open-owner-mode"
                aria-label="Chế độ chủ"
              >
                <KeyRound aria-hidden className="h-5 w-5 md:hidden" />
                <span aria-hidden className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#f1f1f1] text-[#6d6d6d] md:flex">
                  <KeyRound className="h-4 w-4" />
                </span>
                <span className="hidden md:inline">Chế độ chủ</span>
              </GuardedLink>
            )}

            <div className="order-3 ml-auto flex items-center gap-2 md:order-none md:-mt-2 md:ml-0">
              <ConnectionBadge state={snap.conn} />
              <span className="hidden text-xs leading-[15px] text-[#888] md:inline" data-testid="app-version" title="Phiên bản app">
                v{APP_VERSION.split('-')[0]}
              </span>
            </div>

            {ctx && !isTablet && <PrinterButton className="order-4" />}
            {phoneMenu && <PhoneMenu shift={shift} tabletName={tabletName} />}
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
                snap.error ? (
                  <LoadError />
                ) : (
                  <Splash />
                )
              ) : (
                <TabletContext.Provider value={ctx}>
                  <TabletRoutes hasShift={!!ctx.shift} />
                </TabletContext.Provider>
              )}
            </div>
          </div>
        </div>
      </ToastHost>
    </LeaveGuardContext.Provider>
  );
}

/** Chữ cái đầu tên nhân viên (avatar sidebar tablet). */
const initial = (name: string) => name.trim().charAt(0).toLocaleUpperCase('vi') || '?';

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
    <nav aria-label="Menu bán hàng" className="flex flex-col gap-1">
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
        `flex min-h-[56px] items-center gap-3 rounded-xl px-3 text-[17px] md:min-h-[44px] md:px-3.5 md:text-[15px] md:leading-[19px] ${
          isActive
            ? 'bg-brand-strong font-semibold text-white shadow-xs hover:bg-brand-deep md:bg-brand md:shadow-none md:hover:bg-brand-strong'
            : 'border border-line font-medium text-ink-muted hover:bg-surface-muted md:border-0 md:text-[#6d6d6d] md:hover:bg-[#f8f8f8]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Điện thoại (menu ☰): icon trong vòng tròn; tablet (sidebar, Figma BH1): icon trần 20. */}
          <span
            aria-hidden
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full md:h-5 md:w-5 md:bg-transparent ${isActive ? 'bg-brand text-white' : 'bg-surface-muted text-ink-muted md:text-[#9a9a9a]'}`}
          >
            <Icon className="h-5 w-5 md:stroke-2" strokeWidth={2.25} />
          </span>
          {label}
        </>
      )}
    </NavLink>
  );
}

/**
 * Điện thoại: nút ☰ trên header màn Bán hàng mở bảng menu (thay thanh đáy cũ; Figma P10).
 * Đầu bảng là ca đang mở; mục: Thu nợ · Chi tiền · Đóng ca · Chế độ chủ (đang ở Bán hàng nên không có mục đó).
 */
function PhoneMenu({ shift, tabletName }: { shift: TabletShift; tabletName: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
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
        <div className="fixed inset-0 z-20 flex items-end bg-black/45" role="dialog" aria-modal aria-label="Menu" onClick={close}>
          <div
            data-testid="menu-sheet"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full flex-col gap-2 rounded-t-3xl bg-surface px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-raised"
          >
            <span aria-hidden className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-line-strong" />
            <div className="mb-1 flex items-center gap-3 px-1">
              <span aria-hidden className="icon-tile h-10 w-10 rounded-full bg-brand-tint text-brand-deep">
                <UserRound className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-semibold">Ca của {shift.staff_name}</span>
                <span className="truncate text-[13px] text-ink-subtle">
                  từ {hhmm(shift.opened_at)} · {tabletName} · v{APP_VERSION.split('-')[0]}
                </span>
              </span>
              <button type="button" className="btn btn-secondary h-11 min-h-0 w-11 min-w-0 shrink-0 px-0" onClick={close} aria-label="Đóng">
                <X aria-hidden className="h-5 w-5 text-ink-muted" />
              </button>
            </div>
            <nav aria-label="Menu bán hàng" className="flex flex-col gap-2">
              {NAV.filter((n) => n.to !== '/').map((n) => (
                <NavItem key={n.to} {...n} onNavigate={close} />
              ))}
              <NavItem to="/owner" icon={KeyRound} label="Chế độ chủ" testId="open-owner-mode" onNavigate={close} />
            </nav>
          </div>
        </div>
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
      {/* Đường dẫn cũ của màn đơn / thanh toán: gọi món và thanh toán nay nằm trong màn Bán hàng. */}
      <Route path="/order/new" element={<Navigate to="/" replace />} />
      <Route path="/order/:orderId" element={<OldOrderRedirect />} />
      <Route path="/order/:orderId/pay" element={<OldOrderRedirect />} />
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
