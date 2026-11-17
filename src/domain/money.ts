import type { Money } from './types';

const MINUS = '−'; // dấu trừ "−" như trong báo cáo

/** 1600000 → "1.600.000" */
export function formatVnd(amount: Money): string {
  const abs = Math.abs(Math.round(amount));
  const s = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return amount < 0 ? MINUS + s : s;
}

/** Chênh lệch có dấu: −20.000, +6, 0 */
export function formatSigned(n: number, money = true): string {
  const body = money ? formatVnd(Math.abs(n)) : String(Math.abs(n));
  if (n > 0) return '+' + body;
  if (n < 0) return MINUS + body;
  return body;
}

export function assertMoney(n: unknown): asserts n is Money {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw new RangeError(`Số tiền không hợp lệ: ${String(n)}`);
  }
}
