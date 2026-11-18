import { ChevronRight, HandCoins, UserRound } from 'lucide-react';
import { customerLabel, suggestCustomers } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import type { Customer } from '@/domain/types';
import { useMemo } from 'react';
import { debtBook, type DebtBook } from '@/pos';
import { useTablet } from './parts';

/** Sổ nợ: khách + dư nợ từ server (tải lại ngay sau mỗi lần ghi / thu nợ, và khi máy khác thu nợ). */
export function useDebtBook(): DebtBook | null {
  const { catalog } = useTablet();
  return useMemo(() => (catalog ? debtBook(catalog) : null), [catalog]);
}

/** Danh sách gợi ý khách khi gõ tên / mô tả (không phân biệt dấu: "dung" khớp "Dũng"). */
export function CustomerSuggestions({
  book,
  query,
  onPick,
  showAllWithDebt = false,
}: {
  book: DebtBook;
  query: string;
  onPick: (c: Customer) => void;
  /** Ô tìm còn trống ⇒ hiện sẵn các khách đang nợ (màn Thu nợ). */
  showAllWithDebt?: boolean;
}) {
  const list = query.trim()
    ? suggestCustomers(book.customers, query)
    : showAllWithDebt
      ? book.customers.filter((c) => book.balance(c.id) > 0).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      : [];
  if (list.length === 0) return null;
  return (
    <ul className="card flex flex-col overflow-hidden" data-testid="customer-suggestions">
      {list.map((c) => (
        <li key={c.id} className="border-t border-line first:border-t-0">
          <button
            type="button"
            onClick={() => onPick(c)}
            className="flex min-h-[68px] w-full items-center gap-3 px-3.5 py-3 text-left transition-colors duration-fast hover:bg-surface-muted active:bg-surface-sunken md:px-4"
            data-testid={`customer-suggest-${c.id}`}
          >
            <span aria-hidden className="icon-tile h-10 w-10 rounded-full bg-warning-soft text-warning-strong">
              <UserRound className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-base font-semibold">{customerLabel(c)}</span>
            <span className="num shrink-0 text-base font-bold">
              <span className="text-[13px] font-normal text-ink-subtle">nợ </span>
              {formatVnd(book.balance(c.id))}
            </span>
            <span className="badge shrink-0 gap-1 rounded-[10px] border border-brand bg-brand-soft px-2.5 py-1.5 text-[13px] font-semibold text-brand-deep">
              <HandCoins aria-hidden className="h-4 w-4" />
              Chọn
            </span>
            <ChevronRight aria-hidden className="hidden h-5 w-5 shrink-0 text-ink-subtle md:block" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Khách đã chọn + dư nợ hiện tại, nút đổi khách. */
export function ChosenCustomer({ book, customer, onClear }: { book: DebtBook; customer: Customer; onClear: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warning-line bg-warning-soft p-4" data-testid="customer-chosen">
      <span aria-hidden className="icon-tile h-11 w-11 rounded-full bg-warning-tint text-warning-strong">
        <UserRound className="h-[22px] w-[22px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-semibold" data-testid="customer-chosen-label">
          {customerLabel(customer)}
        </p>
        <p className="text-lg text-ink-muted">
          Đang nợ <b className="num text-warning-strong" data-testid="customer-balance">{formatVnd(book.balance(customer.id))}</b>
        </p>
      </div>
      <button type="button" className="btn btn-secondary" onClick={onClear} data-testid="customer-clear">
        Đổi khách
      </button>
    </div>
  );
}
