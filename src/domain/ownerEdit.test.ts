import { describe, expect, it } from 'vitest';
import { addProduct, stepLineQty } from './cart';
import {
  editDraftFrom,
  editPayload,
  editProblem,
  editSummary,
  itemsChanged,
  setEditCustomer,
  setEditMethod,
  setEditShipMode,
  setEditShipPayout,
  toggleEditShipFee,
  type PaidOrderSnapshot,
} from './ownerEdit';
import type { OrderItem, Product } from './types';

const xoiGa: Product = {
  id: 'p-ga', menu_id: 'm-xoi', name: 'Xôi gà', price: 28_000, sort: 1, active: true, boxes_takeaway: 1, boxes_dinein: 1, plates_dinein: 0, cans: 0,
};

// Đơn đã thu: 2 × Xôi gà (+Trứng) giá cũ 25.000 ⇒ 62.000, tiền mặt
const line: OrderItem = {
  id: 'line-1', product_id: 'p-ga', name_snap: 'Xôi gà', unit_price_snap: 25_000, qty: 2,
  toppings_snap: [{ id: 't-trung', name: 'Trứng', price: 6_000, extra_box: false }],
};
const paid: PaidOrderSnapshot = { items: [line], payment_method: 'cash', customer_id: null, total: 62_000 };
const NO_SHIP = { p_ship_mode: null, p_ship_fee: null, p_ship_payout: null };

