import type { Combo, Money, OrderItem, Product, Topping, ToppingSnap } from './types';

export class PricingError extends Error {}

export function lineTotal(item: Pick<OrderItem, 'unit_price_snap' | 'qty' | 'toppings_snap'>): Money {
  const toppings = item.toppings_snap.reduce((s, t) => s + t.price, 0);
  return (item.unit_price_snap + toppings) * item.qty;
}

/** Tiền món (chưa có phí ship). */
export function orderTotal(items: Array<Pick<OrderItem, 'unit_price_snap' | 'qty' | 'toppings_snap'>>): Money {
  return items.reduce((s, it) => s + lineTotal(it), 0);
}

/** Các mức phí ship nhân viên bấm được (server nhận 0–50.000, bội số 1.000). */
export const SHIP_FEES: readonly Money[] = [5000, 10000, 15000, 20000];

/** Các mức trả shipper ngoài (bắt buộc chọn một; server nhận 1.000–50.000, bội số 1.000). Nhãn dùng `shipFeeLabel`. */
export const SHIP_PAYOUTS: readonly Money[] = [5000, 10000, 15000, 20000];

/** "+10k" trên nút phí ship / trả shipper. */
export function shipFeeLabel(fee: Money): string {
  return `+${fee / 1000}k`;
}

/** Badge đơn shipper ngoài (hàng đợi, danh sách đơn của chủ): "Ship ngoài · trả 10k" — nhắc lấy tiền két đưa shipper. */
export function externalShipBadge(payout: Money): string {
  return `Ship ngoài · trả ${payout / 1000}k`;
}

export function assertQty(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new PricingError(`Số lượng phải là số nguyên dương (nhận ${qty})`);
  }
}

export function snapTopping(t: Topping): ToppingSnap {
  return { id: t.id, name: t.name, price: t.price, extra_box: t.extra_box_takeaway };
}

/** Tạo dòng đơn với giá chụp tại thời điểm bán. */
export function buildItem(
  id: string,
  product: Product,
  toppings: Topping[],
  qty = 1,
): OrderItem {
  assertQty(qty);
  if (!product.active) throw new PricingError(`Món "${product.name}" đã ngừng bán`);
  for (const t of toppings) {
    if (!t.active) throw new PricingError(`Topping "${t.name}" đã ngừng bán`);
    if (t.menu_id !== product.menu_id) throw new PricingError(`Topping "${t.name}" không thuộc menu của món`);
  }
  return {
    id,
    product_id: product.id,
    name_snap: product.name,
    unit_price_snap: product.price,
    qty,
    toppings_snap: [...toppings].sort((a, b) => a.sort - b.sort).map(snapTopping),
  };
}

/** Combo = đúng một món + các topping; giá = tổng thành phần (không có giá combo riêng). */
export function buildComboItem(
  id: string,
  combo: Combo,
  products: Product[],
  toppings: Topping[],
  qty = 1,
): OrderItem {
  if (!combo.active) throw new PricingError(`Combo "${combo.name}" đã ngừng bán`);
  const product = products.find((p) => p.id === combo.product_id);
  if (!product) throw new PricingError(`Combo "${combo.name}" thiếu món chính`);
  const tops = combo.topping_ids.map((tid) => {
    const t = toppings.find((x) => x.id === tid);
    if (!t) throw new PricingError(`Combo "${combo.name}" thiếu topping ${tid}`);
    return t;
  });
  return buildItem(id, product, tops, qty);
}

export function comboPrice(combo: Combo, products: Product[], toppings: Topping[]): Money {
  return lineTotal(buildComboItem('_', combo, products, toppings, 1));
}

export function setItemQty(item: OrderItem, qty: number): OrderItem {
  assertQty(qty);
  return { ...item, qty };
}

const bySort = <T extends { sort: number; name: string }>(a: T, b: T) =>
  a.sort - b.sort || a.name.localeCompare(b.name, 'vi');

export function selectableProducts(products: Product[], menuId: string): Product[] {
  return products.filter((p) => p.menu_id === menuId && p.active).sort(bySort);
}

export function selectableToppings(toppings: Topping[], menuId: string): Topping[] {
  return toppings.filter((t) => t.menu_id === menuId && t.active).sort(bySort);
}

/** Combo chỉ hiện khi bản thân combo và mọi thành phần còn bán. */
export function selectableCombos(
  combos: Combo[],
  products: Product[],
  toppings: Topping[],
  menuId: string,
): Combo[] {
  const activeP = new Set(products.filter((p) => p.active).map((p) => p.id));
  const activeT = new Set(toppings.filter((t) => t.active).map((t) => t.id));
  return combos
    .filter(
      (c) =>
        c.menu_id === menuId &&
        c.active &&
        activeP.has(c.product_id) &&
        c.topping_ids.every((id) => activeT.has(id)),
    )
    .sort(bySort);
}
