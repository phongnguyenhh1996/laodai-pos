// Danh mục (menu, món, topping, combo, điểm bán, nhân viên, hồ sơ tablet):
// kiểm tra dữ liệu chủ nhập ở Cài đặt và cách tablet dựng bảng chọn từ danh mục đã đồng bộ.
import { comboPrice, selectableCombos, selectableProducts, selectableToppings } from './pricing';
import type { Combo, Menu, Money, Point, Product, Staff, TabletProfile, Topping } from './types';

export class CatalogError extends Error {}

// ---------------------------------------------------------------- nhập số

/** Ô nhập tiền: "25.000", "25 000", "25,000", "25000", "25k" → 25000. Không hợp lệ → null. */
export function parseMoneyInput(raw: string): Money | null {
  const m = /^(\d+)(k?)$/.exec(raw.trim().toLowerCase().replace(/[\s.,]/g, ''));
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isSafeInteger(n) ? n : null;
}

/** Ô nhập số đếm (hộp, dĩa, thứ tự): số nguyên ≥ 0. Không hợp lệ → null. */
export function parseCountInput(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

// ---------------------------------------------------------------- tablet dựng bảng chọn

type Sortable = { sort: number; name: string };
const bySortName = (a: Sortable, b: Sortable) => a.sort - b.sort || a.name.localeCompare(b.name, 'vi');

export function sortCatalog<T extends Sortable>(rows: readonly T[]): T[] {
  return [...rows].sort(bySortName);
}

/** Tab điểm bán trên tablet: chỉ điểm thuộc hồ sơ tablet và còn hoạt động. */
export function tabletPoints(profile: Pick<TabletProfile, 'point_ids'>, points: readonly Point[]): Point[] {
  const allowed = new Set(profile.point_ids);
  return sortCatalog(points.filter((p) => allowed.has(p.id) && p.active));
}

/** Danh sách chọn tên khi mở ca. */
export function activeStaff(staff: readonly Staff[]): Staff[] {
  return sortCatalog(staff.filter((s) => s.active));
}

export interface MenuBoard {
  combos: Array<{ combo: Combo; price: Money }>;
  products: Product[];
  toppings: Topping[];
}

/** Bảng chọn của một menu: chỉ thứ còn bán; giá combo = tổng thành phần. */
export function menuBoard(
  menuId: string,
  products: Product[],
  toppings: Topping[],
  combos: Combo[],
): MenuBoard {
  return {
    combos: selectableCombos(combos, products, toppings, menuId).map((combo) => ({
      combo,
      price: comboPrice(combo, products, toppings),
    })),
    products: selectableProducts(products, menuId),
    toppings: selectableToppings(toppings, menuId),
  };
}

// ---------------------------------------------------------------- kiểm tra dữ liệu chủ nhập

type Named = { id: string; name: string };

function checkName(name: string, what: string): void {
  if (!name.trim()) throw new CatalogError(`Cần nhập tên ${what}`);
  if (name.trim().length > 60) throw new CatalogError(`Tên ${what} quá dài (tối đa 60 ký tự)`);
}

/** Tên trùng (không phân biệt hoa thường / dấu cách thừa) dễ gây bấm nhầm trên tablet ⇒ không cho. */
function checkUnique(name: string, others: readonly Named[], selfId: string | null, what: string): void {
  const key = name.trim().toLocaleLowerCase('vi').replace(/\s+/g, ' ');
  const dup = others.find((o) => o.id !== selfId && o.name.trim().toLocaleLowerCase('vi').replace(/\s+/g, ' ') === key);
  if (dup) throw new CatalogError(`Đã có ${what} tên "${dup.name}"`);
}

function checkCount(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 0) throw new CatalogError(`${label} phải là số nguyên ≥ 0`);
}

function checkMenuId(menuId: string, menus: readonly Menu[]): void {
  if (!menus.some((m) => m.id === menuId)) throw new CatalogError('Cần chọn menu');
}

export function checkMenu(m: Omit<Menu, 'id'>, menus: readonly Menu[], selfId: string | null = null): void {
  checkName(m.name, 'menu');
  checkUnique(m.name, menus, selfId, 'menu');
}

