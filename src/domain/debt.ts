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

/**
 * Thu nợ: số tiền nguyên dương và không vượt dư nợ hiện có (không để khách thành "nợ âm").
 * Trả lý do không hợp lệ, hoặc null nếu được.
 */
export function debtPaymentProblem(amount: Money | null, balance: Money): string | null {
  if (balance <= 0) return 'Khách này không còn nợ';
  if (amount === null || !Number.isInteger(amount) || amount <= 0) return 'Nhập số tiền thu';
  if (amount > balance) return 'Số tiền lớn hơn dư nợ';
  return null;
}

/** Một dòng món trong khoản nợ: tên + số lượng + tên topping. */
export interface DebtItem {
  name: string;
  qty: number;
  toppings: string[];
}

/** Đơn ghi nợ (khoản nợ) kèm món. */
export interface DebtHistoryOrder {
  id: string;
  code: string;
  paid_at: string;
  total: Money;
  items: DebtItem[];
}

export interface DebtHistoryPayment {
  id: string;
  at: string;
  amount: Money;
  method: 'cash' | 'transfer';
}

export interface DebtHistory {
  orders: DebtHistoryOrder[];
  payments: DebtHistoryPayment[];
}

/** "2 Xôi gà (trứng, chả), 1 Trà đá". */
export function debtItemsText(items: DebtItem[]): string {
  return items
    .map((i) => `${i.qty} ${i.name}${i.toppings.length ? ` (${i.toppings.join(', ')})` : ''}`)
    .join(', ');
}

export interface OpenDebtOrder extends DebtHistoryOrder {
  /** Phần còn nợ của đơn này (≤ total). */
  remaining: Money;
}

/**
 * Các khoản nợ còn chưa trả: tiền khách đã trả trừ dần vào đơn cũ nhất trước.
 * Trả mới nhất ở trên.
 */
export function openDebtOrders(orders: DebtHistoryOrder[], paidTotal: Money): OpenDebtOrder[] {
  let paid = Math.max(0, paidTotal);
  const out: OpenDebtOrder[] = [];
  for (const o of [...orders].sort((a, b) => a.paid_at.localeCompare(b.paid_at))) {
    const used = Math.min(paid, o.total);
    paid -= used;
    if (o.total - used > 0) out.push({ ...o, remaining: o.total - used });
  }
  return out.reverse();
}
