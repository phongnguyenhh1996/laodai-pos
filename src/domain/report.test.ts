import { describe, expect, it } from 'vitest';
import { longWaiting, methodShares, shiftDate, shortDate } from './report';

describe('methodShares (tỷ lệ TM / CK / Nợ)', () => {
  it('chia phần trăm, cộng lại đúng 100', () => {
    expect(methodShares({ cash: 50_000, transfer: 25_000, debt: 25_000 })).toEqual({ cash: 50, transfer: 25, debt: 25 });
    const thirds = methodShares({ cash: 10_000, transfer: 10_000, debt: 10_000 });
    expect(thirds.cash + thirds.transfer + thirds.debt).toBe(100);
    expect(thirds).toEqual({ cash: 34, transfer: 33, debt: 33 });
  });

  it('phần dư lớn nhất được làm tròn lên', () => {
    // 26,3 / 52,6 / 21,05 ⇒ 26 / 53 / 21
    expect(methodShares({ cash: 25_000, transfer: 50_000, debt: 20_000 })).toEqual({ cash: 26, transfer: 53, debt: 21 });
  });

  it('chỉ một hình thức ⇒ 100%', () => {
    expect(methodShares({ cash: 0, transfer: 30_000, debt: 0 })).toEqual({ cash: 0, transfer: 100, debt: 0 });
  });

  it('không có doanh thu ⇒ 0 / 0 / 0', () => {
    expect(methodShares({ cash: 0, transfer: 0, debt: 0 })).toEqual({ cash: 0, transfer: 0, debt: 0 });
  });
});

describe('longWaiting (đơn chờ lâu trên dashboard)', () => {
  const now = '2026-11-17T03:00:00Z';
  const at = (minAgo: number) => new Date(Date.parse(now) - minAgo * 60_000).toISOString();
  const orders = [
    { id: 'normal', status: 'open' as const, created_at: at(2) },
    { id: 'red', status: 'open' as const, created_at: at(12) },
    { id: 'yellow', status: 'open' as const, created_at: at(6) },
    { id: 'served', status: 'served' as const, created_at: at(30) },
  ];

  it('chỉ đơn chờ ra món đã vàng / đỏ theo ngưỡng của chủ, lâu nhất trước', () => {
    expect(longWaiting(orders, now, { yellow_min: 5, red_min: 10 }).map((o) => [o.id, o.color])).toEqual([
      ['red', 'red'],
      ['yellow', 'yellow'],
    ]);
  });

  it('ngưỡng khác ⇒ màu khác', () => {
    expect(longWaiting(orders, now, { yellow_min: 1, red_min: 3 }).map((o) => [o.id, o.color])).toEqual([
      ['red', 'red'],
      ['yellow', 'red'],
      ['normal', 'yellow'],
    ]);
  });

  it('cùng giờ tạo ⇒ giữ thứ tự', () => {
    const same = [
      { id: 'a', status: 'open' as const, created_at: at(20) },
      { id: 'b', status: 'open' as const, created_at: at(20) },
    ];
    expect(longWaiting(same, now, { yellow_min: 5, red_min: 10 }).map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('ngày', () => {
  it('shiftDate qua tháng / năm', () => {
    expect(shiftDate('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDate('2026-11-17', -6)).toBe('2026-11-11');
  });

  it('shortDate', () => {
    expect(shortDate('2026-11-07')).toBe('07/11');
  });
});
