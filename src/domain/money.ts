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

// ---------------------------------------------------------------- nhập theo nghìn (MoneyInput)

/** Tối đa 6 chữ số nghìn (999.999.000đ): vừa cột `int` của Postgres, dư cho mọi số tiền của quán. */
export const MAX_THOUSAND_DIGITS = 6;

/**
 * Chữ người gõ vào ô tiền ("1.500", "1 500") → số nghìn (1500). Chỉ nhận chữ số; dấu chấm / khoảng trắng bỏ qua.
 * Rỗng, có ký tự khác hoặc quá {@link MAX_THOUSAND_DIGITS} chữ số (sau khi bỏ số 0 đầu) ⇒ null.
 */
export function thousandsFromInput(raw: string): number | null {
  const digits = raw.replace(/[\s.]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return String(n).length > MAX_THOUSAND_DIGITS ? null : n;
}

/** Số nghìn → đồng: 50 → 50.000. */
export function toVnd(thousands: number): Money {
  return thousands * 1000;
}

/**
 * Số tiền đang lưu → chữ hiện trong ô khi sửa: 1.500.000 → "1.500". Số không chia hết 1.000 (dữ liệu cũ, vd. 25.500)
 * hoặc quá dài ⇒ null để ô báo rõ, không làm tròn ngầm.
 */
export function thousandsText(vnd: Money): string | null {
  if (!Number.isSafeInteger(vnd) || vnd < 0 || vnd % 1000 !== 0) return null;
  const k = vnd / 1000;
  return String(k).length > MAX_THOUSAND_DIGITS ? null : formatVnd(k);
}
