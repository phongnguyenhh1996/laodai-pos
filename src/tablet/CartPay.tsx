import { useState } from 'react';
import { ChevronLeft, CircleCheck, Landmark, NotebookPen, Phone, UserPlus, UserRound, X } from 'lucide-react';
import { canConfirmCash, changeDue, quickCashOptions } from '@/domain/cash';
import { customerLabel } from '@/domain/debt';
import { formatVnd } from '@/domain/money';
import type { Customer, Order } from '@/domain/types';
import { MoneyInput } from '@/app/MoneyInput';
import { FIELD, FIELD_ICON, IconTile, PayMethodTile, SheetHandle, iconBtn, staffBtn } from '@/app/kit';
import { useIsTablet } from '@/app/useMediaQuery';
import type { PaymentInput } from '@/pos';
import { ChosenCustomer, CustomerSuggestions, useDebtBook } from './debt';
import { Notice } from './parts';

/** Hình thức thanh toán (mục 4.4): một hình thức cho cả đơn, không chia, không nợ một phần. */
export type PayMethod = 'cash' | 'transfer' | 'debt';

/** Xác nhận thanh toán: `toast` là thông báo khi xong. */
export type ConfirmPay = (payment: PaymentInput, toast: string) => void;

const PAY_METHOD_KEYS = ['cash', 'transfer', 'debt'] as const;

/** Thẻ trắng của phần thanh toán (Figma BH4: viền xám bo 14, lề 14 + viền). */
const PAY_CARD = 'flex shrink-0 flex-col rounded-[14px] border border-line bg-white p-[14px]';

/** Nút mệnh giá "Khách đưa" (cao 45): đang chọn nền cam nhạt, viền cam 1.5. */
const cashBtn = (on: boolean) =>
  `num flex h-[45px] min-w-0 items-center justify-center rounded-xl px-1 text-[15px] font-semibold leading-[19px] transition-colors duration-fast ${
    on ? 'border-[1.5px] border-brand bg-[#ffeee7] text-[#c2380a]' : 'border border-line bg-white text-[#111] hover:border-[#cfcfcf]'
  }`;

/** Dòng "nhãn … số tiền" trong thẻ Cần thu (chữ 14). */
function AmountLine({ label, value, danger, testId }: { label: string; value: string; danger?: boolean; testId?: string }) {
  return (
    <span className={`num flex items-center justify-between gap-3 text-sm leading-[18px] ${danger ? 'font-semibold text-[#b91c1c]' : 'text-[#6d6d6d]'}`} data-testid={testId}>
      <span>{label}</span>
      <span className={danger ? '' : 'font-semibold text-[#111]'}>{value}</span>
    </span>
  );
}

