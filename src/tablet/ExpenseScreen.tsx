import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, ChevronLeft, Wallet, X } from 'lucide-react';
import { activeExpenseTotal, cleanExpenseNote, validateExpense } from '@/domain/expenses';
import { formatVnd } from '@/domain/money';
import { hhmm } from '@/domain/time';
import type { Money, ShiftExpense } from '@/domain/types';
import { pos } from '@/lib/pos';
import { MoneyInput } from '@/app/MoneyInput';
import { errorMessage } from '@/app/ui';
import { rejectMessage } from '@/pos';
import { Notice, Sheet, useTablet } from './parts';

/**
 * Chi tiền (SPEC 4.9, Figma E1–E6): ghi khoản chi lấy tiền mặt từ két của ca đang mở.
 * Số tiền (nhập theo nghìn) + ghi chú bắt buộc; nút ghi chú gần đây chỉ điền ghi chú. Lưu qua màn xác nhận to.
 * Danh sách bên cạnh là các khoản của ca đang mở (cả khoản chủ ghi) và tổng đã chi; nhân viên chỉ hủy khoản mình ghi.
 */
export function ExpenseScreen() {
  const { shift, expenses } = useTablet();
  const [amount, setAmount] = useState<Money | null>(null);
  const [note, setNote] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState<ShiftExpense | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void pos.recentExpenseNotes().then((n) => alive && setRecent(n));
    return () => {
      alive = false;
    };
  }, []);

  const live = expenses.filter((e) => e.voided_at === null);
  const total = activeExpenseTotal(expenses);
  const clean = cleanExpenseNote(note);

  function review() {
    const problem = validateExpense(amount, note);
    if (problem) {
      setError(rejectMessage(problem));
      return;
    }
    setError(null);
    setDone(null);
    setConfirming(true);
  }

  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      setConfirming(false);
      const e = await pos.createExpense({ amount, note });
      setDone(`Đã ghi chi ${formatVnd(e.amount)}đ – ${e.note}`);
      setAmount(null);
      setNote('');
      void pos.recentExpenseNotes().then(setRecent);
    });

  const doVoid = (e: ShiftExpense) =>
    run(async () => {
      setVoiding(null);
      setError(null);
      await pos.voidExpense(e.id);
      setDone(`Đã hủy khoản chi ${formatVnd(e.amount)}đ – ${e.note}`);
    });

  return (
    <main data-testid="expense-screen" className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:h-[76px] md:px-6">
        <Link to="/" className="btn btn-secondary min-h-[44px] pl-3 pr-4 text-[15px] md:hidden" data-testid="expense-back">
          <ChevronLeft aria-hidden className="h-5 w-5" />
          Hàng đợi
        </Link>
        <h2 className="ml-auto text-[19px] font-bold md:ml-0 md:text-2xl">Chi tiền</h2>
      </header>

      <div className="mx-auto grid w-full max-w-5xl min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4 md:grid-cols-[1fr_380px] md:gap-5 md:p-6">
        <form
          className="card flex flex-col gap-4 p-4 md:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-xl font-bold md:text-[22px]">Lấy tiền mặt từ két</h3>
            <p className="text-[15px] text-ink-subtle">Ghi lại mỗi lần lấy tiền két đi mua đồ. Chủ nhận tin ngay.</p>
          </div>
          <MoneyInput label="Số tiền" value={amount} onChange={setAmount} icon={Banknote} testId="expense-amount" />
          <label className="flex flex-col gap-2">
            <span className="text-base font-medium text-ink-muted">Ghi chú (bắt buộc)</span>
            <input
              className="input min-h-[56px] text-lg"
              placeholder="VD: mua đá"
              maxLength={80}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="expense-note"
            />
          </label>
          {recent.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-ink-subtle">Ghi chú gần đây</span>
              <div className="flex flex-wrap gap-2">
                {recent.map((n) => {
                  const on = n === clean;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setNote(n)}
                      className={`min-h-[44px] rounded-full border px-4 text-base font-medium transition-colors duration-fast ${
                        on ? 'border-brand bg-brand-soft text-brand-deep' : 'border-line bg-surface text-ink-muted hover:border-line-strong'
                      }`}
                      data-testid="expense-recent"
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Notice testId="expense-error" tone="error">
            {error}
          </Notice>
          <Notice testId="expense-done" tone="ok">
            {done}
          </Notice>
          <button type="submit" className="btn btn-primary min-h-[60px] text-lg md:text-[19px]" disabled={busy} data-testid="expense-save">
            <Wallet aria-hidden className="h-6 w-6" />
            {amount ? `Chi ${formatVnd(amount)}đ` : 'Chi tiền'}
          </button>
        </form>

        {/* Không dùng overflow-hidden: trong grid cuộn, item có overflow khác visible bị co về min 0 → danh sách bị cắt, không cuộn tới được. */}
        <section className="card flex flex-col" data-testid="expense-list">
          <div className="flex items-center justify-between gap-3 border-b border-line p-4">
            <span className="flex flex-col">
              <span className="text-lg font-bold">Khoản chi ca này</span>
              <span className="text-sm text-ink-subtle">{live.length} khoản</span>
            </span>
            <span className="flex flex-col items-end">
              <span className="text-[13px] text-ink-subtle">Tổng đã chi</span>
              <span className="num text-2xl font-bold" data-testid="expense-total">
                {formatVnd(total)}đ
              </span>
            </span>
          </div>
          {expenses.length === 0 ? (
            <p className="p-4 text-[15px] text-ink-subtle">Chưa có khoản chi nào trong ca này.</p>
          ) : (
            <ul className="flex flex-col">
              {expenses.map((e) => {
                const voided = e.voided_at !== null;
                return (
                  <li
                    key={e.id}
                    data-testid="expense-row"
                    data-voided={voided || undefined}
                    data-owner={e.actor_kind === 'owner' || undefined}
                    className={`flex min-h-[68px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 ${voided ? 'text-ink-subtle' : ''}`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={`num text-lg font-semibold ${voided ? 'line-through' : ''}`}>{formatVnd(e.amount)}đ</span>
                      <span className={`truncate text-[15px] ${voided ? 'line-through' : 'text-ink-muted'}`}>
                        {e.note} · {hhmm(e.at)}
                      </span>
                    </span>
                    {voided ? (
                      <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[13px] font-medium text-ink-subtle">Đã hủy</span>
                    ) : e.actor_kind === 'owner' ? (
                      <span className="rounded-full bg-info-soft px-2.5 py-1 text-[13px] font-medium text-info-strong">Chủ ghi</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary min-h-[44px] px-3.5 text-[15px] text-danger-strong"
                        onClick={() => {
                          setDone(null);
                          setVoiding(e);
                        }}
                        disabled={busy}
                        data-testid="expense-void"
                      >
                        <X aria-hidden className="h-4 w-4" />
                        Hủy
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {confirming && amount !== null && (
        <Sheet testId="expense-confirm-sheet" title={`Chi ${formatVnd(amount)}đ – ${clean}?`} subtitle={`Tiền mặt lấy từ két ca của ${shift?.staff_name ?? ''}. Chủ nhận tin Telegram ngay.`}>
          <p className="num rounded-2xl bg-brand-soft py-5 text-center text-[44px] font-bold leading-none text-brand-deep">{formatVnd(amount)}đ</p>
          <p className="text-center text-xl font-semibold">{clean}</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn btn-secondary min-h-[60px] text-lg" onClick={() => setConfirming(false)} data-testid="expense-edit">
              Sửa lại
            </button>
            <button type="button" className="btn btn-primary min-h-[60px] text-lg" disabled={busy} onClick={() => void save()} data-testid="expense-confirm">
              Chi tiền
            </button>
          </div>
        </Sheet>
      )}
      {voiding && (
        <Sheet testId="expense-void-sheet" title="Hủy khoản chi này?" subtitle="Ghi nhầm thì hủy rồi ghi lại. Chủ nhận tin Telegram.">
          <p className="flex items-center justify-between rounded-2xl border border-line bg-surface-sunken px-4 py-3.5 text-lg">
            <span>
              {voiding.note} · {hhmm(voiding.at)}
            </span>
            <b className="num">{formatVnd(voiding.amount)}đ</b>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn btn-secondary min-h-[60px] text-lg" onClick={() => setVoiding(null)} data-testid="expense-void-cancel">
              Không
            </button>
            <button type="button" className="btn btn-danger min-h-[60px] text-lg" disabled={busy} onClick={() => void doVoid(voiding)} data-testid="expense-void-confirm">
              Hủy khoản chi
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
