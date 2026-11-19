import { describe, expect, it } from 'vitest';
import { CatalogError } from './catalog';
import {
  computePayslip, daysUntilBirthday, formatMinutes, formatPhone, monthGrid, monthOf, parseDayOffReason, monthRange, parseBirthday, parseDaysInput,
  parseIdNumber, parsePhone, shiftMonth, workDays, type PayrollEntry, type WorkShift,
} from './payroll';

const shift = (id: string, opened: string, closed: string | null): WorkShift => ({ id, staff_id: 's', opened_at: opened, closed_at: closed });
const entry = (kind: PayrollEntry['kind'], amount: number, extra: Partial<PayrollEntry> = {}): PayrollEntry => ({
  id: `${kind}${amount}`, staff_id: 's', month: '2026-11-01', kind, amount, note: null, at: '2026-11-20T00:00:00Z', voided_at: null, ...extra,
});

// Giờ VN = UTC+7
const SHIFTS = [
  shift('a', '2026-11-03T05:30:00+07:00', '2026-11-03T10:00:00+07:00'), // 4h30
  shift('b', '2026-11-03T15:00:00+07:00', '2026-11-03T18:15:00+07:00'), // 3h15, cùng ngày
  shift('c', '2026-11-04T05:30:00+07:00', null), // đang mở
  shift('d', '2026-10-31T23:30:00+07:00', '2026-11-01T02:00:00+07:00'), // tháng 10 (theo ngày mở)
  shift('e', '2026-11-30T23:00:00+07:00', '2026-12-01T01:00:00+07:00'), // mở 30/11 giờ VN ⇒ tháng 11 dù đóng sang 1/12
];

describe('tháng', () => {
  it('theo giờ Việt Nam', () => {
    expect(monthOf('2026-11-30T17:30:00Z')).toBe('2026-12'); // 00:30 ngày 1/12 giờ VN
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01T00:00:00+07:00', to: '2027-01-01T00:00:00+07:00' });
  });
});

describe('computePayslip (chỉ tính theo ngày)', () => {
  it('ngày công = số ngày có mở ca (kể cả ca đang mở, 2 ca cùng ngày = 1 ngày) ± ngày công; không tính theo giờ', () => {
    const p = computePayslip({ day_rate: 200_000 }, SHIFTS, [entry('days', -1)], '2026-11');
    expect(p).toMatchObject({ shifts: 4, shiftDays: 3, days: 2, base: 400_000 });
  });

  it('thưởng − trừ − ứng − đã trả; bỏ dòng đã hủy và tháng khác', () => {
    const p = computePayslip({ day_rate: 250_000 }, SHIFTS, [
      entry('bonus', 500_000),
      entry('deduction', 200_000),
      entry('advance', 100_000),
      entry('payment', 300_000),
      entry('bonus', 999_000, { voided_at: '2026-11-21T00:00:00Z' }),
      entry('bonus', 777_000, { month: '2026-10-01' }),
    ], '2026-11');
    expect(p).toMatchObject({ base: 750_000, bonus: 500_000, deduction: 200_000, total: 1_050_000, advance: 100_000, payment: 300_000, remaining: 650_000 });
  });

  it('chưa đặt lương ⇒ 0đ; ngày công không âm', () => {
    const p = computePayslip(null, SHIFTS, [entry('days', -10)], '2026-11');
    expect(p).toMatchObject({ rate: 0, days: 0, base: 0, remaining: 0 });
  });
});

describe('nhập liệu', () => {
  it('CCCD 12 số / CMND 9 số, bỏ dấu cách', () => {
    expect(parseIdNumber(' 0790 9600 1234 ')).toBe('079096001234');
    expect(parseIdNumber('123456789')).toBe('123456789');
    expect(parseIdNumber('')).toBeNull();
    expect(() => parseIdNumber('12345')).toThrow(CatalogError);
    expect(() => parseIdNumber('07909600123a')).toThrow(CatalogError);
  });

  it('sinh nhật: ngày có thật, không ở tương lai', () => {
    expect(parseBirthday('1998-03-12', '2026-11-19')).toBe('1998-03-12');
    expect(parseBirthday('', '2026-11-19')).toBeNull();
    expect(() => parseBirthday('1998-02-30', '2026-11-19')).toThrow(CatalogError);
    expect(() => parseBirthday('2027-01-01', '2026-11-19')).toThrow(CatalogError);
  });

  it('số ngày tới sinh nhật', () => {
    expect(daysUntilBirthday('1998-11-19', '2026-11-19')).toBe(0);
    expect(daysUntilBirthday('1998-11-25', '2026-11-19')).toBe(6);
    expect(daysUntilBirthday('1998-11-18', '2026-11-19')).toBe(364);
    expect(daysUntilBirthday('2000-02-29', '2027-02-27')).toBe(1);
  });

  it('số điện thoại', () => {
    expect(parsePhone(' 0901 234 567 ')).toBe('0901234567');
    expect(parsePhone('+84 90 123 4567')).toBe('0901234567');
    expect(parsePhone('090.123.4567')).toBe('0901234567');
    expect(parsePhone('')).toBeNull();
    expect(() => parsePhone('12345')).toThrow(CatalogError);
    expect(() => parsePhone('090123456a')).toThrow(CatalogError);
    expect(formatPhone('0901234567')).toBe('0901 234 567');
  });

  it('ngày công', () => {
    expect(parseDaysInput('-2')).toBe(-2);
    expect(parseDaysInput('−1')).toBe(-1);
    expect(parseDaysInput('0')).toBeNull();
    expect(parseDaysInput('1.5')).toBeNull();
    expect(formatMinutes(275)).toBe('4 giờ 35 phút');
    expect(formatMinutes(-60)).toBe('−1 giờ');
  });
});

describe('lịch tháng', () => {
  it('lưới tuần bắt đầu thứ Hai', () => {
    const nov = monthGrid('2026-11'); // 1/11/2026 là Chủ nhật
    expect(nov[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(nov.at(-1)).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(nov.flat().filter(Boolean)).toHaveLength(30);
    expect(monthGrid('2027-02')).toHaveLength(4); // 1/2/2027 là thứ Hai, 28 ngày
    expect(monthGrid('2024-02').flat().filter(Boolean)).toHaveLength(29);
  });

  it('gộp ca theo ngày mở (giờ VN), ca đang mở tính tới bây giờ', () => {
    const w = workDays(SHIFTS, new Date('2026-11-04T07:30:00+07:00'));
    expect(w.get('2026-11-03')).toEqual({ shifts: 2, minutes: 270 + 195, open: false });
    expect(w.get('2026-11-04')).toEqual({ shifts: 1, minutes: 120, open: true });
    expect(w.get('2026-11-30')).toMatchObject({ shifts: 1, minutes: 120 });
    expect(w.has('2026-11-01')).toBe(false);
  });
});

describe('ngày nghỉ', () => {
  it('lý do không bắt buộc, gọn khoảng trắng, tối đa 120 ký tự', () => {
    expect(parseDayOffReason('   ')).toBeNull();
    expect(parseDayOffReason('  Về   quê ')).toBe('Về quê');
    expect(() => parseDayOffReason('x'.repeat(121))).toThrow(CatalogError);
  });
});
