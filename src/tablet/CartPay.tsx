import { useState } from 'react';
import { Banknote, ChevronLeft, CircleCheckBig, Landmark, NotebookPen, UserPlus, UserRound, X } from 'lucide-react';
import { canConfirmCash, changeDue, quickCashOptions } from '@/domain/cash';
import { customerLabel } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import type { Customer, Order } from '@/domain/types';
import { MoneyInput } from '@/app/MoneyInput';
import type { PaymentInput } from '@/pos';
import { ChosenCustomer, CustomerSuggestions, useDebtBook } from './debt';
import { Notice } from './parts';

/** Hình thức thanh toán (mục 4.4): một hình thức cho cả đơn, không chia, không nợ một phần. */
export type PayMethod = 'cash' | 'transfer' | 'debt';

/** Xác nhận thanh toán: `flash` là thông báo khi xong. */
export type ConfirmPay = (payment: PaymentInput, flash: string) => void;

export const PAY_METHODS = [
  { m: 'cash', label: 'Tiền mặt', short: 'Tiền mặt', Icon: Banknote, on: 'border-success bg-success-soft text-success-strong ring-1 ring-inset ring-success', icon: 'text-success' },
  { m: 'transfer', label: 'Chuyển khoản', short: 'CK', Icon: Landmark, on: 'border-info bg-info-soft text-info-strong ring-1 ring-inset ring-info', icon: 'text-info' },
  { m: 'debt', label: 'Ghi nợ', short: 'Ghi nợ', Icon: NotebookPen, on: 'border-warning bg-warning-soft text-warning-strong ring-1 ring-inset ring-warning', icon: 'text-warning' },
] as const;

/** Hàng TM · CK · Ghi nợ (trong giỏ và trong phần thanh toán). `active` = hình thức đang mở. */
export function PayMethodRow({ active, disabled, onPick, testIdPrefix }: { active: PayMethod | null; disabled?: boolean; onPick: (m: PayMethod) => void; testIdPrefix: string }) {
  return (
    <div className="grid shrink-0 grid-cols-3 gap-2 md:gap-2.5" role={active ? 'tablist' : 'group'} aria-label="Hình thức thanh toán">
      {PAY_METHODS.map(({ m, label, short, Icon, on, icon }) => (
        <button
          key={m}
          type="button"
          role={active ? 'tab' : undefined}
          aria-selected={active ? active === m : undefined}
          aria-label={label}
          disabled={disabled}
          onClick={() => onPick(m)}
          className={`btn min-h-[44px] gap-1.5 whitespace-nowrap rounded-xl border px-1 text-[15px] font-semibold md:min-h-[48px] ${
            active === m ? on : 'border-line-strong bg-surface text-ink hover:border-ink-subtle'
          }`}
          data-testid={`${testIdPrefix}-${m}`}
        >
          <Icon aria-hidden className={`h-5 w-5 shrink-0 ${active === m ? '' : icon}`} />
          {short}
        </button>
      ))}
    </div>
  );
}

/**
 * Thanh toán trong giỏ (mục 4.4), thay màn thanh toán riêng: "Cần thu" + hàng TM · CK · Ghi nợ, rồi phần của hình thức đang chọn.
 * Tiền mặt: mệnh giá "Khách đưa" + nhập tay + tiền thối. Chuyển khoản: xác nhận đã nhận. Ghi nợ: bảng {@link DebtSheet} đè lên giỏ.
 * Đơn đã được lưu trước khi mở phần này; tiền tính vào ca đang mở lúc thu.
 */
