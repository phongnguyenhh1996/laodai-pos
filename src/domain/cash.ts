import type { Money } from './types';

export const QUICK_DENOMINATIONS: Money[] = [50_000, 100_000, 200_000, 500_000];

export interface QuickCashOption {
  kind: 'exact' | 'denomination';
  amount: Money;
}

/** "Đủ tiền" + các mệnh giá ≥ tổng đơn (bỏ mệnh giá trùng đúng tổng). */
export function quickCashOptions(total: Money): QuickCashOption[] {
  const opts: QuickCashOption[] = [{ kind: 'exact', amount: total }];
  for (const d of QUICK_DENOMINATIONS) {
    if (d > total) opts.push({ kind: 'denomination', amount: d });
  }
  return opts;
}

export function canConfirmCash(total: Money, given: Money | null | undefined): boolean {
  return typeof given === 'number' && Number.isInteger(given) && given >= total;
}

/** Tiền thối; null nếu khách đưa thiếu. */
export function changeDue(total: Money, given: Money | null | undefined): Money | null {
  return canConfirmCash(total, given) ? (given as Money) - total : null;
}
