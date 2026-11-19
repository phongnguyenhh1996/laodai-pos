import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Banknote, Bike, CircleCheckBig, ChevronLeft, Landmark, NotebookPen, Receipt, ShoppingBag, UserPlus, UserRound, UtensilsCrossed } from 'lucide-react';
import { canConfirmCash, changeDue, quickCashOptions } from '@/domain/cash';
import { itemsSummary, lineSummary } from '@/domain/cart';
import { lineTotal } from '@/domain/pricing';
import { parseMoneyInput } from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { customerLabel } from '@/domain/debt';
import { DINE_LABELS, type Customer } from '@/domain/types';
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
  const book = useDebtBook();
  // Đơn ship đã chọn khách ⇒ ghi nợ chọn sẵn khách đó (vẫn đổi được).
  const [debtCustomer, setDebtCustomer] = useState<Customer | null>(
    () => (order?.customer_id && book?.customers.find((c) => c.id === order.customer_id)) || null,
  );
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
      navigate('/', { replace: true, state: { flash, paid: o } satisfies QueueFlash });
    } catch (e) {
      setError(errorMessage(e));
      busyRef.current = false;
      setBusy(false);
    }
  }

  const METHODS = [
    { m: 'cash', label: 'Tiền mặt', Icon: Banknote, on: 'border-success bg-success-soft text-success-strong ring-1 ring-inset ring-success', tile: 'bg-success-tint text-success', idle: 'bg-success-soft text-success' },
    { m: 'transfer', label: 'Chuyển khoản', Icon: Landmark, on: 'border-info bg-info-soft text-info-strong ring-1 ring-inset ring-info', tile: 'bg-info-tint text-info', idle: 'bg-info-soft text-info' },
    { m: 'debt', label: 'Ghi nợ', Icon: NotebookPen, on: 'border-warning bg-warning-soft text-warning-strong ring-1 ring-inset ring-warning', tile: 'bg-warning-tint text-warning', idle: 'bg-warning-soft text-warning' },
  ] as const;
  const DineIcon = o.dine_type === 'dinein' ? UtensilsCrossed : o.dine_type === 'takeaway' ? ShoppingBag : Bike;

  // Tablet (Figma Makaryo): thanh trên; trái = tóm tắt đơn + "Cần thu", phải = hình thức + khách đưa + xác nhận.
  // Điện thoại: một cột cuộn.
  return (
    <main data-testid="pay-screen" className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 md:h-[76px] md:px-6">
        <Link to={`/order/${o.id}`} className="btn btn-secondary min-h-[44px] pl-3 pr-4 text-[15px]" data-testid="pay-back">
          <ChevronLeft aria-hidden className="h-5 w-5" />
          Đơn
        </Link>
        <h2 className="ml-auto text-[19px] font-bold md:ml-0 md:text-xl">Thanh toán</h2>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row md:items-start md:gap-5 md:p-6">
        <section className="card flex shrink-0 flex-col gap-3.5 p-4 md:w-[360px] md:p-5 lg:w-[400px]">
          <div className="flex items-center gap-3">
            <span aria-hidden className="icon-tile h-11 w-11 rounded-xl bg-brand-soft text-brand-strong">
              <Receipt className="h-[22px] w-[22px]" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-xl font-bold text-ink" data-testid="pay-code">
                Đơn #<span className="font-mono tracking-wider">{o.code}</span>
                {o.label ? ` · ${o.label}` : ''}
              </p>
              <span className="badge w-fit rounded-md bg-info-soft px-2 text-xs text-info-strong">
                <DineIcon aria-hidden className="h-3.5 w-3.5" />
                {DINE_LABELS[o.dine_type]}
              </span>
            </div>
          </div>
          <ul className="flex flex-col gap-1.5 border-y border-line py-3 text-base" aria-label={itemsSummary(o.items)}>
            {o.items.map((it) => (
              <li key={it.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">{lineSummary(it)}</span>
                <span className="num shrink-0 font-medium">{formatVnd(lineTotal(it))}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 rounded-xl border border-brand-line bg-brand-soft px-[18px] py-4">
            <span className="text-[15px] font-medium text-brand-deep">Cần thu</span>
            <span className="num text-[34px] font-bold leading-tight text-brand-deep md:text-[40px]" data-testid="pay-total">
              {formatVnd(o.total)}
            </span>
          </div>
        </section>

        <section className="card flex min-w-0 flex-col gap-4 p-4 md:flex-1 md:gap-[18px] md:self-stretch md:p-5">
          <h3 className="text-base font-semibold md:text-lg">Hình thức thanh toán</h3>
          <div className="grid grid-cols-3 gap-2 md:gap-3" role="tablist">
            {METHODS.map(({ m, label, Icon, on, tile, idle }) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={method === m}
                onClick={() => setMethod(m)}
                className={`flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-3 text-[13px] font-medium transition-colors duration-fast md:text-[15px] ${
                  method === m ? `${on} font-semibold` : 'border-line bg-surface text-ink-muted hover:border-line-strong'
                }`}
                data-testid={`pay-method-${m}`}
              >
                <span aria-hidden className={`icon-tile h-10 w-10 rounded-full md:h-11 md:w-11 ${method === m ? tile : idle}`}>
                  <Icon className="h-5 w-5 md:h-[22px] md:w-[22px]" />
                </span>
                {label}
              </button>
            ))}
          </div>

          {method === 'cash' ? (
            <div className="flex flex-col gap-4 md:flex-1" data-testid="pay-cash">
              <h3 className="text-base font-semibold md:text-lg">Khách đưa</h3>
              <div className="grid grid-cols-3 gap-2 md:gap-2.5">
                {quickCashOptions(o.total).map((q) => (
                  <button
                    key={q.amount}
                    type="button"
                    aria-pressed={given === q.amount && manual === ''}
                    onClick={() => pickQuick(q.amount)}
                    className="btn btn-choice num min-h-[52px] px-1 text-[15px] md:min-h-[56px] md:text-[17px]"
                    data-testid={q.kind === 'exact' ? 'cash-exact' : `cash-quick-${q.amount}`}
                  >
                    {q.kind === 'exact' ? 'Đủ tiền' : formatVnd(q.amount)}
                  </button>
                ))}
                <input
                  className="input min-h-[52px] text-center text-[15px] font-semibold md:min-h-[56px] md:text-[17px]"
                  inputMode="numeric"
                  placeholder="Nhập tay…"
                  value={manual}
                  onChange={(e) => typeManual(e.target.value)}
                  data-testid="cash-manual"
                />
              </div>
              <div className="hidden flex-1 md:block" />
              <div
                className={`flex items-center justify-between rounded-xl px-4 py-3 md:px-[18px] md:py-3.5 ${
                  change !== null ? 'bg-success-soft' : 'border border-line bg-surface-muted'
                }`}
              >
                <span className={`text-base font-medium md:text-[17px] ${change !== null ? 'text-success-strong' : 'text-ink-muted'}`}>Tiền thối</span>
                <span className={`num text-2xl font-bold md:text-[28px] ${change !== null ? 'text-success-strong' : 'text-ink'}`} data-testid="cash-change">
                  {change === null ? (given === null ? '—' : 'Chưa đủ') : formatVnd(change)}
                </span>
              </div>
              <Notice testId="pay-error" tone="error">
                {error}
              </Notice>
              <button
                type="button"
                className="btn btn-success min-h-[60px] text-lg md:text-[19px]"
                disabled={!canConfirmCash(o.total, given) || busy}
                onClick={() => void confirm({ method: 'cash', cash_given: given! }, `Đã thu ${formatVnd(o.total)} – đơn ${o.code}`)}
                data-testid="pay-confirm"
              >
                <CircleCheckBig aria-hidden className="h-6 w-6" />
                Đã thu tiền
              </button>
            </div>
          ) : method === 'debt' ? (
            <div className="flex flex-col gap-4" data-testid="pay-debt">
              {debtCustomer && book ? (
                <ChosenCustomer book={book} customer={debtCustomer} onClear={() => setDebtCustomer(null)} />
              ) : (
                <>
                  <span className="relative">
                    <UserRound aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
                    <input
                      className="input min-h-[56px] pl-11"
                      placeholder="Tên khách (bắt buộc)"
                      maxLength={60}
                      value={debtName}
                      onChange={(e) => setDebtName(e.target.value)}
                      data-testid="debt-name"
                    />
                  </span>
                  {book && <CustomerSuggestions book={book} query={debtName} onPick={setDebtCustomer} />}
                  {debtName.trim() && (
                    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-muted p-4" data-testid="debt-new">
                      <p className="flex items-center gap-2 text-base text-ink-muted">
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
                className="btn btn-danger min-h-[60px] text-lg md:text-[19px]"
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
            </div>
          ) : (
            <div className="flex flex-col gap-4" data-testid="pay-transfer">
              <p className="flex items-start gap-3 rounded-2xl border border-info-line bg-info-soft p-4 text-lg text-ink">
                <Landmark aria-hidden className="mt-1 h-6 w-6 shrink-0 text-info" />
                Kiểm tra đã nhận đủ {formatVnd(o.total)} trên điện thoại / loa báo rồi mới bấm.
              </p>
              <Notice testId="pay-error" tone="error">
                {error}
              </Notice>
              <button
                type="button"
                className="btn btn-success min-h-[60px] text-lg md:text-[19px]"
                disabled={busy}
                onClick={() => void confirm({ method: 'transfer' }, `Đã nhận chuyển khoản – đơn ${o.code}`)}
                data-testid="pay-transfer-confirm"
              >
                <CircleCheckBig aria-hidden className="h-6 w-6" />
                Đã nhận chuyển khoản
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
