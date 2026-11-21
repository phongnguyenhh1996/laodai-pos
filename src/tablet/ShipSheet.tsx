import { MapPin } from 'lucide-react';
import type { DraftCustomer } from '@/domain/cart';
import { formatVnd } from '@/domain/money';
import type { Money } from '@/domain/types';
import type { DebtBook } from '@/pos';
import { Sheet } from './parts';
import { ShipCustomerPicker } from './ShipCustomer';

/**
 * Điện thoại (Figma MS2): bảng nhập địa chỉ giao + khách của đơn ship. Chỉ mở khi bấm dòng "Địa chỉ, khách"
 * ⇒ bàn phím chỉ hiện ở bước này, không che thực đơn. Sửa thẳng vào bản nháp; Xong / X đều đóng bảng.
 */
export function ShipSheet({
  address,
  customer,
  book,
  shipFee,
  total,
  onAddress,
  onCustomer,
  onClose,
}: {
  address: string;
  customer: DraftCustomer | null;
  book: DebtBook | null;
  shipFee: Money;
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
          {shipFee > 0 ? `Phí đang chọn +${formatVnd(shipFee)}` : 'Chưa chọn phí ship'} · tổng {formatVnd(total)}
        </span>
      }
      onClose={onClose}
    >
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
            autoFocus
            value={address}
            onChange={(e) => onAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !missing) onClose();
            }}
            data-testid="order-address"
          />
        </span>
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-muted">Khách (tuỳ chọn)</span>
        <ShipCustomerPicker book={book} customer={customer} onChange={onCustomer} />
      </div>
      <button type="button" className="btn btn-primary min-h-[52px] shrink-0 text-[17px]" disabled={missing} onClick={onClose} data-testid="ship-sheet-done">
        Xong
      </button>
    </Sheet>
  );
}
