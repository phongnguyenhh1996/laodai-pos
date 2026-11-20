import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BookUser,
  ChartColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  House,
  LayoutGrid,
  LogOut,
  ReceiptText,
  ScrollText,
  Settings,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useIsTablet } from '@/app/useMediaQuery';
import { useOwner } from './OwnerContext';

/** Mục điều hướng chế độ chủ (thanh bên tablet, thanh tab điện thoại, màn Thêm). */
interface Section {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
}

export const SECTIONS: Section[] = [
  { key: 'home', to: '/owner', label: 'Tổng quan', icon: House },
  { key: 'orders', to: '/owner/orders', label: 'Đơn', icon: ReceiptText },
  { key: 'reports', to: '/owner/reports', label: 'Báo cáo', icon: ChartColumn },
  { key: 'shifts', to: '/owner/shifts', label: 'Ca', icon: Users },
  { key: 'debts', to: '/owner/debts', label: 'Sổ nợ', icon: BookUser },
  { key: 'payroll', to: '/owner/payroll', label: 'Lương', icon: Wallet },
  { key: 'log', to: '/owner/log', label: 'Nhật ký', icon: ScrollText },
  { key: 'settings', to: '/owner/settings', label: 'Cài đặt', icon: Settings },
  { key: 'device', to: '/owner/device', label: 'Quầy của máy này', icon: Store },
];
/** Thanh tab điện thoại: 4 mục chính + "Thêm" (các mục còn lại nằm ở màn Thêm). */
const TABS = ['home', 'orders', 'reports', 'shifts'];
const MORE: Section = { key: 'more', to: '/owner/more', label: 'Thêm', icon: LayoutGrid };

function activeKey(pathname: string): string {
  const seg = pathname.replace(/^\/owner\/?/, '').split('/')[0];
  if (!seg) return 'home';
  return SECTIONS.some((s) => s.key === seg) ? seg : seg === 'more' ? 'more' : '';
}

/**
 * Khung trang chế độ chủ (Figma R12 / T20 "Makaryo").
 * Tablet: thanh bên trái (logo, máy này, 9 mục, Thoát) + đầu trang trắng (tiêu đề, `subtitle`, `actions`).
 * Điện thoại: thanh trên (logo hoặc nút quay lại, tiêu đề, máy này, nút Thoát đỏ) + thanh tab dưới cho trang cấp 1.
 * `back` = trang con (điện thoại: có nút quay lại, không có thanh tab); `back="/owner"` coi là trang cấp 1.
 * `wide` = nội dung trải hết bề ngang (màn đã làm lại theo Figma); không thì giữ cột 2xl như cũ.
 */
