import { describe, expect, it } from 'vitest';
import { ORDER_CODE_ALPHABET, ORDER_CODE_SPACE, cryptoRng, generateOrderCode, isValidOrderCode, seededRng } from './orderCode';

describe('orderCode', () => {
  it('bảng chữ không có 0 O 1 I L', () => {
    for (const c of '0O1IL') expect(ORDER_CODE_ALPHABET).not.toContain(c);
  });

  it('đúng 3 ký tự, chỉ dùng bảng chữ cho phép', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 500; i++) {
      const c = generateOrderCode(new Set(), rng);
      expect(c).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/);
      expect(isValidOrderCode(c)).toBe(true);
    }
    expect(isValidOrderCode('AB')).toBe(false);
    expect(isValidOrderCode('A0B')).toBe(false);
    expect(isValidOrderCode('ABI')).toBe(false);
  });

  it('5.000 mã liên tiếp không mã nào trùng', () => {
    const used = new Set<string>();
    const rng = seededRng(7);
    for (let i = 0; i < 5000; i++) {
      const c = generateOrderCode(used, rng);
      expect(used.has(c)).toBe(false);
      used.add(c);
    }
    expect(used.size).toBe(5000);
  });

  it('dùng crypto mặc định', () => {
    const r = cryptoRng();
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
    expect(isValidOrderCode(generateOrderCode(new Set()))).toBe(true);
  });

  it('không suy ra được số thứ tự đơn: mã chỉ phụ thuộc nguồn ngẫu nhiên, không phụ thuộc số đơn', () => {
    // Cùng seed ⇒ cùng mã, dù đã bán 0 hay 300 đơn (mã đã dùng không chứa mã sinh ra)
    const fresh = generateOrderCode(new Set(), seededRng(123));
    const busy = new Set(Array.from({ length: 300 }, (_, i) => `Z${ORDER_CODE_ALPHABET[i % 31]}${ORDER_CODE_ALPHABET[Math.floor(i / 31)]}`));
    busy.delete(fresh);
    expect(generateOrderCode(busy, seededRng(123))).toBe(fresh);

    // Dãy mã liên tiếp không đơn điệu (không phải bộ đếm)
    const rng = seededRng(99);
    const used = new Set<string>();
    const seqCodes = Array.from({ length: 50 }, () => {
      const c = generateOrderCode(used, rng);
      used.add(c);
      return c;
    });
    const sorted = [...seqCodes].sort();
    expect(seqCodes).not.toEqual(sorted);
    // Seed khác ⇒ dãy khác
    expect(generateOrderCode(new Set(), seededRng(1))).not.toBe(generateOrderCode(new Set(), seededRng(2)));
  });

  it('khi gần hết mã vẫn chọn được mã còn trống; hết hẳn thì báo lỗi', () => {
    const A = ORDER_CODE_ALPHABET;
    const all: string[] = [];
    for (const a of A) for (const b of A) for (const c of A) all.push(a + b + c);
    expect(all.length).toBe(ORDER_CODE_SPACE);
    const used = new Set(all);
    used.delete('ZZZ');
    expect(generateOrderCode(used, seededRng(5))).toBe('ZZZ');
    used.add('ZZZ');
    expect(() => generateOrderCode(used, seededRng(5))).toThrow();
    // Rng luôn trả cùng một mã đã dùng ⇒ rơi xuống nhánh danh sách mã trống
    const stuck = new Set(['222']);
    expect(generateOrderCode(stuck, () => 0)).not.toBe('222');
  });
});
