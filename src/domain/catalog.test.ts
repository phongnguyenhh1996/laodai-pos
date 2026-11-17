import { describe, expect, it } from 'vitest';
import {
  CatalogError, activeStaff, checkCombo, checkMenu, checkPoint, checkProduct, checkStaff, checkTabletProfile,
  checkTopping, menuBoard, parseCountInput, parseMoneyInput, sortCatalog, tabletPoints,
} from './catalog';
import {
  CANH, CHA, COMBOS, COMBO_XOI_FULL, COM_GA, COM_MENU, PATE_CU, PRODUCTS, TOPPINGS, TRUNG, XOI_GA, XOI_MENU,
} from './fixtures';
import type { Point, Staff, TabletProfile } from './types';

const MENUS = [{ id: XOI_MENU, name: 'Xôi' }, { id: COM_MENU, name: 'Cơm gà' }];
const point = (p: Partial<Point> & Pick<Point, 'id'>): Point => ({
  name: p.id, menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 0, ...p,
});
const XOI_A = point({ id: 'xoi-a', name: 'Xôi A', sort: 1 });
const XOI_B = point({ id: 'xoi-b', name: 'Xôi B', sort: 2 });
const COM = point({ id: 'com', name: 'Cơm gà', menu_id: COM_MENU, default_dine_type: 'dinein', sort: 3 });
const POINTS = [COM, XOI_B, XOI_A];
const PROFILE: TabletProfile = {
  id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a', 'com'], default_boxes: 200, default_plates: 60, default_float: 500_000,
};

const err = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    return (e as Error).message;
  }
  throw new Error('không ném lỗi');
};

describe('nhập số', () => {
  it('tiền: chấp nhận dấu chấm/phẩy/cách và hậu tố k', () => {
    expect(parseMoneyInput('25.000')).toBe(25_000);
    expect(parseMoneyInput(' 25 000 ')).toBe(25_000);
    expect(parseMoneyInput('25,000')).toBe(25_000);
    expect(parseMoneyInput('25k')).toBe(25_000);
    expect(parseMoneyInput('25K')).toBe(25_000);
    expect(parseMoneyInput('0')).toBe(0);
    for (const bad of ['', 'abc', '-5000', '2.5k5', 'k', '1e6', '99999999999999999999']) expect(parseMoneyInput(bad)).toBeNull();
  });

  it('số đếm: chỉ số nguyên ≥ 0', () => {
    expect(parseCountInput(' 50 ')).toBe(50);
    expect(parseCountInput('0')).toBe(0);
    for (const bad of ['', '-1', '1.5', 'x', '99999999999999999999']) expect(parseCountInput(bad)).toBeNull();
  });
});

describe('tablet dựng bảng chọn từ danh mục', () => {
  it('tab điểm bán: chỉ điểm của hồ sơ, còn hoạt động, theo thứ tự', () => {
    expect(tabletPoints(PROFILE, POINTS).map((p) => p.id)).toEqual(['xoi-a', 'com']);
    // Chủ bỏ Cơm gà khỏi tablet A ⇒ tab Cơm gà biến mất
    expect(tabletPoints({ point_ids: ['xoi-a'] }, POINTS).map((p) => p.id)).toEqual(['xoi-a']);
    // Điểm ngừng hoạt động cũng ẩn
    expect(tabletPoints(PROFILE, [XOI_A, { ...COM, active: false }]).map((p) => p.id)).toEqual(['xoi-a']);
  });

  it('nhân viên: chỉ người còn làm, theo thứ tự rồi theo tên', () => {
    const staff: Staff[] = [
      { id: '3', name: 'Hùng', active: true, sort: 2 },
      { id: '1', name: 'Mai', active: true, sort: 1 },
      { id: '2', name: 'Lan', active: true, sort: 1 },
      { id: '4', name: 'Nghỉ', active: false, sort: 0 },
    ];
    expect(activeStaff(staff).map((s) => s.name)).toEqual(['Lan', 'Mai', 'Hùng']);
    expect(sortCatalog(staff).map((s) => s.id)).toEqual(['4', '2', '1', '3']);
  });

  it('bảng chọn của menu: chỉ thứ còn bán, giá combo = tổng thành phần', () => {
    const board = menuBoard(XOI_MENU, PRODUCTS, TOPPINGS, COMBOS);
    expect(board.products.map((p) => p.id)).toEqual(['xoi-ga', 'xoi-xeo']);
    expect(board.toppings.map((t) => t.id)).toEqual(['trung', 'cha']);
    expect(board.combos).toEqual([{ combo: COMBO_XOI_FULL, price: 25_000 + 6_000 + 8_000 }]);
    expect(menuBoard(COM_MENU, PRODUCTS, TOPPINGS, COMBOS).products.map((p) => p.id)).toEqual(['com-ga']);
  });

  it('đổi giá trong danh mục ⇒ bảng chọn (và combo) dùng giá mới', () => {
    const products = PRODUCTS.map((p) => (p.id === XOI_GA.id ? { ...p, price: 28_000 } : p));
    const board = menuBoard(XOI_MENU, products, TOPPINGS, COMBOS);
    expect(board.products[0].price).toBe(28_000);
    expect(board.combos[0].price).toBe(28_000 + 6_000 + 8_000);
  });
});

