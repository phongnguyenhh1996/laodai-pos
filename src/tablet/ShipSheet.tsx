import { MapPin } from 'lucide-react';
import type { DraftCustomer } from '@/domain/cart';
import { formatVnd } from '@/domain/money';
import { SHIP_MODE_LABELS, type Money, type ShipMode } from '@/domain/types';
import type { DebtBook } from '@/pos';
import { Sheet } from './parts';
import { ShipCustomerPicker } from './ShipCustomer';

/**
 * Điện thoại (Figma MS2): bảng nhập khách + địa chỉ giao của đơn ship. Khách ở trên vì chọn khách
 * điền sẵn địa chỉ. Chỉ mở khi bấm dòng "Địa chỉ, khách" ⇒ bàn phím chỉ hiện ở bước này. Xong / X đều đóng bảng.
 */
export function ShipSheet({
  address,
  customer,
  book,
  shipFee,
  shipMode = 'shop',
  payout = 0,
  total,
  onAddress,
  onCustomer,
  onClose,
}: {
  address: string;
  customer: DraftCustomer | null;
  book: DebtBook | null;
  shipFee: Money;
  shipMode?: ShipMode;
  /** Tiền trả shipper ngoài (không nằm trong tổng). */
  payout?: Money;
  total: Money;
  onAddress: (v: string) => void;
  onCustomer: (c: DraftCustomer | null) => void;
  onClose: () => void;
}) {
  const missing = !address.trim();
  return (
    <Sheet
      testId="ship-sheet"
      title="Giao hàng"
      subtitle={
        <span className="font-semibold text-brand-deep" data-testid="ship-sheet-summary">
          {SHIP_MODE_LABELS[shipMode]} ·{' '}
          {shipMode === 'external'
            ? `${shipFee > 0 ? `phụ thu +${formatVnd(shipFee)}` : 'không phụ thu'} · ${payout > 0 ? `trả shipper ${formatVnd(payout)}` : 'chưa chọn trả shipper'}`
            : shipFee > 0
              ? `phí đang chọn +${formatVnd(shipFee)}`
              : 'chưa chọn phí ship'}{' '}
          · tổng {formatVnd(total)}
        </span>
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-muted">Khách (tuỳ chọn)</span>
        <ShipCustomerPicker book={book} customer={customer} autoFocus={missing && !customer} onChange={onCustomer} />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-muted">Địa chỉ giao</span>
        <span className="relative">
          <MapPin aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" />
          <input
            className="input min-h-[52px] pl-11 text-base"
            aria-label="Địa chỉ giao"
            aria-invalid={missing}
            placeholder={customer?.phone ? 'Địa chỉ giao (bắt buộc)' : 'Địa chỉ giao, SĐT (bắt buộc)'}
            maxLength={200}
            value={address}
            onChange={(e) => onAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !missing) onClose();
            }}
            data-testid="order-address"
          />
        </span>
      </label>
      <button type="button" className="btn btn-primary min-h-[52px] shrink-0 text-[17px]" disabled={missing} onClick={onClose} data-testid="ship-sheet-done">
        Xong
      </button>
    </Sheet>
  );
}
