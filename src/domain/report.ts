// Số liệu hiển thị của dashboard / báo cáo chủ (mục 7, màn chủ 1 & 4). Hàm thuần.
import { waitColor, type WaitColor } from './queue';
import { formatSigned, formatVnd } from './money';
import type { ShipStats } from './reconcile';
import type { Money, OrderStatus } from './types';

/**
 * Thống kê ship (SPEC 5, chỉ chủ) thành các dòng hiển thị; mỗi dòng chỉ hiện khi > 0
 * (lãi/lỗ ship ngoài hiện khi có đơn shipper ngoài, kể cả lỗ). Không có số liệu (server cũ) ⇒ rỗng.
 */
export function shipStatLines(s: ShipStats | null | undefined): Array<{ key: keyof ShipStats; label: string; value: string }> {
  if (!s) return [];
  const out: Array<{ key: keyof ShipStats; label: string; value: string }> = [];
  if (s.shop_orders > 0) out.push({ key: 'shop_orders', label: 'Quán ship', value: `${s.shop_orders} đơn` });
  if (s.external_orders > 0) out.push({ key: 'external_orders', label: 'Shipper ngoài', value: `${s.external_orders} đơn` });
  if (s.shop_fee > 0) out.push({ key: 'shop_fee', label: 'Phí ship', value: formatVnd(s.shop_fee) });
  if (s.external_fee > 0) out.push({ key: 'external_fee', label: 'Phụ thu ship ngoài', value: formatVnd(s.external_fee) });
  if (s.payout > 0) out.push({ key: 'payout', label: 'Trả shipper ngoài', value: formatVnd(s.payout) });
  if (s.external_orders > 0) out.push({ key: 'external_profit', label: 'Lãi/lỗ ship ngoài', value: formatSigned(s.external_profit) });
  return out;
}

export interface MethodSplit {
  cash: Money;
  transfer: Money;
  debt: Money;
}

/**
 * Tỷ lệ TM / CK / Nợ theo phần trăm nguyên, cộng lại đúng 100 (phần dư lớn nhất được làm tròn lên).
 * Không có doanh thu ⇒ cả ba là 0.
 */
export function methodShares(s: MethodSplit): MethodSplit {
  const keys = ['cash', 'transfer', 'debt'] as const;
  const total = s.cash + s.transfer + s.debt;
  if (total <= 0) return { cash: 0, transfer: 0, debt: 0 };
  const raw = keys.map((k) => (s[k] * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = keys.map((_, i) => i).sort((a, b) => raw[b] - out[b] - (raw[a] - out[a]) || a - b);
  for (const i of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return { cash: out[0], transfer: out[1], debt: out[2] };
}

export interface ActiveOrder {
  id: string;
  status: OrderStatus;
  created_at: string;
}

export interface WaitThresholds {
  yellow_min: number;
  red_min: number;
}

/** Đơn chờ ra món lâu (vàng / đỏ theo ngưỡng của chủ), lâu nhất trước. */
export function longWaiting<T extends ActiveOrder>(
  orders: readonly T[],
  now: Date | string | number,
  wait: WaitThresholds,
): Array<T & { color: Exclude<WaitColor, 'none' | 'normal'> }> {
  const settings = { wait_yellow_min: wait.yellow_min, wait_red_min: wait.red_min };
  return orders
    .map((o) => ({ ...o, color: waitColor(o, now, settings) }))
    .filter((o): o is T & { color: 'yellow' | 'red' } => o.color === 'yellow' || o.color === 'red')
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

/** Ngày "YYYY-MM-DD" theo giờ Việt Nam, cộng `days` ngày. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "17/11" từ "2026-11-17". */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}
