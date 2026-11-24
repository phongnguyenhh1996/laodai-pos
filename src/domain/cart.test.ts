import { describe, expect, it } from 'vitest';
import {
  CartError,
  addCombo,
  addLine,
  addProduct,
  canSwitchPoint,
  draftAddress,
  draftChanged,
  draftBlocker,
  draftShipFee,
  draftShipMode,
  draftShipPayout,
  needsShipPayout,
  setShipMode,
  toggleShipPayout,
  withShipDefaults,
  draftTotal,
  itemsSummary,
  lineSummary,
  needsAddress,
  newDraft,
  replaceWithCombo,
  replaceWithProduct,
  setCustomer,
  setDineType,
  setLineQty,
  type DraftCustomer,
  stepLineQty,
  switchPoint,
  toggleShipFee,
} from './cart';
import { CANH, CHA, COMBOS, COMBO_XOI_FULL, COM_GA, COM_MENU, DUA, PRODUCTS, TOPPINGS, TRUNG, XOI_CU, XOI_GA, XOI_MENU, XOI_XEO } from './fixtures';
import { PricingError } from './pricing';
import type { DineType, Point } from './types';

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

  it('đổi món: thay dòng đã chọn, giữ số lượng + vị trí; trùng dòng khác ⇒ gộp; trùng chính nó ⇒ không đổi', () => {
    let items = addProduct([], 'l1', XOI_GA, [], XOI_MENU);
    items = addProduct(items, 'l2', XOI_XEO, [], XOI_MENU);
    items = stepLineQty(items, 'l1', 1); // 2× Xôi gà, 1× Xôi xéo
    const swapped = replaceWithProduct(items, 'l1', 'l3', XOI_GA, [TRUNG], XOI_MENU);
    expect(swapped.map((i) => [i.id, i.product_id, i.qty, i.toppings_snap.length])).toEqual([
      ['l3', XOI_GA.id, 2, 1],
      ['l2', XOI_XEO.id, 1, 0],
    ]);
    expect(draftTotal({ items: swapped })).toBe(2 * (25_000 + 6_000) + 15_000);
    expect(items[0].qty).toBe(2); // bất biến

    const merged = replaceWithProduct(items, 'l2', 'l4', XOI_GA, [], XOI_MENU);
    expect(merged.map((i) => [i.id, i.qty])).toEqual([['l1', 3]]);

    expect(replaceWithProduct(items, 'l1', 'l5', XOI_GA, [], XOI_MENU)).toEqual(items);

    const combo = replaceWithCombo(items, 'l2', 'l6', COMBO_XOI_FULL, PRODUCTS, TOPPINGS, XOI_MENU);
    expect(combo.map((i) => i.id)).toEqual(['l1', 'l6']);
    expect(combo[1].qty).toBe(1);

    expect(() => replaceWithProduct(items, 'l1', 'l7', COM_GA, [], XOI_MENU)).toThrow(CartError);
    expect(() => replaceWithProduct(items, 'khong-co', 'l7', XOI_XEO, [], XOI_MENU)).toThrow(CartError);
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
    const saved = { point_id: 'xoi-a', dine_type: 'takeaway' as DineType, label: null, address: null, items };
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

  it('đơn ship: bắt buộc địa chỉ; địa chỉ chỉ tính khi là đơn ship', () => {
    const items = addProduct([], 'l1', XOI_GA, [], XOI_MENU);
    const d = { ...newDraft(XOI_A), items };
    expect(needsAddress(d)).toBe(false);
    const ship = setDineType(d, 'delivery');
    expect(needsAddress(ship)).toBe(true);
    expect(needsAddress({ ...ship, address: '   ' })).toBe(true);
    expect(needsAddress({ ...ship, address: '12 Lê Lợi' })).toBe(false);
    expect(draftAddress({ ...ship, address: '  12 Lê Lợi ' })).toBe('12 Lê Lợi');
    // Gõ địa chỉ rồi đổi về Mang về ⇒ không gửi địa chỉ.
    expect(draftAddress({ ...d, address: '12 Lê Lợi' })).toBeNull();

    const saved = { point_id: 'xoi-a', dine_type: 'delivery' as DineType, label: null, address: '12 Lê Lợi', items };
    expect(draftChanged({ ...ship, address: '12 Lê Lợi ' }, saved)).toBe(false);
    expect(draftChanged({ ...ship, address: '14 Lê Lợi' }, saved)).toBe(true);
    expect(draftChanged({ ...d, address: '12 Lê Lợi' }, saved)).toBe(true);
  });

  it('phí ship: bấm mức ⇒ cộng vào tổng, bấm lại ⇒ bỏ; chỉ đơn ship có phí; đổi khỏi Ship ⇒ phí 0; đổi phí ⇒ có thay đổi', () => {
    const items = addProduct([], 'l1', XOI_XEO, [], XOI_MENU); // 15.000
    const ship = setDineType({ ...newDraft(XOI_A), items }, 'delivery');
    expect(newDraft(XOI_A).ship_fee).toBe(0);
    const a = toggleShipFee(ship, 10_000);
    expect(draftTotal(a)).toBe(25_000);
    expect(draftTotal(toggleShipFee(a, 15_000))).toBe(30_000);
    expect(toggleShipFee(a, 10_000).ship_fee).toBe(0);
    // Phí còn trong nháp nhưng không phải đơn ship ⇒ không tính, không gửi.
    expect(draftShipFee({ ...a, dine_type: 'takeaway' })).toBe(0);
    expect(draftTotal({ ...a, dine_type: 'takeaway' })).toBe(15_000);
    expect(setDineType(a, 'takeaway').ship_fee).toBe(0);
    expect(setDineType(a, 'delivery').ship_fee).toBe(10_000);

    const saved = { point_id: 'xoi-a', dine_type: 'delivery' as DineType, label: null, address: null, items, ship_fee: 10_000 };
    expect(draftChanged(a, saved)).toBe(false);
    expect(draftChanged(toggleShipFee(a, 20_000), saved)).toBe(true);
    // Đơn ship cũ (chưa có cột phí) mở lại, không chọn phí ⇒ không bị coi là đã sửa.
    expect(draftChanged(ship, { ...saved, ship_fee: undefined })).toBe(false);
  });

  it('kiểu ship: shipper ngoài bắt buộc trả shipper, không cộng vào tổng; về quán ship bỏ trả shipper; rời Ship ⇒ shop/0', () => {
    const items = addProduct([], 'l1', XOI_XEO, [], XOI_MENU); // 15.000
    const ship = { ...setDineType({ ...newDraft(XOI_A), items }, 'delivery'), address: '12 Lê Lợi' };
    expect(ship).toMatchObject({ ship_mode: 'shop', ship_payout: 0 });
    expect(draftBlocker(ship)).toBeNull();

    const ext = setShipMode(toggleShipFee(ship, 5_000), 'external');
    expect(needsShipPayout(ext)).toBe(true);
    expect(draftBlocker(ext)).toBe('Chưa chọn tiền trả shipper');
    expect(draftBlocker({ ...ext, address: '' })).toBe('Thiếu địa chỉ ship');
    const paid = toggleShipPayout(ext, 10_000);
    expect(draftBlocker(paid)).toBeNull();
    // Phụ thu nằm trong tổng, trả shipper thì không.
    expect(draftTotal(paid)).toBe(20_000);
    expect([draftShipMode(paid), draftShipFee(paid), draftShipPayout(paid)]).toEqual(['external', 5_000, 10_000]);
    // Bấm lại mức trả shipper đang chọn không bỏ được.
    expect(toggleShipPayout(paid, 10_000).ship_payout).toBe(10_000);
    expect(toggleShipPayout(paid, 15_000).ship_payout).toBe(15_000);

    // Về quán ship: bỏ trả shipper, phí giữ nguyên.
    expect(setShipMode(paid, 'shop')).toMatchObject({ ship_mode: 'shop', ship_fee: 5_000, ship_payout: 0 });
    // Rời Ship: về shop / 0, không gửi gì.
    const take = setDineType(paid, 'takeaway');
    expect(take).toMatchObject({ ship_mode: 'shop', ship_fee: 0, ship_payout: 0 });
    expect([draftShipMode({ ...paid, dine_type: 'dinein' }), draftShipPayout({ ...paid, dine_type: 'dinein' })]).toEqual(['shop', 0]);
    expect(needsShipPayout({ ...ext, dine_type: 'takeaway' })).toBe(false);

    const saved = { point_id: 'xoi-a', dine_type: 'delivery' as DineType, label: null, address: '12 Lê Lợi', items, ship_fee: 5_000, ship_mode: 'external' as const, ship_payout: 10_000 };
    expect(draftChanged(paid, saved)).toBe(false);
    expect(draftChanged(toggleShipPayout(paid, 15_000), saved)).toBe(true);
    expect(draftChanged(setShipMode(paid, 'shop'), saved)).toBe(true);
    // Đơn cũ (chưa có hai cột) ⇒ shop / 0, không bị coi là đã sửa.
    expect(draftChanged(toggleShipFee(ship, 5_000), { ...saved, ship_mode: undefined, ship_payout: undefined })).toBe(false);
  });

  it('mặc định theo ca: đơn mới lấy kiểu / phí / trả shipper của đơn ship gần nhất; đến muộn không đè lựa chọn đã bấm', () => {
    const def = { ship_mode: 'external' as const, ship_fee: 5_000, ship_payout: 10_000 };
    expect(newDraft(XOI_A, def)).toMatchObject(def);
    expect(newDraft(XOI_A, null)).toMatchObject({ ship_mode: 'shop', ship_fee: 0, ship_payout: 0 });
    // Quán ship gần nhất có payout lạ ⇒ bỏ.
    expect(newDraft(XOI_A, { ship_mode: 'shop', ship_fee: 15_000, ship_payout: 9_000 })).toMatchObject({ ship_mode: 'shop', ship_fee: 15_000, ship_payout: 0 });
    const d = newDraft(XOI_A);
    expect(withShipDefaults(d, def)).toMatchObject(def);
    expect(withShipDefaults(d, null)).toBe(d);
    const touched = toggleShipFee(d, 10_000);
    expect(withShipDefaults(touched, def)).toBe(touched);
    // Mặc định chỉ tính khi là đơn ship.
    expect(draftTotal({ ...newDraft(XOI_A, def), dine_type: 'takeaway' })).toBe(0);
  });

  it('khách đơn ship: chọn khách điền sẵn địa chỉ (không đè địa chỉ tự gõ); đổi khách ⇒ có thay đổi; không phải ship ⇒ bỏ khách', () => {
    const hoa: DraftCustomer = { id: 'c-hoa', name: 'Cô Hoa', description: null, phone: null, address: '20 Lê Lợi', is_new: false };
    const tu: DraftCustomer = { id: 'c-tu', name: 'Tú', description: null, phone: null, address: '5 Hai Bà Trưng', is_new: false };
    const ship = setDineType({ ...newDraft(XOI_A), items: [] }, 'delivery');
    const a = setCustomer(ship, hoa);
    expect(a.address).toBe('20 Lê Lợi');
    expect(setCustomer(a, tu).address).toBe('5 Hai Bà Trưng'); // địa chỉ điền sẵn ⇒ theo khách mới
    expect(setCustomer({ ...a, address: '7 Pasteur' }, tu).address).toBe('7 Pasteur'); // tự gõ ⇒ giữ
    expect(setCustomer(a, null)).toMatchObject({ customer: null, address: '20 Lê Lợi' });

    const saved = { point_id: 'xoi-a', dine_type: 'delivery' as DineType, label: null, address: '20 Lê Lợi', customer_id: 'c-hoa', items: [] };
    expect(draftChanged(a, saved)).toBe(false);
    expect(draftChanged({ ...a, customer: tu }, saved)).toBe(true);
    expect(draftChanged({ ...a, customer: null }, saved)).toBe(true);
    expect(draftChanged(setDineType(a, 'takeaway'), { ...saved, dine_type: 'takeaway', address: null, customer_id: null })).toBe(false);
  });
});
