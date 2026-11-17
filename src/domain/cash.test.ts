import { describe, expect, it } from 'vitest';
import { canConfirmCash, changeDue, quickCashOptions } from './cash';

describe('cash', () => {
  it('nút mệnh giá nhanh chỉ hiện mệnh giá ≥ tổng đơn', () => {
    expect(quickCashOptions(35_000).map((o) => o.amount)).toEqual([35_000, 50_000, 100_000, 200_000, 500_000]);
    expect(quickCashOptions(120_000).map((o) => o.amount)).toEqual([120_000, 200_000, 500_000]);
    expect(quickCashOptions(600_000).map((o) => o.amount)).toEqual([600_000]);
  });

  it('"Đủ tiền" luôn đứng đầu, không lặp khi tổng = mệnh giá', () => {
    const opts = quickCashOptions(100_000);
    expect(opts[0]).toEqual({ kind: 'exact', amount: 100_000 });
    expect(opts.map((o) => o.amount)).toEqual([100_000, 200_000, 500_000]);
  });

  it('khách đưa nhỏ hơn tổng thì không cho xác nhận', () => {
    expect(canConfirmCash(35_000, 30_000)).toBe(false);
    expect(canConfirmCash(35_000, null)).toBe(false);
    expect(canConfirmCash(35_000, undefined)).toBe(false);
    expect(canConfirmCash(35_000, 35_000.5)).toBe(false);
    expect(changeDue(35_000, 30_000)).toBeNull();
    expect(canConfirmCash(35_000, 35_000)).toBe(true);
  });

  it('tính tiền thối', () => {
    expect(changeDue(35_000, 35_000)).toBe(0);
    expect(changeDue(35_000, 50_000)).toBe(15_000);
    expect(changeDue(35_000, 500_000)).toBe(465_000);
  });
});
