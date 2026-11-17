import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseMoneyInput } from '@/domain/catalog';
import { customerLabel, debtPaymentProblem } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import type { Customer } from '@/domain/types';
import { localDb } from '@/lib/localdb';
import { Splash, errorMessage } from '@/app/ui';
import { recordDebtPayment } from '@/sync';
import { ChosenCustomer, CustomerSuggestions, useDebtBook } from './debt';
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
      await recordDebtPayment(localDb, { customer_id: customer.id, amount: parsed!, method });
      setDone(`Đã thu nợ ${formatVnd(parsed!)} (${method === 'cash' ? 'tiền mặt' : 'chuyển khoản'}) – ${customerLabel(customer)}`);
      setAmount('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
    }
  }

  return (
    <main data-testid="debt-screen" className="mx-auto flex h-full max-w-3xl flex-col gap-5 overflow-y-auto p-6">
      <header className="flex items-center justify-between gap-4">
        <Link to="/" className="btn flex items-center border border-stone-300 bg-white" data-testid="debt-back">
          ‹ Hàng đợi
        </Link>
        <h2 className="text-3xl font-bold">Thu nợ</h2>
      </header>

      <Notice testId="debt-done" tone="ok">
        {done}
      </Notice>

      {customer ? (
        <>
          <ChosenCustomer book={book} customer={customer} onClear={() => setCustomer(null)} />
          {balance > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3" role="group" aria-label="Hình thức">
                {(['cash', 'transfer'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={method === m}
                    onClick={() => setMethod(m)}
                    className={`btn min-h-[64px] border text-xl ${method === m ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white'}`}
                    data-testid={`debt-method-${m}`}
                  >
                    {m === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <input
                  className="min-h-[64px] rounded-xl border border-stone-300 px-4 text-xl outline-none focus:border-amber-600"
                  inputMode="numeric"
                  placeholder="Số tiền thu (vd. 50k)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  data-testid="debt-amount"
                />
                <button type="button" className="btn border border-stone-300 bg-white" onClick={() => setAmount(String(balance))} data-testid="debt-pay-all">
                  Trả hết
                </button>
              </div>
              <Notice testId="debt-error" tone="error">
                {error}
              </Notice>
              <button type="button" className="btn min-h-[72px] bg-emerald-700 text-2xl text-white" onClick={() => void save()} data-testid="debt-confirm">
                {parsed ? `Thu ${formatVnd(parsed)}` : 'Thu nợ'}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <input
            className="min-h-[64px] rounded-xl border border-stone-300 px-4 text-xl outline-none focus:border-amber-600"
            placeholder="Tìm khách theo tên / mô tả"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="debt-search"
          />
          <CustomerSuggestions book={book} query={query} onPick={pick} showAllWithDebt />
        </>
      )}
    </main>
  );
}