describe('chủ sửa đơn đã thanh toán (bản nháp)', () => {
  it('bản nháp ban đầu = đơn, không đổi gì ⇒ không gửi', () => {
    const d = editDraftFrom(paid);
    expect(d).toEqual({ items: [line], payment_method: 'cash', customer_id: null, ship_mode: 'shop', ship_fee: 0, ship_payout: 0 });
    expect(d.items[0]).not.toBe(line);
    expect(editPayload(d, paid)).toBeNull();
    expect(editProblem(d, paid)).toBe('Chưa thay đổi gì');
  });

  it('đổi tiền mặt → chuyển khoản: chỉ gửi hình thức', () => {
    const d = setEditMethod(editDraftFrom(paid), 'transfer');
    expect(editProblem(d, paid)).toBeNull();
    expect(editPayload(d, paid)).toEqual({ p_items: null, p_payment_method: 'transfer', p_customer_id: null, ...NO_SHIP });
  });

  it('bớt món: gửi danh sách món (dòng cũ giữ id + giá chụp cũ), tổng tính lại', () => {
    const d = { ...editDraftFrom(paid), items: stepLineQty(paid.items, 'line-1', -1) };
    expect(editPayload(d, paid)).toEqual({ p_items: [{ ...line, qty: 1 }], p_payment_method: null, p_customer_id: null, ...NO_SHIP });
    expect(editSummary(d, paid)).toEqual({ before: 62_000, after: 31_000, diff: -31_000 });
  });

  it('thêm món: dòng mới theo giá hiện hành', () => {
    const d = { ...editDraftFrom(paid), items: addProduct(paid.items, 'line-2', xoiGa, [], 'm-xoi') };
    const p = editPayload(d, paid)!;
    expect(p.p_items).toHaveLength(2);
    expect(p.p_items![1]).toMatchObject({ id: 'line-2', unit_price_snap: 28_000, qty: 1 });
    expect(editSummary(d, paid).after).toBe(90_000);
  });

  it('đơn ship có phí: sửa món giữ nguyên phí, tổng mới = tiền món mới + phí', () => {
    const ship = { ...paid, total: 72_000, ship_fee: 10_000 };
    const d = { ...editDraftFrom(ship), items: stepLineQty(ship.items, 'line-1', -1) };
    expect(editSummary(d, ship)).toEqual({ before: 72_000, after: 41_000, diff: -31_000 });
  });

  it('đơn ship: sửa kiểu / phụ thu / trả shipper; chỉ gửi phần đổi; shipper ngoài bắt buộc trả shipper; tổng = món + phí mới', () => {
    const ship: PaidOrderSnapshot = { ...paid, total: 72_000, dine_type: 'delivery', ship_mode: 'shop', ship_fee: 10_000, ship_payout: 0 };
    const ext = setEditShipMode(editDraftFrom(ship), 'external');
    expect(editProblem(ext, ship)).toBe('Chưa chọn tiền trả shipper');
    const d = setEditShipPayout(toggleEditShipFee(ext, 5_000), 10_000);
    expect(editProblem(d, ship)).toBeNull();
    expect(editPayload(d, ship)).toEqual({ p_items: null, p_payment_method: null, p_customer_id: null, p_ship_mode: 'external', p_ship_fee: 5_000, p_ship_payout: 10_000 });
    // Trả shipper không nằm trong tổng.
    expect(editSummary(d, ship)).toEqual({ before: 72_000, after: 67_000, diff: -5_000 });
    // Bấm lại phụ thu ⇒ 0; trả shipper bấm lại không bỏ.
    expect(toggleEditShipFee(d, 5_000).ship_fee).toBe(0);
    expect(setEditShipPayout(d, 10_000).ship_payout).toBe(10_000);

    // Đơn shipper ngoài: chỉ đổi trả shipper ⇒ chỉ gửi payout; về quán ship ⇒ gửi kiểu, payout về 0 (không gửi).
    const paidExt: PaidOrderSnapshot = { ...ship, total: 67_000, ship_mode: 'external', ship_fee: 5_000, ship_payout: 10_000 };
    expect(editPayload(setEditShipPayout(editDraftFrom(paidExt), 15_000), paidExt)).toEqual({ p_items: null, p_payment_method: null, p_customer_id: null, p_ship_mode: null, p_ship_fee: null, p_ship_payout: 15_000 });
    const back = setEditShipMode(editDraftFrom(paidExt), 'shop');
    expect(back.ship_payout).toBe(0);
    expect(editPayload(back, paidExt)).toEqual({ p_items: null, p_payment_method: null, p_customer_id: null, p_ship_mode: 'shop', p_ship_fee: null, p_ship_payout: null });
    expect(editPayload(editDraftFrom(paidExt), paidExt)).toBeNull();
  });

  it('đơn không phải ship: không gửi kiểu / phí dù bản nháp có', () => {
    const d = setEditShipPayout(setEditShipMode(editDraftFrom(paid), 'external'), 10_000);
    expect(editProblem(d, paid)).toBe('Chưa thay đổi gì');
    expect(editPayload(d, paid)).toBeNull();
  });

  it('bỏ hết món ⇒ không lưu được', () => {
    const d = { ...editDraftFrom(paid), items: [] };
    expect(editProblem(d, paid)).toBe('Đơn phải còn ít nhất một món');
  });

  it('ghi nợ: phải chọn khách; chọn rồi thì gửi hình thức + khách', () => {
    let d = setEditMethod(editDraftFrom(paid), 'debt');
    expect(editProblem(d, paid)).toBe('Ghi nợ cần chọn khách');
    d = setEditCustomer(d, 'c-dung');
    expect(editProblem(d, paid)).toBeNull();
    expect(editPayload(d, paid)).toEqual({ p_items: null, p_payment_method: 'debt', p_customer_id: 'c-dung', ...NO_SHIP });
  });

  it('đổi khách nợ của đơn ghi nợ: chỉ gửi khách', () => {
    const debt: PaidOrderSnapshot = { ...paid, payment_method: 'debt', customer_id: 'c-a' };
    const d = setEditCustomer(editDraftFrom(debt), 'c-b');
    expect(editPayload(d, debt)).toEqual({ p_items: null, p_payment_method: null, p_customer_id: 'c-b', ...NO_SHIP });
  });

  it('ghi nợ → tiền mặt: khách giữ trong nháp nhưng không gửi; quay lại ghi nợ cùng khách ⇒ không đổi', () => {
    const debt: PaidOrderSnapshot = { ...paid, payment_method: 'debt', customer_id: 'c-a' };
    const toCash = setEditMethod(editDraftFrom(debt), 'cash');
    expect(toCash.customer_id).toBe('c-a');
    expect(editPayload(toCash, debt)).toEqual({ p_items: null, p_payment_method: 'cash', p_customer_id: null, ...NO_SHIP });
    expect(editPayload(setEditMethod(toCash, 'debt'), debt)).toBeNull();
  });

  it('itemsChanged: so cả số lượng, topping, giá, thứ tự', () => {
    expect(itemsChanged([line], [{ ...line }])).toBe(false);
    expect(itemsChanged([line], [{ ...line, qty: 3 }])).toBe(true);
    expect(itemsChanged([line], [{ ...line, toppings_snap: [] }])).toBe(true);
    expect(itemsChanged([line], [{ ...line, unit_price_snap: 1 }])).toBe(true);
    expect(itemsChanged([line], [])).toBe(true);
    const other = { ...line, id: 'line-9' };
    expect(itemsChanged([line, other], [other, line])).toBe(true);
    expect(itemsChanged([{ ...line, toppings_snap: [...line.toppings_snap, { id: 't-cha', name: 'Chả', price: 8000, extra_box: false }] }],
      [{ ...line, toppings_snap: [{ id: 't-cha', name: 'Chả', price: 8000, extra_box: false }, ...line.toppings_snap] }])).toBe(false);
  });
});