describe('kiểm tra dữ liệu chủ nhập', () => {
  const { id: _x, ...xoiGa } = XOI_GA;
  const productCtx = { menus: MENUS, products: PRODUCTS };

  it('menu: cần tên, không trùng', () => {
    expect(() => checkMenu({ name: 'Bánh mì' }, MENUS)).not.toThrow();
    expect(err(() => checkMenu({ name: '  ' }, MENUS))).toMatch('Cần nhập tên menu');
    expect(err(() => checkMenu({ name: ' xôi ' }, MENUS))).toMatch('Đã có menu tên "Xôi"');
    expect(() => checkMenu({ name: 'Xôi' }, MENUS, XOI_MENU)).not.toThrow(); // sửa chính nó
  });

  it('món: tên, menu, giá và định mức bao bì hợp lệ', () => {
    expect(() => checkProduct(xoiGa, productCtx, XOI_GA.id)).not.toThrow();
    expect(() => checkProduct({ ...xoiGa, name: 'Xôi mới' }, productCtx)).not.toThrow();
    expect(err(() => checkProduct(xoiGa, productCtx))).toMatch('Đã có món tên "Xôi gà"');
    // Cùng tên ở menu khác thì được
    expect(() => checkProduct({ ...xoiGa, name: 'Cơm gà' }, productCtx)).not.toThrow();
    expect(err(() => checkProduct({ ...xoiGa, name: 'x'.repeat(61) }, productCtx))).toMatch('quá dài');
    expect(err(() => checkProduct({ ...xoiGa, menu_id: 'nope' }, productCtx, XOI_GA.id))).toMatch('Cần chọn menu');
    expect(err(() => checkProduct({ ...xoiGa, price: -1 }, productCtx, XOI_GA.id))).toMatch('Giá');
    expect(err(() => checkProduct({ ...xoiGa, price: 1.5 }, productCtx, XOI_GA.id))).toMatch('Giá');
    expect(err(() => checkProduct({ ...xoiGa, sort: -1 }, productCtx, XOI_GA.id))).toMatch('Thứ tự');
    expect(err(() => checkProduct({ ...xoiGa, boxes_takeaway: -1 }, productCtx, XOI_GA.id))).toMatch('mang về');
    expect(err(() => checkProduct({ ...xoiGa, boxes_dinein: -1 }, productCtx, XOI_GA.id))).toMatch('hộp khi ăn tại chỗ');
    expect(err(() => checkProduct({ ...xoiGa, plates_dinein: -1 }, productCtx, XOI_GA.id))).toMatch('dĩa');
  });

  it('topping: tên không trùng trong menu, giá ≥ 0', () => {
    const { id: _t, ...canh } = CANH;
    const ctx = { menus: MENUS, toppings: TOPPINGS };
    expect(() => checkTopping(canh, ctx, CANH.id)).not.toThrow();
    expect(err(() => checkTopping(canh, ctx))).toMatch('Đã có topping');
    expect(() => checkTopping({ ...canh, menu_id: XOI_MENU }, ctx)).not.toThrow();
    expect(err(() => checkTopping({ ...canh, name: '' }, ctx))).toMatch('Cần nhập tên topping');
    expect(err(() => checkTopping({ ...canh, menu_id: '' }, ctx, CANH.id))).toMatch('Cần chọn menu');
    expect(err(() => checkTopping({ ...canh, price: -1 }, ctx, CANH.id))).toMatch('Giá');
    expect(err(() => checkTopping({ ...canh, sort: 0.5 }, ctx, CANH.id))).toMatch('Thứ tự');
  });

  it('combo: món chính + topping phải cùng menu, không trùng, không có giá riêng', () => {
    const ctx = { menus: MENUS, products: PRODUCTS, toppings: TOPPINGS, combos: COMBOS };
    const { id: _c, ...full } = COMBO_XOI_FULL;
    expect(() => checkCombo(full, ctx, COMBO_XOI_FULL.id)).not.toThrow();
    expect('price' in full).toBe(false);
    expect(err(() => checkCombo(full, ctx))).toMatch('Đã có combo');
    expect(err(() => checkCombo({ ...full, name: '' }, ctx))).toMatch('Cần nhập tên combo');
    expect(err(() => checkCombo({ ...full, menu_id: 'x' }, ctx, COMBO_XOI_FULL.id))).toMatch('Cần chọn menu');
    expect(err(() => checkCombo({ ...full, sort: -2 }, ctx, COMBO_XOI_FULL.id))).toMatch('Thứ tự');
    expect(err(() => checkCombo({ ...full, product_id: 'nope' }, ctx, COMBO_XOI_FULL.id))).toMatch('Cần chọn món chính');
    expect(err(() => checkCombo({ ...full, product_id: COM_GA.id }, ctx, COMBO_XOI_FULL.id))).toMatch('không thuộc menu');
    expect(err(() => checkCombo({ ...full, topping_ids: [TRUNG.id, TRUNG.id] }, ctx, COMBO_XOI_FULL.id))).toMatch('trùng');
    expect(err(() => checkCombo({ ...full, topping_ids: ['nope'] }, ctx, COMBO_XOI_FULL.id))).toMatch('không tồn tại');
    expect(err(() => checkCombo({ ...full, topping_ids: [CHA.id, CANH.id] }, ctx, COMBO_XOI_FULL.id))).toMatch('"Canh" không thuộc menu');
    // Combo không món phụ và combo chứa topping ngừng bán vẫn lưu được (ngừng bán ⇒ combo tự ẩn trên tablet)
    expect(() => checkCombo({ ...full, topping_ids: [] }, ctx, COMBO_XOI_FULL.id)).not.toThrow();
    expect(() => checkCombo({ ...full, topping_ids: [PATE_CU.id] }, ctx, COMBO_XOI_FULL.id)).not.toThrow();
  });

  it('nhân viên: tên không trùng (chọn tên khi mở ca)', () => {
    const staff: Staff[] = [{ id: '1', name: 'Lan', active: true, sort: 1 }];
    expect(() => checkStaff({ name: 'Mai', active: true, sort: 2 }, staff)).not.toThrow();
    expect(err(() => checkStaff({ name: 'lan', active: false, sort: 2 }, staff))).toMatch('Đã có nhân viên tên "Lan"');
    expect(() => checkStaff({ name: 'Lan', active: false, sort: 1 }, staff, '1')).not.toThrow();
    expect(err(() => checkStaff({ name: '', active: true, sort: 0 }, staff))).toMatch('Cần nhập tên nhân viên');
    expect(err(() => checkStaff({ name: 'Mai', active: true, sort: -1 }, staff))).toMatch('Thứ tự');
  });

  it('điểm bán: tên, menu, mặc định Tại chỗ / Mang về', () => {
    const ctx = { menus: MENUS, points: POINTS };
    const { id: _p, ...com } = COM;
    expect(() => checkPoint(com, ctx, COM.id)).not.toThrow();
    expect(err(() => checkPoint(com, ctx))).toMatch('Đã có điểm bán');
    expect(err(() => checkPoint({ ...com, name: '' }, ctx))).toMatch('Cần nhập tên điểm bán');
    expect(err(() => checkPoint({ ...com, menu_id: '' }, ctx, COM.id))).toMatch('Cần chọn menu');
    expect(err(() => checkPoint({ ...com, default_dine_type: 'x' as never }, ctx, COM.id))).toMatch('Tại chỗ / Mang về');
    expect(err(() => checkPoint({ ...com, sort: -1 }, ctx, COM.id))).toMatch('Thứ tự');
  });

  it('hồ sơ tablet: ít nhất một điểm bán có thật, số mặc định đầu ca ≥ 0', () => {
    const ctx = { points: POINTS, profiles: [PROFILE] };
    const { id: _a, ...a } = PROFILE;
    expect(() => checkTabletProfile(a, ctx, PROFILE.id)).not.toThrow();
    expect(() => checkTabletProfile({ ...a, point_ids: ['xoi-a'] }, ctx, PROFILE.id)).not.toThrow();
    expect(err(() => checkTabletProfile(a, ctx))).toMatch('Đã có hồ sơ tablet');
    expect(err(() => checkTabletProfile({ ...a, name: '' }, ctx, PROFILE.id))).toMatch('Cần nhập tên hồ sơ tablet');
    expect(err(() => checkTabletProfile({ ...a, point_ids: [] }, ctx, PROFILE.id))).toMatch('ít nhất một điểm bán');
    expect(err(() => checkTabletProfile({ ...a, point_ids: ['com', 'com'] }, ctx, PROFILE.id))).toMatch('trùng');
    expect(err(() => checkTabletProfile({ ...a, point_ids: ['nope'] }, ctx, PROFILE.id))).toMatch('không tồn tại');
    expect(err(() => checkTabletProfile({ ...a, default_boxes: -1 }, ctx, PROFILE.id))).toMatch('hộp đầu ca');
    expect(err(() => checkTabletProfile({ ...a, default_plates: -1 }, ctx, PROFILE.id))).toMatch('dĩa đầu ca');
    expect(err(() => checkTabletProfile({ ...a, default_float: 0.5 }, ctx, PROFILE.id))).toMatch('Tiền lẻ');
  });
});
