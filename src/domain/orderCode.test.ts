import { describe, expect, it } from 'vitest';
import {
  ORDER_CODE_LETTERS,
  ORDER_CODE_SPACE,
  allOrderCodes,
  cryptoRng,
  generateOrderCode,
  isValidOrderCode,
  seededRng,
} from './orderCode';

describe('orderCode', () => {
  it('chữ đầu không có I L O', () => {
    for (const c of 'ILO') expect(ORDER_CODE_LETTERS).not.toContain(c);
    expect(ORDER_CODE_SPACE).toBe(2300);
  });

  it('đúng 1 chữ + 2 số', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 500; i++) {
      const c = generateOrderCode(new Set(), rng);
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$/);
      expect(isValidOrderCode(c)).toBe(true);
    }
    for (const ok of ['A00', 'A30', 'F15', 'Z99']) expect(isValidOrderCode(ok)).toBe(true);
    for (const bad of ['A3', 'A300', 'I30', 'L30', 'O30', 'a30', '3A0', 'AB1', '7KQ']) expect(isValidOrderCode(bad)).toBe(false);
  });

  it('2.000 mã liên tiếp không mã nào trùng', () => {
    const used = new Set<string>();
    const rng = seededRng(7);
    for (let i = 0; i < 2000; i++) {
      const c = generateOrderCode(used, rng);
      expect(used.has(c)).toBe(false);
      used.add(c);
    }
    expect(used.size).toBe(2000);
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
    const busy = new Set(allOrderCodes().filter((c) => c !== fresh).slice(-300));
    expect(generateOrderCode(busy, seededRng(123))).toBe(fresh);

    // Dãy mã liên tiếp không đơn điệu (không phải bộ đếm)
    const rng = seededRng(99);
    const used = new Set<string>();
    const seqCodes = Array.from({ length: 50 }, () => {
      const c = generateOrderCode(used, rng);
      used.add(c);
      return c;
    });
    expect(seqCodes).not.toEqual([...seqCodes].sort());
    // Seed khác ⇒ dãy khác
    expect(generateOrderCode(new Set(), seededRng(1))).not.toBe(generateOrderCode(new Set(), seededRng(2)));
  });

  it('khi gần hết mã vẫn chọn được mã còn trống; hết hẳn thì báo lỗi', () => {
    const all = allOrderCodes();
    expect(all.length).toBe(ORDER_CODE_SPACE);
    expect(new Set(all).size).toBe(ORDER_CODE_SPACE);
    const used = new Set(all);
    used.delete('Z99');
    expect(generateOrderCode(used, seededRng(5))).toBe('Z99');
    used.add('Z99');
    expect(() => generateOrderCode(used, seededRng(5))).toThrow();
    // Rng luôn trả cùng một mã đã dùng ⇒ rơi xuống nhánh danh sách mã trống
    const stuck = new Set(['A00']);
    expect(generateOrderCode(stuck, () => 0)).not.toBe('A00');
  });
});
