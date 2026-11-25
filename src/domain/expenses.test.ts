import { describe, expect, it } from 'vitest';
import { activeExpenseTotal, cleanExpenseNote, expenseStats, normalizeExpenseNote, validateExpense } from './expenses';

const e = (amount: number, note: string, at: string, voided_at: string | null = null) => ({ amount, note, at, voided_at });

describe('khoản chi', () => {
  it('ghi chú: làm sạch khoảng trắng, nhóm không phân biệt hoa thường / khoảng trắng thừa', () => {
    expect(cleanExpenseNote('  Mua   đá \n')).toBe('Mua đá');
    expect(normalizeExpenseNote('Mua đá')).toBe(normalizeExpenseNote(' mua  đá '));
    expect(normalizeExpenseNote('Mua đá')).not.toBe(normalizeExpenseNote('mua da'));
  });

  it('kiểm tra: số tiền > 0, chẵn nghìn; ghi chú bắt buộc, tối đa 80 ký tự', () => {
    expect(validateExpense(20_000, 'mua đá')).toBeNull();
    for (const bad of [null, 0, -1000, 7_500, 1.5]) expect(validateExpense(bad, 'mua đá'), String(bad)).toBe('bad_expense_amount');
    expect(validateExpense(20_000, '')).toBe('bad_expense_note');
    expect(validateExpense(20_000, '   ')).toBe('bad_expense_note');
    expect(validateExpense(20_000, 'x'.repeat(80))).toBeNull();
    expect(validateExpense(20_000, 'x'.repeat(81))).toBe('bad_expense_note');
  });

  it('tổng chi bỏ khoản đã hủy', () => {
    expect(activeExpenseTotal([])).toBe(0);
    expect(activeExpenseTotal([e(20_000, 'a', '2026-11-25T01:00:00Z'), e(50_000, 'b', '2026-11-25T01:00:00Z', '2026-11-25T02:00:00Z')])).toBe(20_000);
  });

  it('cộng theo ghi chú: nhãn = bản viết gần nhất; xếp theo tổng tiền rồi số lần', () => {
    const s = expenseStats([
      e(20_000, 'mua đá', '2026-11-25T01:00:00Z'),
      e(20_000, 'Mua  Đá', '2026-11-25T03:00:00Z'),
      e(10_000, 'mua đá', '2026-11-25T02:00:00Z'),
      e(60_000, 'ga', '2026-11-25T01:00:00Z'),
      e(5_000, 'chanh', '2026-11-25T01:00:00Z'),
      e(99_000, 'ghi nhầm', '2026-11-25T01:00:00Z', '2026-11-25T01:05:00Z'),
    ]);
    expect(s).toEqual({
      count: 5,
      total: 115_000,
      by_note: [
        { note: 'ga', count: 1, total: 60_000 },
        { note: 'Mua  Đá', count: 3, total: 50_000 },
        { note: 'chanh', count: 1, total: 5_000 },
      ],
    });
    expect(expenseStats([])).toEqual({ count: 0, total: 0, by_note: [] });
  });
});
