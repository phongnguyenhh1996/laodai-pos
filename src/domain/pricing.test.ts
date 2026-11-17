import { describe, expect, it } from 'vitest';
import {
  PricingError, buildComboItem, buildItem, comboPrice, lineTotal, orderTotal,
  selectableCombos, selectableProducts, selectableToppings, setItemQty,
} from './pricing';
import { CHA, COMBOS, COMBO_PATE, COMBO_XOI_FULL, COM_GA, COM_MENU, CANH, PATE_CU, PRODUCTS, TOPPINGS, TRUNG, XOI_CU, XOI_GA, XOI_MENU, XOI_XEO } from './fixtures';

describe('pricing', () => {
  it('tổng đơn = Σ (giá món + Σ topping) × số lượng', () => {
    const a = buildItem('i1', XOI_GA, [TRUNG, CHA], 2); // (25k + 6k + 8k) × 2
    const b = buildItem('i2', XOI_XEO, [], 3); // 15k × 3
    expect(lineTotal(a)).toBe(78_000);
    expect(lineTotal(b)).toBe(45_000);
    expect(orderTotal([a, b])).toBe(123_000);
    expect(orderTotal([])).toBe(0);
  });

  it('combo = đúng tổng các thành phần', () => {
    expect(comboPrice(COMBO_XOI_FULL, PRODUCTS, TOPPINGS)).toBe(25_000 + 6_000 + 8_000);
    const item = buildComboItem('i', COMBO_XOI_FULL, PRODUCTS, TOPPINGS, 2);
    expect(item.product_id).toBe('xoi-ga');
    expect(item.toppings_snap.map((t) => t.id)).toEqual(['trung', 'cha']);
    expect(lineTotal(item)).toBe(78_000);
  });

  it('giá trong đơn là ảnh chụp: đổi giá menu sau đó không làm đổi đơn', () => {
    const p = { ...XOI_GA };
    const t = { ...TRUNG };
    const item = buildItem('i', p, [t], 1);
    p.price = 99_000;
    t.price = 99_000;
    expect(item.unit_price_snap).toBe(25_000);
    expect(item.toppings_snap[0].price).toBe(6_000);
    expect(item.name_snap).toBe('Xôi gà');
  });

  it('món / topping ngừng bán không xuất hiện trong lưới chọn', () => {
    expect(selectableProducts(PRODUCTS, XOI_MENU).map((p) => p.id)).toEqual(['xoi-ga', 'xoi-xeo']);
    expect(selectableProducts(PRODUCTS, COM_MENU).map((p) => p.id)).toEqual(['com-ga']);
    expect(selectableToppings(TOPPINGS, XOI_MENU).map((t) => t.id)).toEqual(['trung', 'cha']);
    // Combo chứa topping ngừng bán cũng bị ẩn
    expect(selectableCombos(COMBOS, PRODUCTS, TOPPINGS, XOI_MENU).map((c) => c.id)).toEqual(['combo-xoi-full']);
    expect(selectableCombos([{ ...COMBO_XOI_FULL, active: false }], PRODUCTS, TOPPINGS, XOI_MENU)).toEqual([]);
    expect(selectableCombos([{ ...COMBO_XOI_FULL, product_id: 'xoi-cu' }], PRODUCTS, TOPPINGS, XOI_MENU)).toEqual([]);
  });

  it('không cho bán món / topping / combo đã ngừng', () => {
    expect(() => buildItem('i', XOI_CU, [])).toThrow(PricingError);
    expect(() => buildItem('i', XOI_XEO, [PATE_CU])).toThrow(PricingError);
    expect(() => buildComboItem('i', COMBO_PATE, PRODUCTS, TOPPINGS)).toThrow(PricingError);
    expect(() => buildComboItem('i', { ...COMBO_XOI_FULL, active: false }, PRODUCTS, TOPPINGS)).toThrow(PricingError);
    expect(() => buildComboItem('i', { ...COMBO_XOI_FULL, product_id: 'nope' }, PRODUCTS, TOPPINGS)).toThrow(PricingError);
    expect(() => buildComboItem('i', { ...COMBO_XOI_FULL, topping_ids: ['nope'] }, PRODUCTS, TOPPINGS)).toThrow(PricingError);
  });

  it('không cho topping khác menu', () => {
    expect(() => buildItem('i', COM_GA, [TRUNG])).toThrow(PricingError);
    expect(() => buildItem('i', XOI_GA, [CANH])).toThrow(PricingError);
  });

  it('số lượng 0, âm hoặc lẻ bị từ chối', () => {
    for (const q of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildItem('i', XOI_GA, [], q)).toThrow(PricingError);
    }
    const it1 = buildItem('i', XOI_GA, []);
    expect(() => setItemQty(it1, 0)).toThrow(PricingError);
    expect(setItemQty(it1, 4).qty).toBe(4);
  });
});
