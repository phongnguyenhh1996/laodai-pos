import { useState } from 'react';
import { UserPlus, UserRound, X } from 'lucide-react';
import { v7 as uuidv7 } from 'uuid';
import { toDraftCustomer, type DraftCustomer } from '@/domain/cart';
import { customerLabel } from '@/domain/debt';
import type { DebtBook } from '@/pos';
import { CustomerSuggestions } from './debt';

/**
 * Khách của đơn ship (tùy chọn), giống chọn khách ở Thu nợ: gõ tên / mô tả / SĐT ⇒ gợi ý từ danh sách khách.
 * Không có ⇒ thêm khách mới (tên + SĐT), server tạo khách khi lưu đơn. Chọn khách ⇒ điền sẵn địa chỉ giao gần nhất.
 */
export function ShipCustomerPicker({
  book,
  customer,
  autoFocus = false,
  onChange,
}: {
  book: DebtBook | null;
  customer: DraftCustomer | null;
  autoFocus?: boolean;
  onChange: (c: DraftCustomer | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<{ name: string; phone: string } | null>(null);

  if (customer) {
    return (
      <div className="flex shrink-0 items-center gap-3 rounded-xl border border-line bg-surface-muted px-3 py-2" data-testid="ship-customer-chosen">
        <span aria-hidden className="icon-tile h-9 w-9 rounded-full bg-warning-soft text-warning-strong">
          <UserRound className="h-5 w-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold" data-testid="ship-customer-label">
            {customerLabel(customer)}
          </span>
          {(customer.phone || customer.is_new) && (
            <span className="truncate text-sm text-ink-muted">
              {[customer.phone, customer.is_new ? 'Khách mới' : null].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn btn-secondary min-h-[40px] shrink-0 px-3 text-sm"
          onClick={() => {
            setQuery('');
            onChange(null);
          }}
          data-testid="ship-customer-clear"
        >
          Đổi
        </button>
      </div>
    );
  }

  if (adding) {
    const name = adding.name.trim();
    return (
      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-dashed border-line-strong bg-surface-muted p-3" data-testid="ship-customer-new-form">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
          <UserPlus aria-hidden className="h-4 w-4 shrink-0" />
          Thêm khách mới
        </p>
        <input
          className="input min-h-[44px] text-base"
          aria-label="Tên khách"
          placeholder="Tên khách (bắt buộc)"
          maxLength={60}
          autoFocus={!adding.name}
          value={adding.name}
          onChange={(e) => setAdding({ ...adding, name: e.target.value })}
          data-testid="ship-customer-new-name"
        />
        <input
          className="input min-h-[44px] text-base"
          aria-label="Số điện thoại"
          placeholder="Số điện thoại (tùy chọn)"
          inputMode="tel"
          maxLength={20}
          value={adding.phone}
          onChange={(e) => setAdding({ ...adding, phone: e.target.value })}
          data-testid="ship-customer-new-phone"
        />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary min-h-[44px] text-sm" onClick={() => setAdding(null)} data-testid="ship-customer-new-cancel">
            Thôi
          </button>
          <button
            type="button"
            className="btn btn-primary min-h-[44px] text-sm"
            disabled={!name}
            onClick={() => {
              onChange({ id: uuidv7(), name, description: null, phone: adding.phone.trim() || null, address: null, is_new: true });
              setAdding(null);
              setQuery('');
            }}
            data-testid="ship-customer-new-ok"
          >
            Chọn khách này
          </button>
        </div>
      </div>
    );
  }

  const q = query.trim();
  /** Gõ số ⇒ coi là SĐT khi thêm khách mới. */
  const isPhone = /^[\d\s.+-]+$/.test(q);
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <span className="relative">
        <UserRound aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
        <input
          className="input min-h-[48px] pl-11 pr-10 text-base"
          aria-label="Khách ship"
          placeholder="Khách: tên / SĐT (tùy chọn)"
          maxLength={60}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="ship-customer-search"
        />
        {q && (
          <button
            type="button"
            aria-label="Xóa ô tìm khách"
            className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-muted"
            onClick={() => setQuery('')}
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        )}
      </span>
      {q && (
        <>
          {book && <CustomerSuggestions book={book} query={q} onPick={(c) => onChange(toDraftCustomer(c))} ship limit={5} />}
          <button
            type="button"
            className="btn btn-secondary min-h-[44px] justify-start gap-2 text-left text-sm"
            onClick={() => setAdding(isPhone ? { name: '', phone: q } : { name: q, phone: '' })}
            data-testid="ship-customer-new"
          >
            <UserPlus aria-hidden className="h-5 w-5 shrink-0" />
            <span className="min-w-0 truncate">
              Thêm khách mới <b>{q}</b>
            </span>
          </button>
        </>
      )}
    </div>
  );
}