export function CartPay({
  order,
  method,
  busy,
  error,
  onMethod,
  onBack,
  onConfirm,
}: {
  order: Order;
  method: PayMethod;
  busy: boolean;
  error: string | null;
  onMethod: (m: PayMethod) => void;
  /** Về giỏ (sửa tiếp đơn). */
  onBack: () => void;
  onConfirm: ConfirmPay;
}) {
  const o = order;
  const [given, setGiven] = useState<number | null>(null);
  /** Số nhập tay (null = đang dùng nút tiền nhanh / chưa nhập). */
  const [manual, setManual] = useState<number | null>(null);
  const change = changeDue(o.total, given);
  const itemCount = o.items.reduce((s, it) => s + it.qty, 0);

  return (
    <div data-testid="cart-pay" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto md:gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <button type="button" className="btn btn-secondary min-h-[44px] pl-2.5 pr-4 text-[15px]" onClick={onBack} data-testid="pay-back">
          <ChevronLeft aria-hidden className="h-5 w-5" />
          Giỏ
        </button>
        <span className="ml-auto truncate text-[15px] text-ink-subtle" data-testid="pay-code">
          Đơn #<span className="font-mono tracking-wider">{o.code}</span> · {itemCount} món
        </span>
      </div>

      <div className="flex shrink-0 flex-col gap-1 rounded-xl border border-brand-line bg-brand-soft px-4 py-3">
        <span className="text-[15px] font-medium text-brand-deep">Cần thu</span>
        <span className="num text-[34px] font-bold leading-tight text-brand-deep" data-testid="pay-total">
          {formatVnd(o.total)}
        </span>
        {o.ship_fee > 0 && (
          <span className="num flex justify-between text-[15px] text-brand-deep" data-testid="pay-ship-fee">
            {o.ship_mode === 'external' ? 'Phụ thu' : 'Phí ship'}
            <span className="font-medium">{formatVnd(o.ship_fee)}</span>
          </span>
        )}
        {o.ship_mode === 'external' && o.ship_payout > 0 && (
          <span className="num text-[15px] font-semibold text-danger-strong" data-testid="pay-ship-payout">
            Trả shipper −{formatVnd(o.ship_payout)} (lấy từ két)
          </span>
        )}
      </div>

      <PayMethodRow active={method} onPick={onMethod} testIdPrefix="pay-method" />

      {method === 'transfer' ? (
        <div className="flex flex-1 flex-col gap-3" data-testid="pay-transfer">
          <p className="flex items-start gap-3 rounded-xl border border-info-line bg-info-soft p-4 text-base text-ink">
            <Landmark aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-info" />
            Kiểm tra đã nhận đủ {formatVnd(o.total)} trên điện thoại / loa báo rồi mới bấm.
          </p>
          <div className="flex-1" />
          <Notice testId="pay-error" tone="error">
            {error}
          </Notice>
          <button
            type="button"
            className="btn btn-success min-h-[56px] shrink-0 text-lg"
            disabled={busy}
            onClick={() => onConfirm({ method: 'transfer' }, `Đã nhận chuyển khoản – đơn ${o.code}`)}
            data-testid="pay-transfer-confirm"
          >
            <CircleCheckBig aria-hidden className="h-6 w-6" />
            Đã nhận chuyển khoản
          </button>
        </div>
      ) : (
        // Ghi nợ: phần tiền mặt không hiện, bảng ghi nợ đè lên giỏ.
        <div className={`${method === 'cash' ? 'flex' : 'hidden'} flex-1 flex-col gap-3`} data-testid={method === 'cash' ? 'pay-cash' : undefined}>
          <h3 className="text-[15px] font-semibold text-ink-muted">Khách đưa</h3>
          <div className="grid grid-cols-3 gap-2">
            {quickCashOptions(o.total).map((q) => (
              <button
                key={q.amount}
                type="button"
                aria-pressed={given === q.amount && manual === null}
                onClick={() => {
                  setManual(null);
                  setGiven(q.amount);
                }}
                className="btn btn-choice num min-h-[52px] px-1 text-base"
                data-testid={q.kind === 'exact' ? 'cash-exact' : `cash-quick-${q.amount}`}
              >
                {q.kind === 'exact' ? 'Đủ tiền' : formatVnd(q.amount)}
              </button>
            ))}
            <MoneyInput
              label="Khách đưa – nhập tay"
              srLabel
              center
              value={manual}
              onChange={(v) => {
                setManual(v);
                setGiven(v);
              }}
              testId="cash-manual"
            />
          </div>
          <div className="flex-1" />
          <div className={`flex shrink-0 items-center justify-between rounded-xl px-4 py-3 ${change !== null ? 'bg-success-soft' : 'border border-line bg-surface-muted'}`}>
            <span className={`text-base font-medium ${change !== null ? 'text-success-strong' : 'text-ink-muted'}`}>Tiền thối</span>
            <span className={`num text-2xl font-bold ${change !== null ? 'text-success-strong' : 'text-ink'}`} data-testid="cash-change">
              {change === null ? (given === null ? '—' : 'Chưa đủ') : formatVnd(change)}
            </span>
          </div>
          {method === 'cash' && (
            <Notice testId="pay-error" tone="error">
              {error}
            </Notice>
          )}
          <button
            type="button"
            className="btn btn-success min-h-[56px] shrink-0 text-lg"
            disabled={!canConfirmCash(o.total, given) || busy}
            onClick={() => onConfirm({ method: 'cash', cash_given: given! }, `Đã thu ${formatVnd(o.total)} – đơn ${o.code}`)}
            data-testid="pay-confirm"
          >
            <CircleCheckBig aria-hidden className="h-6 w-6" />
            Đã thu tiền
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Ghi nợ (mục 4.4 / 5): bảng đè lên cột giỏ. Chọn khách có sẵn, hoặc gõ tên mới (+ mô tả, SĐT tùy chọn) ⇒ tự tạo khách.
 * Đơn ship đã chọn khách ⇒ chọn sẵn khách đó (vẫn đổi được).
 */
export function DebtSheet({ order, busy, error, onClose, onConfirm }: { order: Order; busy: boolean; error: string | null; onClose: () => void; onConfirm: ConfirmPay }) {
  const o = order;
  const book = useDebtBook();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(() => (o.customer_id && book?.customers.find((c) => c.id === o.customer_id)) || null);

  function confirm() {
    const label = customer ? customerLabel(customer) : customerLabel({ name: name.trim(), description: desc.trim() || null });
    onConfirm({ method: 'debt', customer: customer ? { id: customer.id, name: customer.name } : { name, description: desc, phone } }, `Đã ghi nợ ${formatVnd(o.total)} – ${label}`);
  }

  return (
    <div className="absolute inset-0 z-20 flex items-end bg-black/45" role="dialog" aria-modal aria-label="Ghi nợ">
      <div data-testid="pay-debt" className="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-3xl bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-raised">
        <span aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-line-strong" />
        <div className="flex items-center gap-3">
          <span aria-hidden className="icon-tile h-11 w-11 rounded-full bg-warning-soft text-warning-strong">
            <NotebookPen className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="text-[22px] font-bold leading-tight">Ghi nợ</h2>
            <p className="num text-sm text-ink-subtle">
              Đơn #{o.code} · {formatVnd(o.total)}
            </p>
          </div>
          <button type="button" className="btn btn-secondary h-11 min-h-0 w-11 min-w-0 shrink-0 px-0" onClick={onClose} aria-label="Đóng" data-testid="pay-debt-close">
            <X aria-hidden className="h-5 w-5 text-ink-muted" />
          </button>
        </div>
        {customer && book ? (
          <ChosenCustomer book={book} customer={customer} onClear={() => setCustomer(null)} />
        ) : (
          <>
            <span className="relative">
              <UserRound aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
              <input className="input min-h-[52px] pl-11" placeholder="Tên khách (bắt buộc)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-testid="debt-name" />
            </span>
            {book && <CustomerSuggestions book={book} query={name} onPick={setCustomer} />}
            {name.trim() && (
              <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-muted p-4" data-testid="debt-new">
                <p className="flex items-center gap-2 text-[15px] text-ink-muted">
                  <UserPlus aria-hidden className="h-5 w-5 shrink-0" />
                  <span>
                    Không có trong danh sách ⇒ tạo khách mới <b>{name.trim()}</b>
                  </span>
                </p>
                <input className="input" placeholder="Mô tả (vd. giáo viên, 20 Lê Lợi) – tùy chọn" maxLength={80} value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="debt-desc" />
                <input className="input" placeholder="Số điện thoại – tùy chọn" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="debt-phone" />
              </div>
            )}
          </>
        )}
        <Notice testId="pay-error" tone="error">
          {error}
        </Notice>
        <button type="button" className="btn btn-danger min-h-[56px] shrink-0 text-lg" disabled={busy || (!customer && !name.trim())} onClick={confirm} data-testid="pay-debt-confirm">
          <NotebookPen aria-hidden className="h-6 w-6" />
          Ghi nợ {formatVnd(o.total)}
        </button>
      </div>
    </div>
  );
}
