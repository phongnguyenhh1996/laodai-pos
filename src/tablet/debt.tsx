import { ChevronRight, UserRound } from 'lucide-react';
import { customerLabel, suggestCustomers } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import type { Customer } from '@/domain/types';
import { localDb } from '@/lib/localdb';
import { useLive } from '@/app/useLive';
import { debtBook, loadDebtJournal, type DebtBook } from '@/sync';
import { useTablet } from './parts';

/** Sổ nợ trên máy: khách + dư nợ tải về, cộng các khoản ghi / thu nợ làm trên máy chưa phản ánh. */
export function useDebtBook(): DebtBook | null {
  const { catalog } = useTablet();
  const journal = useLive(() => loadDebtJournal(localDb), []);
  return journal.status === 'ready' ? debtBook(catalog, journal.value) : null;
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
    <ul className="flex flex-col gap-2" data-testid="customer-suggestions">
      {list.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onPick(c)}
            className="btn btn-secondary w-full justify-between text-left"
            data-testid={`customer-suggest-${c.id}`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <UserRound aria-hidden className="h-5 w-5 shrink-0 text-ink-subtle" />
              <span className="truncate">{customerLabel(c)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="badge num bg-warning-soft text-base text-warning-strong">nợ {formatVnd(book.balance(c.id))}</span>
              <ChevronRight aria-hidden className="h-5 w-5 text-ink-subtle" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Khách đã chọn + dư nợ hiện tại, nút đổi khách. */
export function ChosenCustomer({ book, customer, onClear }: { book: DebtBook; customer: Customer; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-warning-line bg-warning-soft p-4 shadow-card" data-testid="customer-chosen">
      <div>
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
