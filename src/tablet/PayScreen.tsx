import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Banknote, CircleCheckBig, ChevronLeft, Landmark, NotebookPen, UserPlus } from 'lucide-react';
import { canConfirmCash, changeDue, quickCashOptions } from '@/domain/cash';
import { itemsSummary } from '@/domain/cart';
import { parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { customerLabel } from '@/domain/debt';
import type { Customer } from '@/domain/types';
import { pos } from '@/lib/pos';
import { Splash, errorMessage } from '@/app/ui';
import type { PaymentInput } from '@/pos';
import { ChosenCustomer, CustomerSuggestions, useDebtBook } from './debt';
import { Notice, useTablet } from './parts';
import type { QueueFlash } from './QueueScreen';

type Method = 'cash' | 'transfer' | 'debt';

/**
 * Thanh toán (mục 4.4): một hình thức cho cả đơn (tiền mặt / chuyển khoản / ghi nợ, không chia, không nợ một phần). Tiền tính vào ca đang mở lúc thu.
 * Thanh toán xong đơn biến mất khỏi tablet, nhân viên không sửa / xem lại được nữa.
 */
export function PayScreen() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { orders } = useTablet();
  const order = orders.find((o) => o.id === orderId) ?? null;
  /** Đơn đã hiện trên màn này (để biết đơn biến mất là do máy khác thanh toán / xóa). */
  const seen = useRef(false);
  const [method, setMethod] = useState<Method>('cash');
  const [given, setGiven] = useState<number | null>(null);
  const [manual, setManual] = useState('');
  // Ghi nợ: chọn khách có sẵn, hoặc gõ tên mới (+ mô tả, SĐT tùy chọn) ⇒ tự tạo khách.
  const [debtName, setDebtName] = useState('');
  const [debtDesc, setDebtDesc] = useState('');
  const [debtPhone, setDebtPhone] = useState('');
  const [debtCustomer, setDebtCustomer] = useState<Customer | null>(null);
  const book = useDebtBook();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  if (!order) {
    // Đang thanh toán trên máy này: chờ chuyển về hàng đợi kèm thông báo.
    if (busyRef.current) return <Splash />;
    const flash = seen.current ? 'Đơn đã được thanh toán hoặc xóa ở máy khác' : null;
    return <Navigate to="/" replace state={flash ? ({ flash } satisfies QueueFlash) : null} />;
  }
  seen.current = true;
  const o = order;
  const change = changeDue(o.total, given);

  function pickQuick(amount: number) {
    setManual('');
    setGiven(amount);
  }

  function typeManual(raw: string) {
    setManual(raw);
    setGiven(parseMoneyInput(raw));
  }

  async function confirm(payment: PaymentInput, flash: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await pos.payOrder(o.id, payment);
      navigate('/', { replace: true, state: { flash } satisfies QueueFlash });
    } catch (e) {
      setError(errorMessage(e));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main data-testid="pay-screen" className="mx-auto flex h-full max-w-4xl flex-col gap-5 overflow-y-auto p-6">
      <header className="flex items-center justify-between gap-4">
        <Link to={`/order/${o.id}`} className="btn btn-secondary pl-3" data-testid="pay-back">
          <ChevronLeft aria-hidden className="h-5 w-5" />
          Đơn
        </Link>
        <div className="text-right">
          <p className="text-2xl font-bold text-ink" data-testid="pay-code">
            Đơn #<span className="font-mono tracking-wider">{o.code}</span>
            {o.label ? ` · ${o.label}` : ''}
          </p>
          <p className="text-lg text-ink-muted">{itemsSummary(o.items)}</p>
        </div>
      </header>

      <div className="flex items-baseline justify-between rounded-2xl border border-brand-line bg-brand-soft p-5 shadow-card">
        <span className="text-2xl font-medium text-brand-deep">Cần thu</span>
        <span className="num text-5xl font-bold text-ink" data-testid="pay-total">
          {formatVnd(o.total)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-surface p-1.5 shadow-card" role="tablist">
        {(
          [
            ['cash', 'Tiền mặt'],
            ['transfer', 'Chuyển khoản'],
            ['debt', 'Ghi nợ'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={method === m}
            onClick={() => setMethod(m)}
            className="btn min-h-[60px] text-xl text-ink-muted hover:bg-surface-muted aria-selected:bg-ink aria-selected:text-white"
            data-testid={`pay-method-${m}`}
          >
            {m === 'cash' ? (
              <Banknote aria-hidden className="h-6 w-6" />
            ) : m === 'transfer' ? (
              <Landmark aria-hidden className="h-6 w-6" />
            ) : (
              <NotebookPen aria-hidden className="h-6 w-6" />
            )}
            {label}
          </button>
        ))}
      </div>

      {method === 'cash' ? (
        <section className="flex flex-col gap-4" data-testid="pay-cash">
          <h2 className="eyebrow">Khách đưa</h2>
          <div className="grid grid-cols-3 gap-3">
            {quickCashOptions(o.total).map((q) => (
              <button
                key={q.amount}
                type="button"
                aria-pressed={given === q.amount && manual === ''}
                onClick={() => pickQuick(q.amount)}
                className="btn btn-choice num min-h-[64px] text-xl"
                data-testid={q.kind === 'exact' ? 'cash-exact' : `cash-quick-${q.amount}`}
              >
                {q.kind === 'exact' ? 'Đủ tiền' : formatVnd(q.amount)}
              </button>
            ))}
            <input
              className="input min-h-[64px] text-xl"
              inputMode="numeric"
              placeholder="Nhập tay"
              value={manual}
              onChange={(e) => typeManual(e.target.value)}
              data-testid="cash-manual"
            />
          </div>
          <div
            className={`flex items-baseline justify-between rounded-2xl border p-5 shadow-card ${
              change !== null ? 'border-success-line bg-success-soft' : 'border-line bg-surface'
            }`}
          >
            <span className={`text-2xl font-medium ${change !== null ? 'text-success-strong' : 'text-ink-muted'}`}>Tiền thối</span>
            <span className="num text-4xl font-bold text-ink" data-testid="cash-change">
              {change === null ? (given === null ? '—' : 'Chưa đủ') : formatVnd(change)}
            </span>
          </div>
          <Notice testId="pay-error" tone="error">
            {error}
          </Notice>
          <button
            type="button"
            className="btn btn-success min-h-[72px] text-2xl"
            disabled={!canConfirmCash(o.total, given) || busy}
            onClick={() => void confirm({ method: 'cash', cash_given: given! }, `Đã thu ${formatVnd(o.total)} – đơn ${o.code}`)}
            data-testid="pay-confirm"
          >
            <CircleCheckBig aria-hidden className="h-7 w-7" />
            Đã thu tiền
          </button>
        </section>
      ) : method === 'debt' ? (
        <section className="flex flex-col gap-4" data-testid="pay-debt">
          {debtCustomer && book ? (
            <ChosenCustomer book={book} customer={debtCustomer} onClear={() => setDebtCustomer(null)} />
          ) : (
            <>
              <input
                className="input min-h-[64px] text-xl"
                placeholder="Tên khách (bắt buộc)"
                maxLength={60}
                value={debtName}
                onChange={(e) => setDebtName(e.target.value)}
                data-testid="debt-name"
              />
              {book && <CustomerSuggestions book={book} query={debtName} onPick={setDebtCustomer} />}
              {debtName.trim() && (
                <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-surface p-4" data-testid="debt-new">
                  <p className="flex items-center gap-2 text-lg text-ink-muted">
                    <UserPlus aria-hidden className="h-5 w-5 shrink-0" />
                    Không có trong danh sách ⇒ tạo khách mới <b>{debtName.trim()}</b>
                  </p>
                  <input
                    className="input"
                    placeholder="Mô tả (vd. giáo viên, 20 Lê Lợi) – tùy chọn"
                    maxLength={80}
                    value={debtDesc}
                    onChange={(e) => setDebtDesc(e.target.value)}
                    data-testid="debt-desc"
                  />
                  <input
                    className="input"
                    placeholder="Số điện thoại – tùy chọn"
                    inputMode="tel"
                    maxLength={20}
                    value={debtPhone}
                    onChange={(e) => setDebtPhone(e.target.value)}
                    data-testid="debt-phone"
                  />
                </div>
              )}
            </>
          )}
          <Notice testId="pay-error" tone="error">
            {error}
          </Notice>
          <button
            type="button"
            className="btn btn-danger min-h-[72px] text-2xl"
            disabled={busy || (!debtCustomer && !debtName.trim())}
            onClick={() =>
              void confirm(
                {
                  method: 'debt',
                  customer: debtCustomer
                    ? { id: debtCustomer.id, name: debtCustomer.name }
                    : { name: debtName, description: debtDesc, phone: debtPhone },
                },
                `Đã ghi nợ ${formatVnd(o.total)} – ${debtCustomer ? customerLabel(debtCustomer) : customerLabel({ name: debtName.trim(), description: debtDesc.trim() || null })}`,
              )
            }
            data-testid="pay-debt-confirm"
          >
            <NotebookPen aria-hidden className="h-6 w-6" />
            Ghi nợ {formatVnd(o.total)}
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-4" data-testid="pay-transfer">
          <p className="flex items-start gap-3 rounded-2xl border border-info-line bg-info-soft p-4 text-xl text-ink">
            <Landmark aria-hidden className="mt-1 h-6 w-6 shrink-0 text-info" />
            Kiểm tra đã nhận đủ {formatVnd(o.total)} trên điện thoại / loa báo rồi mới bấm.
          </p>
          <Notice testId="pay-error" tone="error">
            {error}
          </Notice>
          <button
            type="button"
            className="btn btn-success min-h-[72px] text-2xl"
            disabled={busy}
            onClick={() => void confirm({ method: 'transfer' }, `Đã nhận chuyển khoản – đơn ${o.code}`)}
            data-testid="pay-transfer-confirm"
          >
            <CircleCheckBig aria-hidden className="h-7 w-7" />
            Đã nhận chuyển khoản
          </button>
        </section>
      )}
    </main>
  );
}
