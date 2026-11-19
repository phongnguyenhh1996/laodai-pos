import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, ChevronLeft, HandCoins, Landmark, Search } from 'lucide-react';
import { parseMoneyInput } from '@/domain/catalog';
import { customerLabel, debtPaymentProblem } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import type { Customer } from '@/domain/types';
import { pos } from '@/lib/pos';
import { Splash, errorMessage } from '@/app/ui';
import { ChosenCustomer, CustomerSuggestions, DebtDetails, useDebtBook } from './debt';
import { Notice } from './parts';

/**
 * Thu nợ (mục 4.5): chọn khách → thấy dư nợ → nhập số tiền + hình thức → lưu vào ca hiện tại.
 * Tiền mặt thu nợ tính vào két ca. Server báo Telegram ngay khi nhận.
 */
export function DebtScreen() {
  const book = useDebtBook();
  const [query, setQuery] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const busy = useRef(false);

  if (!book) return <Splash />;
  const balance = customer ? book.balance(customer.id) : 0;
  const parsed = parseMoneyInput(amount);

  function pick(c: Customer) {
    setCustomer(c);
    setAmount('');
    setError(null);
    setDone(null);
  }

  async function save() {
    if (!customer || busy.current) return;
    const problem = debtPaymentProblem(parsed, balance);
    if (problem) {
      setError(problem);
      return;
    }
    busy.current = true;
    setError(null);
    try {
      await pos.recordDebtPayment({ customer_id: customer.id, amount: parsed!, method });
      setDone(`Đã thu nợ ${formatVnd(parsed!)} (${method === 'cash' ? 'tiền mặt' : 'chuyển khoản'}) – ${customerLabel(customer)}`);
      setAmount('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
    }
  }

  const totalDebt = book.customers.reduce((sum, c) => sum + book.balance(c.id), 0);
  const debtors = book.customers.filter((c) => book.balance(c.id) > 0).length;

  return (
    <main data-testid="debt-screen" className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:h-[76px] md:px-6">
        <Link to="/" className="btn btn-secondary min-h-[44px] pl-3 pr-4 text-[15px]" data-testid="debt-back">
          <ChevronLeft aria-hidden className="h-5 w-5" />
          Hàng đợi
        </Link>
        <h2 className="ml-auto text-[19px] font-bold md:ml-0 md:text-2xl">Thu nợ</h2>
      </header>

      <div className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:gap-5 md:p-6">
        <div className="flex items-center gap-3 rounded-2xl border border-warning-tint bg-warning-soft px-4 py-3.5 md:justify-between">
          <span aria-hidden className="icon-tile h-11 w-11 rounded-full bg-warning-tint text-warning-strong md:hidden">
            <HandCoins className="h-[22px] w-[22px]" />
          </span>
          <p className="hidden text-[15px] text-ink-muted md:block">Khách đang ghi nợ. Chọn khách để thu một phần hoặc toàn bộ.</p>
          <span className="flex flex-col md:items-end">
            <span className="text-[13px] text-warning-strong">Tổng còn nợ · {debtors} khách</span>
            <span className="num text-2xl font-bold text-warning-strong">{formatVnd(totalDebt)}</span>
          </span>
        </div>

        <Notice testId="debt-done" tone="ok">
          {done}
        </Notice>

        {customer ? (
          <>
            <ChosenCustomer book={book} customer={customer} onClear={() => setCustomer(null)} />
            {balance > 0 && (
              <div className="card flex flex-col gap-4 p-4 md:p-5">
                <div className="grid grid-cols-2 gap-2 md:gap-3" role="group" aria-label="Hình thức">
                  {(['cash', 'transfer'] as const).map((m) => {
                    const on = method === m;
                    const Icon = m === 'cash' ? Banknote : Landmark;
                    const tone = m === 'cash' ? 'success' : 'info';
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setMethod(m)}
                        className={`flex min-h-[64px] items-center justify-center gap-2.5 rounded-2xl border text-base font-medium transition-colors duration-fast md:text-lg ${
                          on
                            ? tone === 'success'
                              ? 'border-success bg-success-soft font-semibold text-success-strong ring-1 ring-inset ring-success'
                              : 'border-info bg-info-soft font-semibold text-info-strong ring-1 ring-inset ring-info'
                            : 'border-line bg-surface text-ink-muted hover:border-line-strong'
                        }`}
                        data-testid={`debt-method-${m}`}
                      >
                        <span aria-hidden className={`icon-tile h-9 w-9 rounded-full ${tone === 'success' ? 'bg-success-tint text-success' : 'bg-info-tint text-info'}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        {m === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2.5">
                  <input
                    className="input min-h-[56px]"
                    inputMode="numeric"
                    placeholder="Số tiền thu (vd. 50k)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    data-testid="debt-amount"
                  />
                  <button type="button" className="btn btn-secondary" onClick={() => setAmount(String(balance))} data-testid="debt-pay-all">
                    Trả hết
                  </button>
                </div>
                <Notice testId="debt-error" tone="error">
                  {error}
                </Notice>
                <button type="button" className="btn btn-success min-h-[60px] text-lg md:text-[19px]" onClick={() => void save()} data-testid="debt-confirm">
                  <HandCoins aria-hidden className="h-6 w-6" />
                  {parsed ? `Thu ${formatVnd(parsed)}` : 'Thu nợ'}
                </button>
              </div>
            )}
            <DebtDetails customerId={customer.id} balance={balance} />
          </>
        ) : (
          <>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
              <input
                className="input min-h-[52px] pl-12"
                aria-label="Tìm khách"
                placeholder="Tìm khách theo tên / mô tả"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="debt-search"
              />
            </div>
            <CustomerSuggestions book={book} query={query} onPick={pick} showAllWithDebt />
          </>
        )}
      </div>
    </main>
  );
}
