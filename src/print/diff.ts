import type { OrderItem } from '@/domain/types';
import type { EditLine } from './types';

/** Khóa gộp: cùng món + cùng bộ topping (không phân biệt thứ tự topping) là một loại. */
function key(name: string, toppings: string[]): string {
  return `${name}\u0000${[...toppings].sort().join('\u0001')}`;
}

function tally(items: OrderItem[]): Map<string, EditLine> {
  const m = new Map<string, EditLine>();
  for (const it of items) {
    const toppings = it.toppings_snap.map((t) => t.name);
    const k = key(it.name_snap, toppings);
    const cur = m.get(k);
    if (cur) cur.qty += it.qty;
    else m.set(k, { name: it.name_snap, qty: it.qty, toppings: [...toppings].sort() });
  }
  return m;
}

/**
 * Món thêm / bớt khi sửa đơn (phiếu bếp "ĐÃ SỬA"). Đổi số lượng ⇒ thêm hoặc bớt phần chênh;
 * đổi topping ⇒ bớt loại cũ, thêm loại mới. Giữ thứ tự xuất hiện trong đơn.
 */
export function diffItems(before: OrderItem[], after: OrderItem[]): { added: EditLine[]; removed: EditLine[] } {
  const b = tally(before);
  const a = tally(after);
  const added: EditLine[] = [];
  const removed: EditLine[] = [];
  for (const [k, line] of a) {
    const d = line.qty - (b.get(k)?.qty ?? 0);
    if (d > 0) added.push({ ...line, qty: d });
  }
  for (const [k, line] of b) {
    const d = line.qty - (a.get(k)?.qty ?? 0);
    if (d > 0) removed.push({ ...line, qty: d });
  }
  return { added, removed };
}
