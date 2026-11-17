import { rootCustomerId } from '@/domain/debt';
import type { Customer, Money } from '@/domain/types';
import { META, getMeta, type LaodaiDB } from './db';

/**
 * Sổ nợ trên tablet = danh sách khách + dư nợ tải về cùng danh mục (`Catalog.customers/balances`)
 * cộng "nhật ký nợ tại máy": các khoản ghi nợ / thu nợ làm trên máy mà danh mục chưa phản ánh
 * (còn trong outbox, hoặc đã đồng bộ sau lần tải danh mục gần nhất). Nhờ vậy dư nợ đúng ngay, kể cả khi offline.
 */

export interface DebtJournalEntry {
  op_id: string;
  customer_id: string;
  /** +tổng đơn khi ghi nợ, −số tiền khi thu nợ. */
  delta: Money;
  /** Khách mới tạo ngay trên máy (ghi nợ cho tên mới), chưa có trong danh mục. */
  new_customer: Customer | null;
  at: string;
  /** Thời điểm server nhận (null = còn trong outbox). */
  synced_at: string | null;
}

export async function loadDebtJournal(db: LaodaiDB): Promise<DebtJournalEntry[]> {
  return (await getMeta<DebtJournalEntry[]>(db, META.debtJournal)) ?? [];
}

/** Gọi trong cùng transaction (có bảng meta) với thao tác ghi outbox. */
export async function appendDebtJournal(db: LaodaiDB, entry: DebtJournalEntry): Promise<void> {
  const cur = await loadDebtJournal(db);
  await db.meta.put({ key: META.debtJournal, value: [...cur, entry] });
}

/** Sau khi gửi op: server nhận ⇒ ghi thời điểm; server từ chối ⇒ bỏ khoản đó (nợ không hề được ghi). */
export async function settleDebtJournal(db: LaodaiDB, opId: string, accepted: boolean, at: string): Promise<void> {
  const cur = await loadDebtJournal(db);
  if (!cur.some((e) => e.op_id === opId)) return;
  const next = accepted ? cur.map((e) => (e.op_id === opId ? { ...e, synced_at: at } : e)) : cur.filter((e) => e.op_id !== opId);
  await db.meta.put({ key: META.debtJournal, value: next });
}

/** Danh mục tải bắt đầu từ `fetchedAt` đã gồm các khoản đồng bộ trước thời điểm đó ⇒ bỏ khỏi nhật ký. */
export function pruneDebtJournal(entries: DebtJournalEntry[], fetchedAt: string): DebtJournalEntry[] {
  return entries.filter((e) => e.synced_at === null || e.synced_at >= fetchedAt);
}

/** Có khoản đã đồng bộ nhưng danh mục chưa tải lại ⇒ nên làm mới danh mục để lấy dư nợ từ server. */
export function hasSettledDebt(entries: DebtJournalEntry[]): boolean {
  return entries.some((e) => e.synced_at !== null);
}

export interface DebtBook {
  /** Khách (đã bỏ khách bị gộp) gồm cả khách mới tạo trên máy. */
  customers: Customer[];
  balance(customerId: string): Money;
}

export function debtBook(
  catalog: { customers: Customer[]; balances: Record<string, Money>; fetched_at: string } | undefined,
  journal: DebtJournalEntry[],
): DebtBook {
  const base = catalog?.customers ?? [];
  const known = new Set(base.map((c) => c.id));
  const added = journal.flatMap((e) => (e.new_customer && !known.has(e.new_customer.id) ? [e.new_customer] : []));
  const all = [...base, ...added.filter((c, i) => added.findIndex((x) => x.id === c.id) === i)];
  const pending = pruneDebtJournal(journal, catalog?.fetched_at ?? '');
  const balances = new Map<string, Money>(Object.entries(catalog?.balances ?? {}));
  for (const e of pending) {
    const root = rootCustomerId(all, e.customer_id);
    balances.set(root, (balances.get(root) ?? 0) + e.delta);
  }
  return {
    customers: all.filter((c) => !c.merged_into_id),
    balance: (id) => balances.get(rootCustomerId(all, id)) ?? 0,
  };
}
