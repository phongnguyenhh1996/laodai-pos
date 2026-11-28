import type { Order, Settings } from './types';
import { minutesBetween } from './time';

export type WaitColor = 'none' | 'normal' | 'yellow' | 'red';
export type QueueGroup = 'serve' | 'pay';

export interface QueueCard {
  order: Order;
  position: number;
  group: QueueGroup;
  waitMinutes: number;
  color: WaitColor;
}

export interface QueueView {
  serve: QueueCard[];
  pay: QueueCard[];
}

export function waitColor(
  order: Pick<Order, 'status' | 'created_at'>,
  now: Date | string | number,
  settings: Pick<Settings, 'wait_yellow_min' | 'wait_red_min'>,
): WaitColor {
  if (order.status !== 'open') return 'none';
  const m = minutesBetween(order.created_at, now);
  if (m >= settings.wait_red_min) return 'red';
  if (m >= settings.wait_yellow_min) return 'yellow';
  return 'normal';
}

const byCreated = (a: Order, b: Order) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.device_seq - b.device_seq;

/**
 * Hàng đợi tablet: "Chờ ra món" (open) trước, "Chờ thanh toán" (served) sau,
 * mỗi nhóm cũ nhất ở trên; số thứ tự đánh liên tục 1, 2, 3… trên toàn hàng đợi.
 * Đơn paid/deleted không bao giờ xuất hiện.
 */
export function buildQueue(
  orders: Order[],
  now: Date | string | number,
  settings: Pick<Settings, 'wait_yellow_min' | 'wait_red_min'>,
): QueueView {
  const serve = orders.filter((o) => o.status === 'open').sort(byCreated);
  const pay = orders.filter((o) => o.status === 'served').sort(byCreated);
  let pos = 0;
  const card = (group: QueueGroup) => (order: Order): QueueCard => ({
    order,
    group,
    position: ++pos,
    waitMinutes: Math.max(0, Math.floor(minutesBetween(order.created_at, now))),
    color: waitColor(order, now, settings),
  });
  const serveCards = serve.map(card('serve'));
  const payCards = pay.map(card('pay'));
  return { serve: serveCards, pay: payCards };
}

/** Chip lọc của hàng đợi trên màn Bán hàng. */
export type QueueFilter = 'all' | QueueGroup;

/**
 * Thẻ hiện trong dải đơn theo chip đang chọn: "Tất cả" ⇒ chờ ra món trước, chờ thanh toán sau
 * (mỗi nhóm cũ nhất trước); chip nhóm ⇒ chỉ nhóm đó.
 */
export function queueStrip<T>(serve: T[], pay: T[], filter: QueueFilter): T[] {
  if (filter === 'serve') return serve;
  if (filter === 'pay') return pay;
  return [...serve, ...pay];
}

/** Số đơn trên mỗi chip lọc. */
export function queueCounts(view: QueueView): Record<QueueFilter, number> {
  return { all: view.serve.length + view.pay.length, serve: view.serve.length, pay: view.pay.length };
}
