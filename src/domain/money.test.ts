import { describe, expect, it } from 'vitest';
import { assertMoney, formatSigned, formatVnd } from './money';
import { businessDate, hhmm, minutesBetween } from './time';

describe('money & time', () => {
  it('định dạng tiền kiểu 1.600.000', () => {
    expect(formatVnd(1_600_000)).toBe('1.600.000');
    expect(formatVnd(0)).toBe('0');
    expect(formatVnd(999)).toBe('999');
    expect(formatVnd(-20_000)).toBe('−20.000');
  });

  it('chênh lệch có dấu', () => {
    expect(formatSigned(-20_000)).toBe('−20.000');
    expect(formatSigned(15_000)).toBe('+15.000');
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(6, false)).toBe('+6');
    expect(formatSigned(-6, false)).toBe('−6');
  });

  it('assertMoney', () => {
    expect(() => assertMoney(1000)).not.toThrow();
    expect(() => assertMoney(-1)).toThrow();
    expect(() => assertMoney(1.5)).toThrow();
    expect(() => assertMoney('1')).toThrow();
  });

  it('giờ & ngày theo Asia/Ho_Chi_Minh', () => {
    expect(hhmm('2026-11-17T22:42:00Z')).toBe('05:42');
    expect(businessDate('2026-11-17T22:42:00Z')).toBe('2026-11-18');
    expect(businessDate('2026-11-17T16:59:00Z')).toBe('2026-11-17');
    expect(minutesBetween('2026-11-17T22:00:00Z', '2026-11-17T22:30:00Z')).toBe(30);
  });
});