export function checkProduct(
  p: Omit<Product, 'id'>,
  ctx: { menus: readonly Menu[]; products: readonly Product[] },
  selfId: string | null = null,
): void {
  checkName(p.name, 'món');
  checkMenuId(p.menu_id, ctx.menus);
  checkUnique(p.name, ctx.products.filter((x) => x.menu_id === p.menu_id), selfId, 'món');
  checkCount(p.price, 'Giá');
  checkCount(p.sort, 'Thứ tự');
  checkCount(p.boxes_takeaway, 'Số hộp khi mang về');
  checkCount(p.boxes_dinein, 'Số hộp khi ăn tại chỗ');
  checkCount(p.plates_dinein, 'Số dĩa khi ăn tại chỗ');
}

export function checkTopping(
  t: Omit<Topping, 'id'>,
  ctx: { menus: readonly Menu[]; toppings: readonly Topping[] },
  selfId: string | null = null,
): void {
  checkName(t.name, 'topping');
  checkMenuId(t.menu_id, ctx.menus);
  checkUnique(t.name, ctx.toppings.filter((x) => x.menu_id === t.menu_id), selfId, 'topping');
  checkCount(t.price, 'Giá');
  checkCount(t.sort, 'Thứ tự');
}

/** Combo = 1 món + các topping cùng menu; không có giá riêng (giả định 11.2). */
export function checkCombo(
  c: Omit<Combo, 'id'>,
  ctx: { menus: readonly Menu[]; products: readonly Product[]; toppings: readonly Topping[]; combos: readonly Combo[] },
  selfId: string | null = null,
): void {
  checkName(c.name, 'combo');
  checkMenuId(c.menu_id, ctx.menus);
  checkUnique(c.name, ctx.combos.filter((x) => x.menu_id === c.menu_id), selfId, 'combo');
  checkCount(c.sort, 'Thứ tự');
  const product = ctx.products.find((p) => p.id === c.product_id);
  if (!product) throw new CatalogError('Cần chọn món chính cho combo');
  if (product.menu_id !== c.menu_id) throw new CatalogError(`Món "${product.name}" không thuộc menu của combo`);
  if (new Set(c.topping_ids).size !== c.topping_ids.length) throw new CatalogError('Topping bị chọn trùng');
  for (const id of c.topping_ids) {
    const t = ctx.toppings.find((x) => x.id === id);
    if (!t) throw new CatalogError('Topping không tồn tại');
    if (t.menu_id !== c.menu_id) throw new CatalogError(`Topping "${t.name}" không thuộc menu của combo`);
  }
}

export function checkStaff(s: Omit<Staff, 'id'>, staff: readonly Staff[], selfId: string | null = null): void {
  checkName(s.name, 'nhân viên');
  // Nhân viên chọn tên khi mở ca: hai người trùng tên là không phân biệt được.
  checkUnique(s.name, staff, selfId, 'nhân viên');
  checkCount(s.sort, 'Thứ tự');
}

export function checkPoint(
  p: Omit<Point, 'id'>,
  ctx: { menus: readonly Menu[]; points: readonly Point[] },
  selfId: string | null = null,
): void {
  checkName(p.name, 'điểm bán');
  checkUnique(p.name, ctx.points, selfId, 'điểm bán');
  checkMenuId(p.menu_id, ctx.menus);
  if (p.default_dine_type !== 'dinein' && p.default_dine_type !== 'takeaway') {
    throw new CatalogError('Cần chọn mặc định Tại chỗ / Mang về');
  }
  checkCount(p.sort, 'Thứ tự');
}

export function checkTabletProfile(
  p: Omit<TabletProfile, 'id'>,
  ctx: { points: readonly Point[]; profiles: readonly TabletProfile[] },
  selfId: string | null = null,
): void {
  checkName(p.name, 'quầy');
  checkUnique(p.name, ctx.profiles, selfId, 'quầy');
  if (p.point_ids.length === 0) throw new CatalogError('Quầy cần ít nhất một điểm bán');
  if (new Set(p.point_ids).size !== p.point_ids.length) throw new CatalogError('Điểm bán bị chọn trùng');
  for (const id of p.point_ids) {
    if (!ctx.points.some((x) => x.id === id)) throw new CatalogError('Điểm bán không tồn tại');
  }
  checkCount(p.default_boxes, 'Số hộp đầu ca');
  checkCount(p.default_plates, 'Số dĩa đầu ca');
  checkCount(p.default_float, 'Tiền lẻ đầu ca');
}
