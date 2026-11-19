// Nhân viên: SĐT, CCCD, sinh nhật, lương ngày + sổ lương theo tháng (thưởng / trừ / ứng / trả / ± ngày công).
import { CatalogError } from './catalog';
import { businessDate } from './time';
import type { Money } from './types';

/** Chỉ chủ đọc được (bảng `staff_details`, khóa = id nhân viên). */
export interface StaffDetails {
  id: string;
  phone: string | null;
  id_number: string | null;
  birthday: string | null; // YYYY-MM-DD
  /** Lương mỗi ngày công. */
  day_rate: Money;
}

export type PayrollKind = 'bonus' | 'deduction' | 'advance' | 'payment' | 'days';

export const PAYROLL_KIND_LABELS: Record<PayrollKind, string> = {
  bonus: 'Thưởng / phụ cấp',
  deduction: 'Trừ lương',
  advance: 'Ứng lương',
  payment: 'Trả lương',
  days: 'Cộng / trừ ngày công',
};

/** Nhãn ngắn cho nút chọn loại. */
export const PAYROLL_KIND_SHORT: Record<PayrollKind, string> = {
  bonus: 'Thưởng',
  deduction: 'Trừ lương',
  advance: 'Ứng lương',
  payment: 'Trả lương',
  days: '± Ngày công',
};

export interface PayrollEntry {
  id: string;
  staff_id: string;
  month: string; // YYYY-MM-01
  kind: PayrollKind;
  /** Tiền (> 0) với bonus/deduction/advance/payment; số ngày (có dấu) với days. */
  amount: number;
  note: string | null;
  at: string;
  voided_at: string | null;
}

/** Ca của nhân viên trong tháng (chỉ cần giờ mở / đóng). */
export interface WorkShift {
  id: string;
  staff_id: string;
  opened_at: string;
  closed_at: string | null;
}

// ---------------------------------------------------------------- tháng

/** "2026-11" theo giờ Việt Nam. */
export function monthOf(at: Date | string | number): string {
  return businessDate(at).slice(0, 7);
}

export function isMonth(ym: string | null | undefined): ym is string {
  return !!ym && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Khoảng thời gian [from, to) của tháng theo giờ Việt Nam (UTC+7, không đổi giờ). */
export function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01T00:00:00+07:00`, to: `${shiftMonth(ym, 1)}-01T00:00:00+07:00` };
}

export const monthFirstDay = (ym: string) => `${ym}-01`;

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `Tháng ${Number(m)}/${y}`;
}

// ---------------------------------------------------------------- SĐT, CCCD, sinh nhật

/** "090 123 4567", "+84 90 123 4567" → "0901234567"; rỗng → null. Sai định dạng ⇒ CatalogError. */
export function parsePhone(raw: string): string | null {
  let s = raw.replace(/[\s.()-]/g, '');
  if (!s) return null;
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  if (!/^0\d{9,10}$/.test(s)) throw new CatalogError('Số điện thoại: nhập 10 số, vd. 0901 234 567, hoặc để trống');
  return s;
}

/** "0901234567" → "0901 234 567". */
export function formatPhone(p: string): string {
  return p.length === 10 ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p;
}

/** "0790 9600 1234" → "079096001234"; rỗng → null. Sai định dạng ⇒ CatalogError. */
export function parseIdNumber(raw: string): string | null {
  const s = raw.replace(/[\s.-]/g, '');
  if (!s) return null;
  if (!/^\d{9}$|^\d{12}$/.test(s)) throw new CatalogError('Căn cước công dân: nhập đủ 12 số (CMND cũ 9 số), hoặc để trống');
  return s;
}

/** Ô ngày (YYYY-MM-DD từ <input type="date">); rỗng → null. */
export function parseBirthday(raw: string, today = businessDate(new Date())): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !d || d.getUTCDate() !== +m[3] || d.getUTCMonth() !== +m[2] - 1) throw new CatalogError('Sinh nhật: ngày không hợp lệ');
  if (s > today || +m[1] < 1900) throw new CatalogError('Sinh nhật: ngày không hợp lệ');
  return s;
}

/** "1998-03-12" → "12/03/1998". */
export function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

/** Số ngày tới sinh nhật kế tiếp (0 = hôm nay). 29/2 tính vào 28/2 ở năm không nhuận. */
export function daysUntilBirthday(birthday: string, today = businessDate(new Date())): number {
  const [, bm, bd] = birthday.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const t = Date.UTC(ty, tm - 1, td);
  const on = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return Date.UTC(y, bm - 1, bm === 2 && bd === 29 && !leap ? 28 : bd);
  };
  const next = on(ty) >= t ? on(ty) : on(ty + 1);
  return Math.round((next - t) / 86_400_000);
}

// ---------------------------------------------------------------- tính lương

export interface Payslip {
  rate: Money;
  /** Số ca mở trong tháng (kể cả ca đang mở). */
  shifts: number;
  /** Số ngày (giờ VN) có mở ca. */
  shiftDays: number;
  /** Ngày công sau khi chủ cộng / trừ (không âm). */
  days: number;
  /** Lương ngày công = days × rate. */
  base: Money;
  bonus: Money;
  deduction: Money;
  /** Lương tháng = base + thưởng − trừ. */
  total: Money;
  advance: Money;
  payment: Money;
  /** Còn phải trả = lương tháng − ứng − đã trả (âm = trả dư). */
  remaining: Money;
}

/**
 * Lương của một nhân viên trong tháng `ym`: chỉ tính theo ngày. Ngày công = số ngày (giờ VN) nhân viên có mở ca,
 * mở nhiều ca trong ngày vẫn là 1 ngày, ± ngày công chủ ghi. Ca tính vào tháng của ngày mở ca; dòng sổ lương đã hủy bỏ qua.
 */
export function computePayslip(
  details: Pick<StaffDetails, 'day_rate'> | null,
  shifts: readonly WorkShift[],
  entries: readonly PayrollEntry[],
  ym: string,
): Payslip {
  const rate = details?.day_rate ?? 0;
  const mine = shifts.filter((s) => monthOf(s.opened_at) === ym);
  const live = entries.filter((e) => !e.voided_at && e.month.slice(0, 7) === ym);
  const sum = (k: PayrollKind) => live.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0);

  const shiftDays = new Set(mine.map((s) => businessDate(s.opened_at))).size;
  const days = Math.max(0, shiftDays + sum('days'));
  const base = days * rate;
  const bonus = sum('bonus');
  const deduction = sum('deduction');
  const total = base + bonus - deduction;
  const advance = sum('advance');
  const payment = sum('payment');
  return { rate, shifts: mine.length, shiftDays, days, base, bonus, deduction, total, advance, payment, remaining: total - advance - payment };
}

/** 275 → "4 giờ 35 phút" (độ dài ca, chỉ để xem). */
export function formatMinutes(min: number): string {
  const sign = min < 0 ? '−' : '';
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (!h) return `${sign}${m} phút`;
  return `${sign}${h} giờ${m ? ` ${m} phút` : ''}`;
}

/** Ô "ngày công": số nguyên khác 0, có thể âm. */
export function parseDaysInput(raw: string): number | null {
  const m = /^(-?)(\d+)$/.exec(raw.trim().replace(/^−/, '-'));
  if (!m) return null;
  const v = Number(m[2]);
  return v ? (m[1] ? -v : v) : null;
}
