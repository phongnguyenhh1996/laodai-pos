import { describe, expect, it } from 'vitest';
import { assertMoney, formatK, formatSigned, formatVnd, thousandsFromInput, thousandsText, toVnd } from './money';
import { businessDate, hhmm, minutesBetween } from './time';

describe('money & time', () => {
  it('định dạng tiền kiểu 1.600.000', () => {
    expect(formatVnd(1_600_000)).toBe('1.600.000');
    expect(formatVnd(0)).toBe('0');
    expect(formatVnd(999)).toBe('999');
    expect(formatVnd(-20_000)).toBe('−20.000');
  });

  it('định dạng gọn theo nghìn kiểu 35k', () => {
    expect(formatK(35_000)).toBe('35k');
    expect(formatK(1_250_000)).toBe('1.250k');
    expect(formatK(25_500)).toBe('25,5k');
    expect(formatK(0)).toBe('0k');
  });

  it('chênh lệch có dấu', () => {
    expect(formatSigned(-20_000)).toBe('−20.000');
    expect(formatSigned(15_000)).toBe('+15.000');
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(6, false)).toBe('+6');
    expect(formatSigned(-6, false)).toBe('−6');
  });

  it('nhập theo nghìn: chữ gõ → số nghìn', () => {
    expect(thousandsFromInput('50')).toBe(50);
    expect(thousandsFromInput('1.500')).toBe(1500);
    expect(thousandsFromInput(' 1 500 ')).toBe(1500);
    expect(thousandsFromInput('0')).toBe(0);
    expect(thousandsFromInput('007')).toBe(7);
    expect(thousandsFromInput('999.999')).toBe(999_999);
    for (const bad of ['', ' ', '.', 'abc', '5k', '-5', '1,5', '1e3', '1.000.000', '99999999999999999999']) expect(thousandsFromInput(bad)).toBeNull();
  });

  it('nhập theo nghìn: đổi ra đồng và hiện lại khi sửa', () => {
    expect(toVnd(50)).toBe(50_000);
    expect(toVnd(1500)).toBe(1_500_000);
    expect(thousandsText(1_500_000)).toBe('1.500');
    expect(thousandsText(50_000)).toBe('50');
    expect(thousandsText(0)).toBe('0');
    expect(thousandsText(25_500)).toBeNull();
    expect(thousandsText(-1000)).toBeNull();
    expect(thousandsText(1_000_000_000)).toBeNull();
    for (const k of [0, 7, 50, 1500, 999_999]) expect(thousandsFromInput(thousandsText(toVnd(k))!)).toBe(k);
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
