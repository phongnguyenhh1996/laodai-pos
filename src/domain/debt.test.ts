import { describe, expect, it } from 'vitest';
import { customerBalance, customerLabel, debtBalances, rootCustomerId, suggestCustomers, totalDebt, transferDebt, type DebtOrder } from './debt';
import { foldVietnamese } from './text';
import type { Customer } from './types';

const C = (id: string, name: string, description: string | null = null, merged_into_id: string | null = null, phone: string | null = null): Customer =>
  ({ id, name, description, phone, merged_into_id });

const customers = [
  C('c1', 'Dũng', 'giáo viên'),
  C('c2', 'Dũng', 'phường B'),
  C('c3', 'Cô Hoa', '20 Lê Lợi', null, '0909 123 456'),
  C('c4', 'Dung cũ', null, 'c1'),
  C('c5', 'Đào', 'chợ'),
];

const debtOrder = (id: string, customer_id: string, total: number, extra: Partial<DebtOrder> = {}): DebtOrder =>
  ({ id, status: 'paid', payment_method: 'debt', customer_id, total, ...extra });

const orders: DebtOrder[] = [
  debtOrder('o1', 'c1', 30_000),
  debtOrder('o2', 'c2', 25_000),
  debtOrder('o3', 'c2', 15_000),
  debtOrder('o4', 'c4', 10_000), // khách đã gộp vào c1
  debtOrder('o5', 'c1', 99_000, { payment_method: 'cash' }),
  debtOrder('o6', 'c1', 99_000, { status: 'deleted' }),
];
const payments = [{ customer_id: 'c2', amount: 20_000 }, { customer_id: 'c4', amount: 5_000 }];

describe('debt', () => {
  it('dư nợ = Σ đơn ghi nợ − Σ đã trả, tính trên khách gốc', () => {
    const b = debtBalances(customers, orders, payments);
    expect(b.get('c1')).toBe(30_000 + 10_000 - 5_000);
    expect(b.get('c2')).toBe(25_000 + 15_000 - 20_000);
    expect(b.get('c3')).toBe(0);
    expect(b.has('c4')).toBe(false);
    expect(customerBalance(customers, orders, payments, 'c4')).toBe(35_000);
  });

  it('khách gốc: đi theo chuỗi gộp và chống vòng lặp', () => {
    const chain = [C('a', 'A', null, 'b'), C('b', 'B', null, 'c'), C('c', 'C')];
    expect(rootCustomerId(chain, 'a')).toBe('c');
    const loop = [C('x', 'X', null, 'y'), C('y', 'Y', null, 'x')];
    expect(['x', 'y']).toContain(rootCustomerId(loop, 'x'));
    expect(rootCustomerId(chain, 'unknown')).toBe('unknown');
  });

  it('chuyển khoản nợ sang khách khác: tổng nợ toàn hệ thống không đổi', () => {
    const before = debtBalances(customers, orders, payments);
    const moved = transferDebt(orders, ['o2'], 'c1');
    const after = debtBalances(customers, moved, payments);
    expect(totalDebt(after)).toBe(totalDebt(before));
    expect(after.get('c1')).toBe(before.get('c1')! + 25_000);
    expect(after.get('c2')).toBe(before.get('c2')! - 25_000);
    expect(orders.find((o) => o.id === 'o2')!.customer_id).toBe('c2'); // không sửa mảng gốc
  });

  it('chỉ chuyển được đơn ghi nợ đã thanh toán', () => {
    expect(() => transferDebt(orders, ['o5'], 'c2')).toThrow();
    expect(() => transferDebt(orders, ['o6'], 'c2')).toThrow();
    expect(() => transferDebt(orders, ['nope'], 'c2')).toThrow();
  });

  it('gợi ý khách: không phân biệt dấu, khớp cả mô tả, bỏ khách đã gộp', () => {
    expect(suggestCustomers(customers, 'dung').map(customerLabel)).toEqual(['Dũng (giáo viên)', 'Dũng (phường B)']);
    expect(suggestCustomers(customers, 'giao vien').map((c) => c.id)).toEqual(['c1']);
    expect(suggestCustomers(customers, 'le loi').map((c) => c.id)).toEqual(['c3']);
    expect(suggestCustomers(customers, 'dao').map((c) => c.id)).toEqual(['c5']);
    expect(suggestCustomers(customers, 'hoa').map((c) => c.id)).toEqual(['c3']); // khớp từ thứ 2 của tên
    expect(suggestCustomers(customers, 'oa').map((c) => c.id)).toEqual(['c3']); // khớp giữa tên
    expect(suggestCustomers(customers, '123').map((c) => c.id)).toEqual(['c3']); // SĐT
    expect(suggestCustomers(customers, 'cu')).toEqual([]); // "Dung cũ" đã gộp
    expect(suggestCustomers(customers, '   ')).toEqual([]);
    expect(suggestCustomers(customers, 'zzz')).toEqual([]);
  });

  it('nhãn khách', () => {
    expect(customerLabel({ name: 'Dũng', description: 'giáo viên' })).toBe('Dũng (giáo viên)');
    expect(customerLabel({ name: 'Lan', description: null })).toBe('Lan');
  });

  it('foldVietnamese', () => {
    expect(foldVietnamese('  ĐÀO   Thị  Dũng ')).toBe('dao thi dung');
  });
});
