import type { DineType, OrderItem, Product } from './types';

export interface Packaging {
  boxes: number;
  plates: number;
}

export type PackagingNorms = Pick<Product, 'id' | 'boxes_takeaway' | 'boxes_dinein' | 'plates_dinein'>;

/**
 * Định mức bao bì cho một dòng đơn.
 * - Mang về: qty × (boxes_takeaway + số topping có cờ extra_box)
 * - Tại chỗ:  qty × boxes_dinein hộp, qty × plates_dinein dĩa (topping có cờ không tính)
 */
export function itemPackaging(
  item: Pick<OrderItem, 'qty' | 'toppings_snap'>,
  norms: PackagingNorms,
  dineType: DineType,
): Packaging {
  if (dineType === 'takeaway') {
    const extra = item.toppings_snap.filter((t) => t.extra_box).length;
    return { boxes: item.qty * (norms.boxes_takeaway + extra), plates: 0 };
  }
  return { boxes: item.qty * norms.boxes_dinein, plates: item.qty * norms.plates_dinein };
}

export function orderPackaging(
  order: { dine_type: DineType; items: Array<Pick<OrderItem, 'product_id' | 'qty' | 'toppings_snap'>> },
  normsById: Map<string, PackagingNorms> | Record<string, PackagingNorms>,
): Packaging {
  const get = (id: string) =>
    normsById instanceof Map ? normsById.get(id) : (normsById as Record<string, PackagingNorms>)[id];
  return order.items.reduce<Packaging>(
    (acc, it) => {
      const norms = get(it.product_id);
      if (!norms) throw new Error(`Thiếu định mức bao bì cho món ${it.product_id}`);
      const p = itemPackaging(it, norms, order.dine_type);
      return { boxes: acc.boxes + p.boxes, plates: acc.plates + p.plates };
    },
    { boxes: 0, plates: 0 },
  );
}