export function OwnerLayout({
  title,
  subtitle,
  actions,
  back,
  wide = false,
  tabBar,
  bottomBar,
  testId,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: string;
  wide?: boolean;
  /** Điện thoại: hiện thanh tab cả ở trang con (Figma R23 "Đơn chi tiết"). Mặc định chỉ trang cấp 1. */
  tabBar?: boolean;
  /** Điện thoại: thanh thao tác dính đáy (Figma R24 "Lưu thay đổi") thay cho thanh tab. Tablet: đặt nút vào `actions`. */
  bottomBar?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  const owner = useOwner();
  const isTablet = useIsTablet();
  const { pathname } = useLocation();
  const active = activeKey(pathname);
  const child = back !== undefined && back !== '/owner';
  const showTabs = !bottomBar && (tabBar ?? !child);

  const content = (
    <div className={`flex w-full flex-col gap-4 p-4 pb-6 md:gap-5 md:px-7 md:pb-8 md:pt-6 ${wide ? '' : 'mx-auto max-w-2xl md:px-4'}`}>
      {children}
    </div>
  );

  if (isTablet) {
    return (
      <div className="flex min-h-full bg-[#f6f6f6] text-[#111]">
        <Sidebar active={active} tabletName={owner.tabletName} onExit={owner.leave} />
        <main data-testid={testId} className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex min-h-[88px] items-center justify-between gap-4 border-b border-line bg-white px-7 py-[18px]">
            <div className="flex min-w-0 items-center gap-3">
              {child && <BackLink to={back} />}
              <div className="flex min-w-0 flex-col gap-[3px]">
                <h1 className="truncate text-2xl font-bold leading-[30px] tracking-normal">{title}</h1>
                {subtitle && <p className="truncate text-sm leading-[18px] text-[#888]">{subtitle}</p>}
              </div>
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
          </header>
          {content}
        </main>
      </div>
    );
  }

  return (
    <main data-testid={testId} className={`flex min-h-full flex-col bg-[#f6f6f6] text-[#111] ${showTabs ? 'pb-[82px]' : bottomBar ? 'pb-[84px]' : ''}`}>
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between gap-3 border-b border-line bg-white px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {child ? <BackLink to={back} /> : <Logo className="h-10 w-10 rounded-xl text-[15px]" />}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="truncate text-xl font-bold leading-[26px] tracking-normal">{title}</h1>
            <p className="flex items-center gap-1.5 text-xs leading-[15px] text-[#888]" data-testid="owner-device">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              <span className="truncate">{owner.tabletName} · tự thoát sau 2 phút</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-[#b42318] px-3.5 text-sm font-semibold text-white hover:bg-[#9b1d14] active:bg-[#9b1d14]"
          onClick={owner.leave}
          data-testid="owner-exit"
        >
          <LogOut aria-hidden className="h-4 w-4" />
          Thoát
        </button>
      </header>
      {content}
      {showTabs && <TabBar active={active} />}
      {bottomBar && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex h-[84px] items-center gap-2.5 border-t border-line bg-white px-4 pb-3.5" data-testid="owner-bottom-bar">
          {bottomBar}
        </div>
      )}
    </main>
  );
}

function Logo({ className }: { className: string }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center bg-brand font-bold text-white ${className}`}>
      LĐ
    </span>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      aria-label="Quay lại"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-[#111] hover:bg-surface-muted"
      data-testid="owner-back"
    >
      <ChevronLeft aria-hidden className="h-5 w-5" />
    </Link>
  );
}

function Sidebar({ active, tabletName, onExit }: { active: string; tabletName: string; onExit: () => void }) {
  return (
    <aside className="sticky top-0 flex h-screen w-[260px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-white px-4 py-5">
      <div className="flex h-9 items-center gap-2.5">
        <Logo className="h-9 w-9 rounded-[10px] text-sm" />
        <span className="text-xl font-bold leading-[25px]">Lão Đại</span>
      </div>
      <Link
        to="/owner/device"
        className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2.5 hover:bg-surface-muted"
        data-testid="owner-sidebar-device"
      >
        <span className="text-[11px] leading-[14px] text-[#888]">Chế độ chủ</span>
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#ffeee7] text-[#c2380a]">
            <Store className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <b className="truncate text-sm leading-[18px]" data-testid="owner-device">
              {tabletName}
            </b>
            <span className="text-[11px] leading-[14px] text-[#888]">tự thoát sau 2 phút</span>
          </span>
          <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-[#888]" />
        </span>
      </Link>
      <nav className="flex flex-col gap-1" aria-label="Chế độ chủ">
        {SECTIONS.map((s) => {
          const on = s.key === active;
          return (
            <Link
              key={s.key}
              to={s.to}
              aria-current={on ? 'page' : undefined}
              data-testid={`owner-nav-${s.key}`}
              className={`flex h-10 items-center gap-2.5 rounded-[10px] px-3.5 text-sm leading-[18px] transition-colors duration-fast ${
                on ? 'bg-brand font-semibold text-white' : 'font-medium text-[#8a8a8a] hover:bg-surface-muted hover:text-[#111]'
              }`}
            >
              <s.icon aria-hidden className={`h-[18px] w-[18px] shrink-0 ${on ? '' : 'text-[#a3a3a3]'}`} />
              {s.label}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onExit}
        className="mt-auto flex h-[50px] items-center gap-2.5 rounded-[10px] px-3.5 text-sm font-semibold text-[#b42318] hover:bg-[#fdecec]"
        data-testid="owner-exit"
      >
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#fdecec]">
          <LogOut className="h-[15px] w-[15px]" />
        </span>
        Thoát chế độ chủ
      </button>
    </aside>
  );
}

function TabBar({ active }: { active: string }) {
  const tabs = [...SECTIONS.filter((s) => TABS.includes(s.key)), MORE];
  const moreActive = !TABS.includes(active) && active !== '';
  return (
    <nav
      aria-label="Chế độ chủ"
      className="fixed inset-x-0 bottom-0 z-10 flex h-[82px] items-center justify-between border-t border-line bg-white px-3 pb-3"
    >
      {tabs.map((t) => {
        const on = t.key === active || (t.key === 'more' && moreActive);
        return on ? (
          <Link
            key={t.key}
            to={t.to}
            aria-current="page"
            data-testid={`owner-nav-${t.key}`}
            className="flex h-[38px] items-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white"
          >
            <t.icon aria-hidden className="h-[18px] w-[18px]" />
            {t.label}
          </Link>
        ) : (
          <Link
            key={t.key}
            to={t.to}
            data-testid={`owner-nav-${t.key}`}
            className="flex flex-col items-center gap-[3px] p-1.5 text-[11px] font-medium leading-[14px] text-[#9a9a9a] hover:text-[#111]"
          >
            <t.icon aria-hidden className="h-5 w-5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Tiêu đề thẻ: chữ đậm 16 + link cam bên phải (Figma "Theo điểm bán · Báo cáo ›"). */
export function CardHead({ title, link, children }: { title: string; link?: { to: string; label: string; testId?: string }; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-bold leading-5 tracking-normal">{title}</h2>
      {link && (
        <Link to={link.to} className="flex items-center gap-0.5 text-[13px] font-semibold leading-4 text-brand hover:text-brand-deep" data-testid={link.testId}>
          {link.label}
          <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
      )}
      {children}
    </div>
  );
}

/** Chip bo tròn nhỏ (Trực tiếp, chờ lâu, giờ…). */
export function Chip({ className, children, testId, state }: { className: string; children: ReactNode; testId?: string; state?: string }) {
  return (
    <span data-testid={testId} data-state={state} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold leading-[15px] ${className}`}>
      {children}
    </span>
  );
}

export function NavList({ children }: { children: ReactNode }) {
  return <nav className="card flex flex-col divide-y divide-line overflow-hidden">{children}</nav>;
}

export function NavItem({
  to,
  testId,
  title,
  subtitle,
  muted,
  live,
  icon: Icon,
}: {
  to: string;
  testId: string;
  title: string;
  subtitle?: string;
  muted?: boolean;
  icon?: LucideIcon;
  /** Chấm xanh: đang mở / đang hoạt động. */
  live?: boolean;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="flex min-h-tap items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-muted active:bg-surface-sunken"
    >
      {Icon && (
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-2 text-lg font-medium ${muted ? 'text-ink-subtle line-through' : ''}`}>
          {live && <span aria-label="Đang mở" className="dot bg-success" />}
          {title}
        </span>
        {subtitle && <span className="block truncate text-sm text-ink-subtle">{subtitle}</span>}
      </span>
      <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
    </Link>
  );
}
