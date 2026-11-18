import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, type LucideIcon } from 'lucide-react';
import { useOwner } from './OwnerContext';

/** Khung trang chế độ chủ: nút quay lại, tiêu đề, nút Thoát về màn bán hàng. */
export function OwnerLayout({
  title,
  back,
  testId,
  children,
}: {
  title: string;
  back?: string;
  testId: string;
  children: ReactNode;
}) {
  const owner = useOwner();
  return (
    <main data-testid={testId} className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {back && (
            <Link
              to={back}
              aria-label="Quay lại"
              className="btn btn-secondary shrink-0 px-0"
              data-testid="owner-back"
            >
              <ChevronLeft aria-hidden className="h-6 w-6" />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{title}</h1>
            <p className="truncate text-sm text-ink-subtle" data-testid="owner-device">
              Trên {owner.tabletName} · tự thoát sau 2 phút không thao tác
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-dark shrink-0" onClick={owner.leave} data-testid="owner-exit">
          <X aria-hidden className="h-5 w-5" />
          Thoát
        </button>
      </header>
      {children}
    </main>
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
