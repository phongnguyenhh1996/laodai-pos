import { rootCustomerId } from '@/domain/debt';
import type { Customer, Money } from '@/domain/types';

/** Sổ nợ trên tablet: khách + dư nợ theo khách gốc, lấy từ server cùng danh mục (cập nhật qua Realtime). */
export interface DebtBook {
  /** Khách (đã bỏ khách bị gộp). */
  customers: Customer[];
  balance(customerId: string): Money;
}

export function debtBook(catalog: { customers: Customer[]; balances: Record<string, Money> } | undefined): DebtBook {
  const all = catalog?.customers ?? [];
  const balances = catalog?.balances ?? {};
  return {
    customers: all.filter((c) => !c.merged_into_id),
    balance: (id) => balances[rootCustomerId(all, id)] ?? 0,
  };
}