/**
 * Thanh toán trong giỏ (mục 4.4), thay màn thanh toán riêng (Figma BH4 / BH10 / BH11, BHP6 / BHP7): "‹ Giỏ", thẻ "Cần thu",
 * "Hình thức thanh toán" (tablet ô dọc trong thẻ, điện thoại ô ngang không thẻ), rồi phần của hình thức đang chọn; nút xác nhận ở chân.
 * Tiền mặt: mệnh giá "Khách đưa" + "Số khác" + tiền thối. Chuyển khoản: xác nhận đã nhận. Ghi nợ: bảng {@link DebtSheet} đè lên giỏ.
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
  const isTablet = useIsTablet();
  const [given, setGiven] = useState<number | null>(null);
  /** Số nhập tay (null = đang dùng nút tiền nhanh / chưa nhập). */
  const [manual, setManual] = useState<number | null>(null);
  const change = changeDue(o.total, given);
  const itemCount = o.items.reduce((s, it) => s + it.qty, 0);
  const quick = quickCashOptions(o.total);
  const external = o.ship_mode === 'external';

  const methods = (
    <div className={`grid shrink-0 grid-cols-3 gap-2.5`} role="tablist" aria-label="Hình thức thanh toán">
      {PAY_METHOD_KEYS.map((m) => (
        <PayMethodTile key={m} method={m} inline={!isTablet} selected={method === m} role="tab" aria-selected={method === m} onClick={() => onMethod(m)} data-testid={`pay-method-${m}`} />
      ))}
    </div>
  );

  return (
    <div data-testid="cart-pay" className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto md:gap-3 md:bg-[#f6f6f6] md:p-4">
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] border border-line bg-white pl-2 pr-3 text-sm font-semibold leading-[18px] text-[#111] transition-colors duration-fast hover:bg-[#f8f8f8]"
            onClick={onBack}
            data-testid="pay-back"
          >
            <ChevronLeft aria-hidden className="h-[18px] w-[18px]" />
            Giỏ
          </button>
          <span className="ml-auto truncate text-[13px] leading-4 text-[#888]" data-testid="pay-code">
            Đơn #{o.code} · {itemCount} món
          </span>
        </div>

        <div className={`${PAY_CARD} gap-2.5`}>
          <AmountLine label={`Tiền món (${itemCount})`} value={formatVnd(o.total - o.ship_fee)} />
          {o.ship_fee > 0 && <AmountLine label={external ? 'Phụ thu' : 'Phí ship'} value={formatVnd(o.ship_fee)} testId="pay-ship-fee" />}
          <span aria-hidden className="h-px bg-line" />
          <span className="flex items-center justify-between gap-3">
            <span className="text-base font-bold leading-5 text-[#111]">Cần thu</span>
            <span className="num text-[26px] font-bold leading-[33px] text-brand" data-testid="pay-total">
              {formatVnd(o.total)}
            </span>
          </span>
          {external && o.ship_payout > 0 && <AmountLine danger label="Trả shipper (lấy từ két)" value={`−${formatVnd(o.ship_payout)}`} testId="pay-ship-payout" />}
        </div>

        {isTablet ? (
          <div className={`${PAY_CARD} gap-2.5`}>
            <h3 className="text-[13px] font-semibold leading-4 text-[#6d6d6d]">Hình thức thanh toán</h3>
            {methods}
          </div>
        ) : (
          methods
        )}

        {method === 'transfer' ? (
          <p className="flex shrink-0 items-start gap-2.5 rounded-xl bg-[#eaf1fe] px-3.5 py-3 text-[13px] leading-[19px] text-[#1d4ed8]" data-testid="pay-transfer">
            <Landmark aria-hidden className="h-[18px] w-[18px] shrink-0" />
            Kiểm tra đã nhận đủ {formatVnd(o.total)} trên điện thoại / loa báo rồi mới bấm.
          </p>
        ) : (
          // Ghi nợ: phần tiền mặt ẩn (giữ số đã chọn khi quay lại), bảng ghi nợ đè lên giỏ.
          <div className={`${method === 'cash' ? 'flex' : 'hidden'} shrink-0 flex-col gap-2.5 md:gap-3`} data-testid={method === 'cash' ? 'pay-cash' : undefined}>
            <div className={`${PAY_CARD} gap-2.5`}>
              <h3 className="text-sm font-bold leading-[18px] text-[#111]">Khách đưa</h3>
              <div className="grid grid-cols-3 gap-x-2 gap-y-2.5">
                {quick.map((q) => {
                  const on = given === q.amount && manual === null;
                  return (
                    <button
                      key={q.amount}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setManual(null);
                        setGiven(q.amount);
                      }}
                      className={cashBtn(on)}
                      data-testid={q.kind === 'exact' ? 'cash-exact' : `cash-quick-${q.amount}`}
                    >
                      {q.kind === 'exact' ? 'Đủ tiền' : formatVnd(q.amount)}
                    </button>
                  );
                })}
                {/* "Số khác" lấp phần còn lại của hàng cuối (đủ 3 nút thì xuống hàng riêng, Figma BH4 / BH10). */}
                <MoneyInput
                  label="Khách đưa – nhập tay"
                  srLabel
                  size="owner"
                  placeholder="Số khác "
                  className={['col-span-3', 'col-span-2', 'col-span-1'][quick.length % 3]}
                  value={manual}
                  onChange={(v) => {
                    setManual(v);
                    setGiven(v);
                  }}
                  testId="cash-manual"
                />
              </div>
            </div>
            <div
              className={`flex h-[58px] shrink-0 items-center justify-between gap-3 rounded-[14px] px-4 ${change !== null ? 'bg-[#e8f7ee] text-[#15803d]' : 'border border-line bg-white text-[#6d6d6d]'}`}
            >
              <span className="text-[15px] font-semibold leading-[19px]">Tiền thối</span>
              <span className={`num font-bold ${change !== null ? 'text-2xl leading-[30px]' : given === null ? 'text-[22px] leading-7 text-[#888]' : 'text-base leading-5 text-[#888]'}`} data-testid="cash-change">
                {change === null ? (given === null ? '—' : 'Chưa đủ') : formatVnd(change)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Chân (Figma BH4): nút xác nhận cam. Ghi nợ: bảng đè lên, nút tiền mặt nằm dưới lớp tối. */}
      <div className="flex shrink-0 flex-col gap-2 pt-3 md:border-t md:border-line md:bg-white md:px-4 md:pb-4 md:pt-[13px]">
        {method !== 'debt' && (
          <Notice testId="pay-error" tone="error">
            {error}
          </Notice>
        )}
        {method === 'transfer' ? (
          <button
            type="button"
            className={staffBtn('primary', 'lg', 'w-full')}
            disabled={busy}
            onClick={() => onConfirm({ method: 'transfer' }, `Đã nhận chuyển khoản – đơn ${o.code}`)}
            data-testid="pay-transfer-confirm"
          >
            <CircleCheck aria-hidden />
            Đã nhận chuyển khoản
          </button>
        ) : (
          <button
            type="button"
            className={staffBtn('primary', 'lg', 'w-full')}
            disabled={!canConfirmCash(o.total, given) || busy}
            onClick={() => onConfirm({ method: 'cash', cash_given: given! }, `Đã thu ${formatVnd(o.total)} – đơn ${o.code}`)}
            data-testid="pay-confirm"
          >
            <CircleCheck aria-hidden />
            Đã thu tiền
          </button>
        )}
      </div>
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
      <div
        data-testid="pay-debt"
        className="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] md:rounded-t-[20px]"
      >
        <SheetHandle />
        <div className="flex shrink-0 items-center gap-3">
          <IconTile icon={NotebookPen} className="h-11 w-11 rounded-xl" iconClass="h-[22px] w-[22px]" tone="bg-[#fef5e1] text-[#a16207]" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="text-xl font-bold leading-[25px] text-[#111]">Ghi nợ</h2>
            <p className="num truncate text-xs leading-[15px] text-[#888]">
              Đơn #{o.code} · {formatVnd(o.total)}
            </p>
          </div>
          <button type="button" className={iconBtn('h-9 w-9')} onClick={onClose} aria-label="Đóng" data-testid="pay-debt-close">
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
        {customer && book ? (
          <ChosenCustomer book={book} customer={customer} onClear={() => setCustomer(null)} />
        ) : (
          <>
            <span className="relative shrink-0">
              <UserRound aria-hidden className={FIELD_ICON} />
              <input className={`${FIELD} pl-[39px]`} placeholder="Tên khách (bắt buộc)" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} data-testid="debt-name" />
            </span>
            {book && <CustomerSuggestions book={book} query={name} onPick={setCustomer} compact />}
            {name.trim() && (
              <div className="flex shrink-0 flex-col gap-2.5 rounded-[14px] bg-[#f8f8f8] p-3" data-testid="debt-new">
                <p className="flex items-start gap-2 text-[13px] leading-[18px] text-[#6d6d6d]">
                  <UserPlus aria-hidden className="mt-px h-4 w-4 shrink-0" />
                  <span>Không có trong danh sách ⇒ tạo khách mới “{name.trim()}”</span>
                </p>
                <input className={FIELD} placeholder="Mô tả (vd. giáo viên, 20 Lê Lợi) – tùy chọn" maxLength={80} value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="debt-desc" />
                <span className="relative">
                  <Phone aria-hidden className={FIELD_ICON} />
                  <input
                    className={`${FIELD} pl-[39px]`}
                    placeholder="Số điện thoại – tùy chọn"
                    inputMode="tel"
                    maxLength={20}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    data-testid="debt-phone"
                  />
                </span>
              </div>
            )}
          </>
        )}
        <Notice testId="pay-error" tone="error">
          {error}
        </Notice>
        <button type="button" className={staffBtn('primary', 'lg', 'w-full')} disabled={busy || (!customer && !name.trim())} onClick={confirm} data-testid="pay-debt-confirm">
          <NotebookPen aria-hidden />
          <span className="num">Ghi nợ {formatVnd(o.total)}</span>
        </button>
      </div>
    </div>
  );
}
