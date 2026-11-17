import { foldVietnamese } from './text';
import type { Customer, Money } from './types';

export interface DebtOrder {
  id: string;
  status: string;
  payment_method: string | null;
  customer_id: string | null;
  total: Money;
}

export interface DebtPaymentLite {
  customer_id: string;
  amount: Money;
}

/** Khách gốc sau khi gộp (đi theo merged_into_id, chống vòng lặp). */
export function rootCustomerId(customers: Customer[], id: string): string {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    const c = byId.get(cur);
    if (!c || !c.merged_into_id || seen.has(cur)) return cur;
    seen.add(cur);
    cur = c.merged_into_id;
  }
}

/** Dư nợ theo khách gốc = Σ đơn ghi nợ (đã thanh toán) − Σ tiền đã trả. */
export function debtBalances(
  customers: Customer[],
  orders: DebtOrder[],
  payments: DebtPaymentLite[],
): Map<string, Money> {
  const out = new Map<string, Money>();
  for (const c of customers) if (!c.merged_into_id) out.set(c.id, 0);
  const add = (cid: string, v: Money) => {
    const root = rootCustomerId(customers, cid);
    out.set(root, (out.get(root) ?? 0) + v);
  };
  for (const o of orders) {
    if (o.status === 'paid' && o.payment_method === 'debt' && o.customer_id) add(o.customer_id, o.total);
  }
  for (const p of payments) add(p.customer_id, -p.amount);
  return out;
}

export function customerBalance(
  customers: Customer[],
  orders: DebtOrder[],
  payments: DebtPaymentLite[],
  customerId: string,
): Money {
  return debtBalances(customers, orders, payments).get(rootCustomerId(customers, customerId)) ?? 0;
}

export function totalDebt(balances: Map<string, Money>): Money {
  let s = 0;
  for (const v of balances.values()) s += v;
  return s;
}

/** Chuyển một (hoặc nhiều) khoản nợ (đơn ghi nợ) sang khách khác. */
export function transferDebt<T extends DebtOrder>(orders: T[], orderIds: string[], toCustomerId: string): T[] {
  const ids = new Set(orderIds);
  for (const id of ids) {
    const o = orders.find((x) => x.id === id);
    if (!o || o.status !== 'paid' || o.payment_method !== 'debt') {
      throw new Error(`Đơn ${id} không phải khoản nợ`);
    }
  }
  return orders.map((o) => (ids.has(o.id) ? { ...o, customer_id: toCustomerId } : o));
}

export function customerLabel(c: Pick<Customer, 'name' | 'description'>): string {
  return c.description ? `${c.name} (${c.description})` : c.name;
}

/**
 * Gợi ý khách: không phân biệt dấu, khớp tên hoặc mô tả, bỏ khách đã bị gộp.
 * Khớp đầu tên xếp trước, sau đó theo tên.
 */
export function suggestCustomers(customers: Customer[], query: string, limit = 8): Customer[] {
  const q = foldVietnamese(query);
  if (!q) return [];
  const scored: Array<{ c: Customer; score: number }> = [];
  for (const c of customers) {
    if (c.merged_into_id) continue;
    const name = foldVietnamese(c.name);
    const desc = foldVietnamese(c.description ?? '');
    const phone = (c.phone ?? '').replace(/\D/g, '');
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.split(' ').some((w) => w.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    else if (desc.includes(q)) score = 3;
    else if (phone && /^\d+$/.test(q) && phone.includes(q)) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name, 'vi'))
    .slice(0, limit)
    .map((x) => x.c);
}
