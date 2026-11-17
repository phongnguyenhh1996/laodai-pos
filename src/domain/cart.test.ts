import { describe, expect, it } from 'vitest';
import {
  CartError,
  addCombo,
  addLine,
  addProduct,
  canSwitchPoint,
  draftChanged,
  draftTotal,
  itemsSummary,
  lineSummary,
  newDraft,
  setDineType,
  setLineQty,
  stepLineQty,
  switchPoint,
} from './cart';
import { CANH, CHA, COMBOS, COMBO_XOI_FULL, COM_GA, COM_MENU, DUA, PRODUCTS, TOPPINGS, TRUNG, XOI_CU, XOI_GA, XOI_MENU, XOI_XEO } from './fixtures';
import { PricingError } from './pricing';
import type { Point } from './types';

const XOI_A: Point = { id: 'xoi-a', name: 'Xôi A', menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 1 };
const XOI_B: Point = { id: 'xoi-b', name: 'Xôi B', menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 2 };
const COM: Point = { id: 'com', name: 'Cơm gà', menu_id: COM_MENU, active: true, default_dine_type: 'dinein', sort: 3 };
const POINTS = [XOI_A, XOI_B, COM];

describe('cart', () => {
  it('đơn mới theo mặc định Tại chỗ / Mang về của điểm bán', () => {
    expect(newDraft(XOI_A)).toMatchObject({ point_id: 'xoi-a', dine_type: 'takeaway', items: [], label: '' });
    expect(newDraft(COM).dine_type).toBe('dinein');
  });

  it('món + 2 topping: giá = món + topping, chụp giá lúc thêm', () => {
    const items = addProduct([], 'l1', XOI_GA, [CHA, TRUNG], XOI_MENU);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'l1', product_id: XOI_GA.id, unit_price_snap: 25_000, qty: 1 });
    expect(items[0].toppings_snap.map((t) => t.id)).toEqual(['trung', 'cha']); // theo thứ tự menu
    expect(draftTotal({ items })).toBe(25_000 + 6_000 + 8_000);
  });

  it('combo bấm 1 lần là thêm; bấm lại ⇒ cùng dòng tăng số lượng', () => {
    let items = addCombo([], 'l1', COMBO_XOI_FULL, PRODUCTS, TOPPINGS, XOI_MENU);
    items = addCombo(items, 'l2', COMBO_XOI_FULL, PRODUCTS, TOPPINGS, XOI_MENU);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'l1', qty: 2 });
    expect(draftTotal({ items })).toBe(2 * 39_000);
  });

  it('cùng món nhưng khác topping / khác giá chụp ⇒ dòng riêng', () => {
    let items = addProduct([], 'l1', XOI_GA, [TRUNG], XOI_MENU);
    items = addProduct(items, 'l2', XOI_GA, [], XOI_MENU);
    items = addProduct(items, 'l3', XOI_GA, [CHA], XOI_MENU);
    // Giá menu đổi giữa chừng: dòng mới giá mới, không gộp vào dòng giá cũ
    items = addProduct(items, 'l4', { ...XOI_GA, price: 28_000 }, [TRUNG], XOI_MENU);
    expect(items.map((i) => i.id)).toEqual(['l1', 'l2', 'l3', 'l4']);
    // Topping cùng tập nhưng khác thứ tự chọn ⇒ vẫn là một dòng
    items = addProduct(items, 'l5', XOI_GA, [CHA, TRUNG], XOI_MENU);
    items = addProduct(items, 'l6', XOI_GA, [TRUNG, CHA], XOI_MENU);
    expect(items.find((i) => i.id === 'l5')?.qty).toBe(2);
    expect(items).toHaveLength(5);
  });

  it('không thêm được món / combo của menu khác, món đã ngừng bán', () => {
    expect(() => addProduct([], 'l1', COM_GA, [], XOI_MENU)).toThrow(CartError);
    expect(() => addCombo([], 'l1', COMBO_XOI_FULL, PRODUCTS, TOPPINGS, COM_MENU)).toThrow(CartError);
    expect(() => addProduct([], 'l1', XOI_CU, [], XOI_MENU)).toThrow(PricingError);
    expect(() => addCombo([], 'l1', COMBOS[1], PRODUCTS, TOPPINGS, XOI_MENU)).toThrow(PricingError); // topping ngừng bán
  });

  it('đổi số lượng: + / −, về 0 ⇒ bỏ dòng; số âm / lẻ bị từ chối', () => {
    let items = addProduct([], 'l1', XOI_GA, [], XOI_MENU);
    items = addProduct(items, 'l2', XOI_XEO, [], XOI_MENU);
    items = stepLineQty(items, 'l1', 1);
    expect(items[0].qty).toBe(2);
    expect(draftTotal({ items })).toBe(2 * 25_000 + 15_000);
    items = stepLineQty(items, 'l2', -1);
    expect(items.map((i) => i.id)).toEqual(['l1']);
    expect(setLineQty(items, 'l1', 5)[0].qty).toBe(5);
    expect(() => setLineQty(items, 'l1', -1)).toThrow(PricingError);
    expect(() => setLineQty(items, 'l1', 1.5)).toThrow(PricingError);
    expect(() => setLineQty(items, 'khong-co', 2)).toThrow(CartError);
    expect(() => stepLineQty(items, 'khong-co', 1)).toThrow(CartError);
  });

  it('addLine giữ nguyên mảng cũ (bất biến)', () => {
    const a = addProduct([], 'l1', XOI_GA, [], XOI_MENU);
    const b = addLine(a, { ...a[0], id: 'l2' });
    expect(a[0].qty).toBe(1);
    expect(b[0].qty).toBe(2);
  });

  it('đổi điểm bán: đơn rỗng đổi tự do; đã có món thì chỉ sang điểm cùng menu', () => {
    const empty = newDraft(XOI_A);
    expect(canSwitchPoint(empty, POINTS, COM)).toBe(true);
    const toCom = switchPoint(empty, POINTS, COM);
    expect(toCom).toMatchObject({ point_id: 'com', dine_type: 'dinein' }); // theo mặc định Cơm gà

    const withXoi = { ...empty, items: addProduct([], 'l1', XOI_GA, [], XOI_MENU) };
    expect(canSwitchPoint(withXoi, POINTS, COM)).toBe(false);
    expect(() => switchPoint(withXoi, POINTS, COM)).toThrow(CartError);
    expect(canSwitchPoint(withXoi, POINTS, XOI_B)).toBe(true);
    expect(switchPoint(withXoi, POINTS, XOI_B).point_id).toBe('xoi-b');
    // Điểm hiện tại không còn trong danh mục ⇒ không đoán menu
    expect(canSwitchPoint({ ...withXoi, point_id: 'mat-tich' }, POINTS, XOI_B)).toBe(false);
  });

  it('đã tự chọn Tại chỗ / Mang về thì đổi điểm bán không ghi đè', () => {
    const d = setDineType(newDraft(XOI_A), 'dinein');
    expect(d.dine_type_touched).toBe(true);
    expect(switchPoint(d, POINTS, XOI_B).dine_type).toBe('dinein');
    const d2 = setDineType(newDraft(COM), 'takeaway');
    expect(switchPoint(d2, POINTS, XOI_A).dine_type).toBe('takeaway');
  });

  it('tóm tắt món', () => {
    let items = addProduct([], 'l1', COM_GA, [CANH, DUA], COM_MENU);
    items = stepLineQty(items, 'l1', 1);
    items = addProduct(items, 'l2', COM_GA, [], COM_MENU);
    expect(lineSummary(items[0])).toBe('2× Cơm gà (Canh, Dưa)');
    expect(itemsSummary(items)).toBe('2× Cơm gà (Canh, Dưa) · 1× Cơm gà');
  });

  it('draftChanged: chỉ khi khác đơn đã lưu', () => {
    const items = addProduct([], 'l1', XOI_GA, [TRUNG], XOI_MENU);
    const saved = { point_id: 'xoi-a', dine_type: 'takeaway' as const, label: null, items };
    const d = { ...newDraft(XOI_A), items };
    expect(draftChanged(d, saved)).toBe(false);
    expect(draftChanged({ ...d, label: '  ' }, saved)).toBe(false);
    expect(draftChanged({ ...d, label: 'Bàn 3' }, saved)).toBe(true);
    expect(draftChanged({ ...d, label: 'Bàn 3' }, { ...saved, label: 'Bàn 3' })).toBe(false);
    expect(draftChanged({ ...d, dine_type: 'dinein' }, saved)).toBe(true);
    expect(draftChanged({ ...d, point_id: 'xoi-b' }, saved)).toBe(true);
    expect(draftChanged({ ...d, items: stepLineQty(items, 'l1', 1) }, saved)).toBe(true);
    expect(draftChanged({ ...d, items: [] }, saved)).toBe(true);
    expect(draftChanged({ ...d, items: [{ ...items[0], id: 'khac' }] }, saved)).toBe(true);
    expect(draftChanged({ ...d, items: [{ ...items[0], toppings_snap: [] }] }, saved)).toBe(true);
  });
});
