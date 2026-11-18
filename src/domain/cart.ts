// Giỏ hàng của màn tạo / sửa đơn trên tablet: thêm combo / món + topping, đổi số lượng, đổi điểm bán.
// Hàm thuần, không đụng IndexedDB: màn đơn giữ bản nháp, chỉ ghi xuống khi bấm Lưu / Đã ra món / Thanh toán.
import { assertQty, buildComboItem, buildItem, orderTotal } from './pricing';
import type { Combo, DineType, Money, OrderItem, Point, Product, Topping } from './types';

export interface CartDraft {
  point_id: string;
  dine_type: DineType;
  /** Nhân viên đã tự bấm Tại chỗ / Mang về ⇒ đổi điểm bán không ghi đè lựa chọn đó. */
  dine_type_touched: boolean;
  label: string;
  /** Địa chỉ giao: chỉ dùng (và bắt buộc) khi đơn ship. */
  address: string;
  items: OrderItem[];
}

export class CartError extends Error {}

export function newDraft(point: Pick<Point, 'id' | 'default_dine_type'>): CartDraft {
  return { point_id: point.id, dine_type: point.default_dine_type, dine_type_touched: false, label: '', address: '', items: [] };
}

/** Hai dòng giống hệt nhau (cùng món, cùng topping, cùng giá chụp) ⇒ gộp thành một dòng tăng số lượng. */
function sameLine(a: OrderItem, b: OrderItem): boolean {
  if (a.product_id !== b.product_id || a.unit_price_snap !== b.unit_price_snap) return false;
  if (a.toppings_snap.length !== b.toppings_snap.length) return false;
  const key = (it: OrderItem) =>
    it.toppings_snap
      .map((t) => `${t.id}:${t.price}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}

/** Thêm một dòng (giá chụp lúc thêm). Trùng dòng đã có ⇒ cộng số lượng vào dòng đó. */
export function addLine(items: readonly OrderItem[], line: OrderItem): OrderItem[] {
  const i = items.findIndex((it) => sameLine(it, line));
  if (i < 0) return [...items, line];
  return items.map((it, j) => (j === i ? { ...it, qty: it.qty + line.qty } : it));
}

export function addProduct(
  items: readonly OrderItem[],
  newId: string,
  product: Product,
  toppings: Topping[],
  menuId: string,
): OrderItem[] {
  if (product.menu_id !== menuId) throw new CartError(`Món "${product.name}" không thuộc menu của điểm bán`);
  return addLine(items, buildItem(newId, product, toppings, 1));
}

export function addCombo(
  items: readonly OrderItem[],
  newId: string,
  combo: Combo,
  products: Product[],
  toppings: Topping[],
  menuId: string,
): OrderItem[] {
  if (combo.menu_id !== menuId) throw new CartError(`Combo "${combo.name}" không thuộc menu của điểm bán`);
  return addLine(items, buildComboItem(newId, combo, products, toppings, 1));
}

/**
 * Khách đổi món: thay dòng `lineId` bằng `line`, giữ số lượng và vị trí của dòng cũ.
 * Món mới trùng một dòng khác đã có ⇒ gộp vào dòng đó. Trùng chính dòng cũ ⇒ không đổi gì.
 */
export function replaceLine(items: readonly OrderItem[], lineId: string, line: OrderItem): OrderItem[] {
  const old = items.find((it) => it.id === lineId);
  if (!old) throw new CartError('Không có dòng này trong đơn');
  if (sameLine(old, line)) return [...items];
  const next = { ...line, qty: old.qty };
  if (items.some((it) => it.id !== lineId && sameLine(it, next))) {
    return addLine(
      items.filter((it) => it.id !== lineId),
      next,
    );
  }
  return items.map((it) => (it.id === lineId ? next : it));
}

export function replaceWithProduct(
  items: readonly OrderItem[],
  lineId: string,
  newId: string,
  product: Product,
  toppings: Topping[],
  menuId: string,
): OrderItem[] {
  if (product.menu_id !== menuId) throw new CartError(`Món "${product.name}" không thuộc menu của điểm bán`);
  return replaceLine(items, lineId, buildItem(newId, product, toppings, 1));
}

export function replaceWithCombo(
  items: readonly OrderItem[],
  lineId: string,
  newId: string,
  combo: Combo,
  products: Product[],
  toppings: Topping[],
  menuId: string,
): OrderItem[] {
  if (combo.menu_id !== menuId) throw new CartError(`Combo "${combo.name}" không thuộc menu của điểm bán`);
  return replaceLine(items, lineId, buildComboItem(newId, combo, products, toppings, 1));
}

/** Đổi số lượng một dòng; về 0 ⇒ bỏ dòng. Số âm / không nguyên bị từ chối. */
export function setLineQty(items: readonly OrderItem[], lineId: string, qty: number): OrderItem[] {
  if (qty === 0) return items.filter((it) => it.id !== lineId);
  assertQty(qty);
  if (!items.some((it) => it.id === lineId)) throw new CartError('Không có dòng này trong đơn');
  return items.map((it) => (it.id === lineId ? { ...it, qty } : it));
}

export function stepLineQty(items: readonly OrderItem[], lineId: string, delta: 1 | -1): OrderItem[] {
  const line = items.find((it) => it.id === lineId);
  if (!line) throw new CartError('Không có dòng này trong đơn');
  return setLineQty(items, lineId, line.qty + delta);
}

export function draftTotal(draft: Pick<CartDraft, 'items'>): Money {
  return orderTotal(draft.items);
}

/**
 * Đổi điểm bán của đơn. Đơn đã có món thì chỉ đổi được sang điểm cùng menu
 * (món Xôi không thể nằm trong đơn Cơm gà; server cũng từ chối).
 * Chưa tự chọn Tại chỗ / Mang về ⇒ theo mặc định của điểm mới.
 */
export function canSwitchPoint(draft: Pick<CartDraft, 'items' | 'point_id'>, points: readonly Point[], to: Point): boolean {
  if (draft.items.length === 0) return true;
  const from = points.find((p) => p.id === draft.point_id);
  return !!from && from.menu_id === to.menu_id;
}

export function switchPoint(draft: CartDraft, points: readonly Point[], to: Point): CartDraft {
  if (!canSwitchPoint(draft, points, to)) throw new CartError('Đơn đã có món của menu khác');
  return {
    ...draft,
    point_id: to.id,
    dine_type: draft.dine_type_touched ? draft.dine_type : to.default_dine_type,
  };
}

export function setDineType(draft: CartDraft, dine_type: DineType): CartDraft {
  return { ...draft, dine_type, dine_type_touched: true };
}

/** Địa chỉ gửi đi: chỉ đơn ship mới có, bỏ khoảng trắng thừa. */
export function draftAddress(draft: Pick<CartDraft, 'dine_type' | 'address'>): string | null {
  return draft.dine_type === 'delivery' ? draft.address.trim() || null : null;
}

/** Đơn ship chưa có địa chỉ ⇒ chưa được lưu. */
export function needsAddress(draft: Pick<CartDraft, 'dine_type' | 'address'>): boolean {
  return draft.dine_type === 'delivery' && draftAddress(draft) === null;
}

/** "2× Xôi gà (Trứng, Chả)" — tóm tắt dòng trên thẻ hàng đợi / giỏ hàng. */
export function lineSummary(it: Pick<OrderItem, 'qty' | 'name_snap' | 'toppings_snap'>): string {
  const tops = it.toppings_snap.length ? ` (${it.toppings_snap.map((t) => t.name).join(', ')})` : '';
  return `${it.qty}× ${it.name_snap}${tops}`;
}

export function itemsSummary(items: ReadonlyArray<Pick<OrderItem, 'qty' | 'name_snap' | 'toppings_snap'>>): string {
  return items.map(lineSummary).join(' · ');
}

/** Bản nháp khác với đơn đã lưu ⇒ cần ghi `update_order`. */
export function draftChanged(
  draft: Pick<CartDraft, 'point_id' | 'dine_type' | 'label' | 'address' | 'items'>,
  saved: { point_id: string; dine_type: DineType; label: string | null; address: string | null; items: readonly OrderItem[] },
): boolean {
  if (draft.point_id !== saved.point_id || draft.dine_type !== saved.dine_type) return true;
  if (draftAddress(draft) !== (saved.address ?? null)) return true;
  if ((draft.label.trim() || null) !== (saved.label ?? null)) return true;
  if (draft.items.length !== saved.items.length) return true;
  return draft.items.some((it, i) => {
    const s = saved.items[i];
    return s.id !== it.id || s.qty !== it.qty || !sameLine(s, it);
  });
}
