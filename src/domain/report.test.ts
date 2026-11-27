import { describe, expect, it } from 'vitest';
import type { ShipStats } from './reconcile';
import { longWaiting, methodShares, shiftDate, shipStatLines, shortDate } from './report';

const EMPTY_SHIP_STATS: ShipStats = { shop_orders: 0, external_orders: 0, shop_fee: 0, external_fee: 0, payout: 0, external_profit: 0 };

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

describe('shipStatLines (thống kê ship, chỉ chủ)', () => {
  it('chỉ dòng > 0; lãi/lỗ ship ngoài hiện khi có đơn shipper ngoài, kể cả lỗ; không có số liệu ⇒ rỗng', () => {
    expect(shipStatLines(undefined)).toEqual([]);
    expect(shipStatLines(EMPTY_SHIP_STATS)).toEqual([]);
    expect(shipStatLines({ ...EMPTY_SHIP_STATS, shop_orders: 2, shop_fee: 20_000 }).map((l) => `${l.label} ${l.value}`)).toEqual(['Quán ship 2 đơn', 'Phí ship 20.000']);
    expect(
      shipStatLines({ shop_orders: 0, external_orders: 3, shop_fee: 0, external_fee: 15_000, payout: 30_000, external_profit: -15_000 }).map((l) => `${l.label} ${l.value}`),
    ).toEqual(['Shipper ngoài 3 đơn', 'Phụ thu ship ngoài 15.000', 'Trả shipper ngoài 30.000', 'Lãi/lỗ ship ngoài −15.000']);
    expect(shipStatLines({ ...EMPTY_SHIP_STATS, external_orders: 1, payout: 10_000, external_fee: 10_000 }).at(-1)).toMatchObject({ value: '0' });
  });
});
