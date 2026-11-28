import { Check, ChevronRight, HandCoins, ReceiptText, UserRound } from 'lucide-react';
import { customerLabel, debtItemsText, openDebtOrders, suggestCustomers, type DebtHistory } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import { dayTime } from '@/domain/time';
import type { Customer, Money } from '@/domain/types';
import { useEffect, useMemo, useState } from 'react';
import { debtBook, type DebtBook } from '@/pos';
import { tabletStore } from '@/lib/pos';
import { errorMessage } from '@/app/ui';
import { useTablet } from './parts';

/** Sổ nợ: khách + dư nợ từ server (tải lại ngay sau mỗi lần ghi / thu nợ, và khi máy khác thu nợ). */
export function useDebtBook(): DebtBook | null {
  const { catalog } = useTablet();
  return useMemo(() => (catalog ? debtBook(catalog) : null), [catalog]);
}

/** Danh sách gợi ý khách khi gõ tên / mô tả / SĐT (không phân biệt dấu: "dung" khớp "Dũng"). */
export function CustomerSuggestions({
  book,
  query,
  onPick,
  showAllWithDebt = false,
  ship = false,
  compact = false,
  limit,
}: {
  book: DebtBook;
  query: string;
  onPick: (c: Customer) => void;
  /** Ô tìm còn trống ⇒ hiện sẵn các khách đang nợ (màn Thu nợ). */
  showAllWithDebt?: boolean;
  /** Chọn khách cho đơn ship: dòng phụ SĐT · địa chỉ, chỉ hiện dư nợ khi còn nợ. */
  ship?: boolean;
  /** Danh sách gọn trong bảng Ghi nợ (Figma BH12): dòng 42, icon người, "Nợ X đ" xám bên phải. */
  compact?: boolean;
  limit?: number;
}) {
  const list = query.trim()
    ? suggestCustomers(book.customers, query, limit)
    : showAllWithDebt
      ? book.customers.filter((c) => book.balance(c.id) > 0).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      : [];
  if (list.length === 0) return null;
  if (compact)
    return (
      <ul className="flex shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-white" data-testid="customer-suggestions">
        {list.map((c) => (
          <li key={c.id} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => onPick(c)}
              className="flex min-h-[42px] w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors duration-fast hover:bg-[#f8f8f8]"
              data-testid={`customer-suggest-${c.id}`}
            >
              <UserRound aria-hidden className="h-4 w-4 shrink-0 text-[#6d6d6d]" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium leading-[18px] text-[#111]">{customerLabel(c)}</span>
              <span className="num shrink-0 text-[13px] leading-4 text-[#888]">Nợ {formatVnd(book.balance(c.id))}đ</span>
            </button>
          </li>
        ))}
      </ul>
    );
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
            {ship ? (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-semibold">{customerLabel(c)}</span>
                {(c.phone || c.address) && (
                  <span className="truncate text-sm text-ink-muted">{[c.phone, c.address].filter(Boolean).join(' · ')}</span>
                )}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-base font-semibold">{customerLabel(c)}</span>
            )}
            {(!ship || book.balance(c.id) > 0) && (
              <span className="num shrink-0 text-base font-bold">
                <span className="text-[13px] font-normal text-ink-subtle">nợ </span>
                {formatVnd(book.balance(c.id))}
              </span>
            )}
            <span className="badge shrink-0 gap-1 rounded-[10px] border border-brand bg-brand-soft px-2.5 py-1.5 text-[13px] font-semibold text-brand-deep">
              {ship ? <Check aria-hidden className="h-4 w-4" /> : <HandCoins aria-hidden className="h-4 w-4" />}
              Chọn
            </span>
            {!ship && <ChevronRight aria-hidden className="hidden h-5 w-5 shrink-0 text-ink-subtle md:block" />}
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

/**
 * Khách đang nợ những khoản nào: ngày ghi nợ, mã đơn, món, số tiền (tiền đã trả trừ vào đơn cũ nhất trước).
 * Tải lại khi dư nợ đổi (vừa thu nợ / máy khác ghi nợ).
 */
export function DebtDetails({ customerId, balance }: { customerId: string; balance: Money }) {
  const [history, setHistory] = useState<DebtHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    tabletStore.api
      .loadDebtHistory(customerId)
      .then((h) => alive && setHistory(h))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [customerId, balance]);

  if (error) return <p className="text-[15px] text-danger-strong" data-testid="debt-history-error">{error}</p>;
  if (!history) return <p className="text-[15px] text-ink-subtle">Đang tải các khoản nợ…</p>;

  const paid = history.payments.reduce((s, p) => s + p.amount, 0);
  const open = openDebtOrders(history.orders, paid);
  const lastPay = history.payments.at(-1);
  if (open.length === 0 && !lastPay) return null;

  return (
    <section className="card flex flex-col p-4 md:p-5" data-testid="debt-history">
      <h3 className="mb-1 text-base font-semibold text-ink-muted">Các khoản còn nợ</h3>
      {open.length === 0 && <p className="py-2 text-ink-subtle">Không còn khoản nào.</p>}
      <ul className="flex flex-col">
        {open.map((o) => (
          <li key={o.id} className="flex items-start gap-3 border-t border-line py-3 first:border-t-0" data-testid={`debt-open-${o.id}`}>
            <span aria-hidden className="icon-tile mt-0.5 h-9 w-9 rounded-full bg-warning-soft text-warning-strong">
              <ReceiptText className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">
                {dayTime(o.paid_at)} <span className="font-normal text-ink-subtle">· đơn #<span className="font-mono">{o.code}</span></span>
              </span>
              <span className="block text-[15px] text-ink-muted">{debtItemsText(o.items) || '—'}</span>
            </span>
            <span className="num shrink-0 text-right text-base font-bold">
              {formatVnd(o.remaining)}
              {o.remaining < o.total && <span className="block text-[13px] font-normal text-ink-subtle">/ {formatVnd(o.total)}</span>}
            </span>
          </li>
        ))}
      </ul>
      {lastPay && (
        <p className="border-t border-line pt-3 text-[15px] text-ink-muted" data-testid="debt-last-payment">
          Lần trả gần nhất: {dayTime(lastPay.at)} · {formatVnd(lastPay.amount)} ({lastPay.method === 'cash' ? 'tiền mặt' : 'chuyển khoản'})
        </p>
      )}
    </section>
  );
}
