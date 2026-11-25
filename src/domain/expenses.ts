// Khoản chi giữa ca (SPEC 4.9, 5): kiểm tra trước khi gửi, ghi chú gần đây, cộng theo ghi chú.
// Cùng quy tắc với SQL: `private.clean_expense_note`, `private.expense_note_key`, `private.expense_stats`.
import type { Money, ShiftExpense } from './types';

export const EXPENSE_NOTE_MAX = 80;

/** Ghi chú lưu: bỏ khoảng trắng đầu/cuối, gộp khoảng trắng giữa (giữ hoa thường). */
export function cleanExpenseNote(note: string): string {
  return note.trim().replace(/\s+/g, ' ');
}

/** Khóa nhóm ghi chú: không phân biệt hoa thường / khoảng trắng thừa ("Mua đá" = " mua  đá "). */
export function normalizeExpenseNote(note: string): string {
  return cleanExpenseNote(note).toLowerCase();
}

export type ExpenseError = 'bad_expense_amount' | 'bad_expense_note';

/** null = hợp lệ. Số tiền > 0, chẵn nghìn; ghi chú 1–80 ký tự sau khi làm sạch. */
export function validateExpense(amount: Money | null, note: string): ExpenseError | null {
  if (amount === null || !Number.isInteger(amount) || amount <= 0 || amount % 1000 !== 0) return 'bad_expense_amount';
  const n = cleanExpenseNote(note);
  if (n.length < 1 || n.length > EXPENSE_NOTE_MAX) return 'bad_expense_note';
  return null;
}

type Active = Pick<ShiftExpense, 'amount' | 'voided_at'>;

/** Tổng các khoản chưa hủy (trừ vào tiền mặt kỳ vọng). */
export function activeExpenseTotal(expenses: ReadonlyArray<Active>): Money {
  return expenses.reduce((s, e) => (e.voided_at === null ? s + e.amount : s), 0);
}

export interface ExpenseGroup {
  /** Bản viết gần nhất của nhóm. */
  note: string;
  count: number;
  total: Money;
}

export interface ExpenseStats {
  count: number;
  total: Money;
  by_note: ExpenseGroup[];
}

/** Như `private.expense_stats`: bỏ khoản đã hủy; nhóm theo ghi chú chuẩn hóa; xếp tổng tiền ↓, số lần ↓, gần nhất ↓. */
export function expenseStats(expenses: ReadonlyArray<Pick<ShiftExpense, 'amount' | 'note' | 'at' | 'voided_at'>>): ExpenseStats {
  const live = expenses.filter((e) => e.voided_at === null);
  const groups = new Map<string, ExpenseGroup & { last: number }>();
  for (const e of live) {
    const k = normalizeExpenseNote(e.note);
    const t = Date.parse(e.at);
    const g = groups.get(k);
    if (!g) groups.set(k, { note: e.note, count: 1, total: e.amount, last: t });
    else {
      g.count += 1;
      g.total += e.amount;
      if (t > g.last) Object.assign(g, { note: e.note, last: t });
    }
  }
  const by_note = [...groups.values()]
    .sort((a, b) => b.total - a.total || b.count - a.count || b.last - a.last)
    .map(({ note, count, total }) => ({ note, count, total }));
  return { count: live.length, total: activeExpenseTotal(live), by_note };
}
