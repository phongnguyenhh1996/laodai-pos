import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useOwner } from './OwnerContext';

/** Khung trang chế độ chủ: nút quay lại, tiêu đề, Thoát (tablet) / Đăng xuất (điện thoại, ở trang đầu). */
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
    <main data-testid={testId} className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {back && (
            <Link
              to={back}
              aria-label="Quay lại"
              className="btn flex shrink-0 items-center justify-center border border-stone-300 bg-white text-2xl"
              data-testid="owner-back"
            >
              ‹
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{title}</h1>
            <p className="truncate text-sm text-stone-500" data-testid="owner-device">
              {owner.device === 'tablet' ? `Trên ${owner.tabletName} · tự thoát sau 2 phút không thao tác` : owner.email}
            </p>
          </div>
        </div>
        {owner.device === 'tablet' ? (
          <button type="button" className="btn shrink-0 bg-stone-800 text-white" onClick={owner.leave} data-testid="owner-exit">
            Thoát
          </button>
        ) : (
          !back && (
            <button type="button" className="btn shrink-0 border border-stone-300 bg-white" onClick={owner.leave} data-testid="owner-logout">
              Đăng xuất
            </button>
          )
        )}
      </header>
      {children}
    </main>
  );
}

export function NavList({ children }: { children: ReactNode }) {
  return <nav className="flex flex-col divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">{children}</nav>;
}

export function NavItem({ to, testId, title, subtitle, muted }: { to: string; testId: string; title: string; subtitle?: string; muted?: boolean }) {
  return (
    <Link to={to} data-testid={testId} className="flex min-h-tap items-center justify-between gap-3 px-4 py-3 active:bg-stone-50">
      <span className="min-w-0">
        <span className={`block text-lg font-medium ${muted ? 'text-stone-400 line-through' : ''}`}>{title}</span>
        {subtitle && <span className="block truncate text-sm text-stone-500">{subtitle}</span>}
      </span>
      <span aria-hidden className="text-2xl text-stone-400">
        ›
      </span>
    </Link>
  );
}
