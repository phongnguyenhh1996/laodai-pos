// Mô tả từng loại cài đặt cho màn danh sách + màn sửa dùng chung (SettingsPages.tsx).
import {
  CatalogError, checkCombo, checkMenu, checkPoint, checkProduct, checkStaff, checkTabletProfile, checkTopping,
  parseCountInput, parseMoneyInput,
} from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { formatDate, formatPhone, parseBirthday, parseIdNumber, parsePhone, type StaffDetails } from '@/domain/payroll';
import { comboPrice } from '@/domain/pricing';
import type { Combo, PointDineType, Menu, Point, Product, Staff, TabletProfile, Topping } from '@/domain/types';
import type { OwnerCatalog, SettingsTable } from './api';

export type FormValue = string | boolean | string[];
export type Form = Record<string, FormValue>;
export interface Option {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'money' | 'count' | 'bool' | 'select' | 'multi' | 'date';
  options?: (form: Form, cat: OwnerCatalog) => Option[];
  /** Chỉ chọn lúc tạo mới (vd. menu của món: đổi về sau làm combo / đơn cũ lệch menu). */
  createOnly?: boolean;
  hint?: string;
  /** Ô text: bàn phím số (vd. CCCD) hoặc bàn phím điện thoại. */
  numeric?: boolean;
  tel?: boolean;
  /** Tiêu đề nhóm hiện phía trên ô này. */
  section?: string;
}

type Row = { id: string; name: string; active?: boolean };

export interface EntityDef {
  /** Đoạn URL `/owner/settings/:key`. */
  key: string;
  table: SettingsTable;
  title: string;
  noun: string;
  rows(cat: OwnerCatalog): Row[];
  summary(row: Row, cat: OwnerCatalog): string;
  fields: FieldDef[];
  toForm(row: Row | null, cat: OwnerCatalog): Form;
  /** Đọc form thành dòng để lưu; số không đọc được / dữ liệu sai ⇒ CatalogError. */
  fromForm(form: Form, cat: OwnerCatalog, selfId: string | null): Record<string, unknown>;
  priceHistory?: 'product' | 'topping';
  /** Dòng phụ dưới form (vd. giá combo tự tính). */
  preview?(form: Form, cat: OwnerCatalog): string | null;
  /**
   * Phần lưu ở bảng riêng chỉ chủ đọc được (SĐT / CCCD / sinh nhật / lương ngày của nhân viên). Đọc + kiểm tra cùng lúc với `fromForm`
   * (trước khi ghi gì); null = không đổi so với dữ liệu đang có, khỏi ghi.
   */
  details?(form: Form, cat: OwnerCatalog, selfId: string | null): Omit<StaffDetails, 'id'> | null;
}

// ---------------------------------------------------------------- đọc form

const str = (f: Form, k: string) => String(f[k] ?? '');
const bool = (f: Form, k: string) => f[k] === true;
const list = (f: Form, k: string) => (Array.isArray(f[k]) ? (f[k] as string[]) : []);

function money(f: Form, k: string, label: string): number {
  const n = parseMoneyInput(str(f, k));
  if (n === null) throw new CatalogError(`${label}: nhập số tiền, vd. 25000 hoặc 25k`);
  return n;
}

function count(f: Form, k: string, label: string): number {
  const n = parseCountInput(str(f, k));
  if (n === null) throw new CatalogError(`${label} phải là số nguyên ≥ 0`);
  return n;
}

const menuName = (cat: OwnerCatalog, id: string) => cat.menus.find((m) => m.id === id)?.name ?? '?';
const menuOptions = (_f: Form, cat: OwnerCatalog): Option[] => cat.menus.map((m) => ({ value: m.id, label: m.name }));
const firstMenu = (cat: OwnerCatalog) => cat.menus[0]?.id ?? '';
const nextSort = (rows: Array<{ sort: number }>) => String(rows.reduce((m, r) => Math.max(m, r.sort), 0) + 1);
const inactive = (label: string, active: boolean) => (active ? label : `${label} (ngừng)`);

const SORT_FIELD: FieldDef = { key: 'sort', label: 'Thứ tự hiển thị', kind: 'count' };
const PRICE_HINT = 'Giá mới chỉ áp dụng cho đơn tạo sau khi lưu; đơn đang mở giữ giá cũ.';

// ---------------------------------------------------------------- các loại cài đặt

const products: EntityDef = {
  key: 'products',
  table: 'products',
  title: 'Món & giá',
  noun: 'món',
  rows: (c) => c.products,
  summary: (r, c) => {
    const p = r as Product;
    return `${menuName(c, p.menu_id)} · ${formatVnd(p.price)}`;
  },
  fields: [
    { key: 'menu_id', label: 'Menu', kind: 'select', options: menuOptions, createOnly: true },
    { key: 'name', label: 'Tên món', kind: 'text' },
    { key: 'price', label: 'Giá', kind: 'money', hint: PRICE_HINT },
    { key: 'boxes_takeaway', label: 'Số hộp mỗi phần khi mang về', kind: 'count' },
    { key: 'boxes_dinein', label: 'Số hộp mỗi phần khi ăn tại chỗ', kind: 'count' },
    { key: 'plates_dinein', label: 'Số dĩa mỗi phần khi ăn tại chỗ', kind: 'count' },
    SORT_FIELD,
    { key: 'active', label: 'Đang bán', kind: 'bool' },
  ],
  toForm: (r, c) => {
    const p = r as Product | null;
    return {
      menu_id: p?.menu_id ?? firstMenu(c),
      name: p?.name ?? '',
      price: p ? String(p.price) : '',
      boxes_takeaway: String(p?.boxes_takeaway ?? 1),
      boxes_dinein: String(p?.boxes_dinein ?? 0),
      plates_dinein: String(p?.plates_dinein ?? 0),
      sort: p ? String(p.sort) : nextSort(c.products),
      active: p?.active ?? true,
    };
  },
  fromForm: (f, c, selfId) => {
    const v: Omit<Product, 'id'> = {
      menu_id: str(f, 'menu_id'),
      name: str(f, 'name').trim(),
      price: money(f, 'price', 'Giá'),
      boxes_takeaway: count(f, 'boxes_takeaway', 'Số hộp khi mang về'),
      boxes_dinein: count(f, 'boxes_dinein', 'Số hộp khi ăn tại chỗ'),
      plates_dinein: count(f, 'plates_dinein', 'Số dĩa khi ăn tại chỗ'),
      sort: count(f, 'sort', 'Thứ tự'),
      active: bool(f, 'active'),
    };
    checkProduct(v, c, selfId);
    return v;
  },
  priceHistory: 'product',
};

const toppings: EntityDef = {
  key: 'toppings',
  table: 'toppings',
  title: 'Topping',
  noun: 'topping',
  rows: (c) => c.toppings,
  summary: (r, c) => {
    const t = r as Topping;
    return `${menuName(c, t.menu_id)} · ${formatVnd(t.price)}${t.extra_box_takeaway ? ' · thêm hộp' : ''}`;
  },
  fields: [
    { key: 'menu_id', label: 'Menu', kind: 'select', options: menuOptions, createOnly: true },
    { key: 'name', label: 'Tên topping', kind: 'text' },
    { key: 'price', label: 'Giá', kind: 'money', hint: PRICE_HINT },
    { key: 'extra_box_takeaway', label: 'Thêm 1 hộp khi mang về (canh, dưa…)', kind: 'bool' },
    SORT_FIELD,
    { key: 'active', label: 'Đang bán', kind: 'bool' },
  ],
  toForm: (r, c) => {
    const t = r as Topping | null;
    return {
      menu_id: t?.menu_id ?? firstMenu(c),
      name: t?.name ?? '',
      price: t ? String(t.price) : '',
      extra_box_takeaway: t?.extra_box_takeaway ?? false,
      sort: t ? String(t.sort) : nextSort(c.toppings),
      active: t?.active ?? true,
    };
  },
  fromForm: (f, c, selfId) => {
    const v: Omit<Topping, 'id'> = {
      menu_id: str(f, 'menu_id'),
      name: str(f, 'name').trim(),
      price: money(f, 'price', 'Giá'),
      extra_box_takeaway: bool(f, 'extra_box_takeaway'),
      sort: count(f, 'sort', 'Thứ tự'),
      active: bool(f, 'active'),
    };
    checkTopping(v, c, selfId);
    return v;
  },
  priceHistory: 'topping',
};

const combos: EntityDef = {
  key: 'combos',
  table: 'combos',
  title: 'Combo',
  noun: 'combo',
  rows: (c) => c.combos,
  summary: (r, c) => {
    const cb = r as Combo;
    try {
      return `${menuName(c, cb.menu_id)} · ${formatVnd(comboPrice({ ...cb, active: true }, c.products, c.toppings))}`;
    } catch {
      return `${menuName(c, cb.menu_id)} · thiếu thành phần`;
    }
  },
  fields: [
    { key: 'menu_id', label: 'Menu', kind: 'select', options: menuOptions, createOnly: true },
    { key: 'name', label: 'Tên combo', kind: 'text' },
    {
      key: 'product_id',
      label: 'Món chính',
      kind: 'select',
      options: (f, c) => [
        { value: '', label: '— Chọn món —' },
        ...c.products
          .filter((p) => p.menu_id === str(f, 'menu_id'))
          .map((p) => ({ value: p.id, label: `${inactive(p.name, p.active)} · ${formatVnd(p.price)}` })),
      ],
    },
    {
      key: 'topping_ids',
      label: 'Topping kèm',
      kind: 'multi',
      options: (f, c) =>
        c.toppings
          .filter((t) => t.menu_id === str(f, 'menu_id'))
          .map((t) => ({ value: t.id, label: `${inactive(t.name, t.active)} · ${formatVnd(t.price)}` })),
    },
    SORT_FIELD,
    { key: 'active', label: 'Đang bán', kind: 'bool' },
  ],
  toForm: (r, c) => {
    const cb = r as Combo | null;
    return {
      menu_id: cb?.menu_id ?? firstMenu(c),
      name: cb?.name ?? '',
      product_id: cb?.product_id ?? '',
      topping_ids: cb?.topping_ids ?? [],
      sort: cb ? String(cb.sort) : nextSort(c.combos),
      active: cb?.active ?? true,
    };
  },
  fromForm: (f, c, selfId) => {
    const menuId = str(f, 'menu_id');
    const v: Omit<Combo, 'id'> = {
      menu_id: menuId,
      name: str(f, 'name').trim(),
      product_id: str(f, 'product_id'),
      // Topping của menu khác (còn sót khi đổi menu lúc tạo mới) bị bỏ, giữ thứ tự hiển thị.
      topping_ids: c.toppings.filter((t) => t.menu_id === menuId && list(f, 'topping_ids').includes(t.id)).map((t) => t.id),
      sort: count(f, 'sort', 'Thứ tự'),
      active: bool(f, 'active'),
    };
    checkCombo(v, c, selfId);
    return v;
  },
  preview: (f, c) => {
    const product = c.products.find((p) => p.id === str(f, 'product_id'));
    if (!product) return null;
    const tops = c.toppings.filter((t) => list(f, 'topping_ids').includes(t.id));
    const price = product.price + tops.reduce((s, t) => s + t.price, 0);
    return `Giá combo = tổng thành phần = ${formatVnd(price)} (không có giá riêng, không giảm giá)`;
  },
};

const detailsOf = (c: OwnerCatalog, id: string | null | undefined) => (id ? c.staffDetails.find((d) => d.id === id) : undefined);

const staff: EntityDef = {
  key: 'staff',
  table: 'staff',
  title: 'Nhân viên',
  noun: 'nhân viên',
  rows: (c) => c.staff,
  summary: (r, c) => {
    const d = detailsOf(c, r.id);
    if (!d) return '';
    return [
      d.phone ? formatPhone(d.phone) : null,
      d.day_rate ? `${formatVnd(d.day_rate)} / ngày` : null,
      d.birthday ? `SN ${formatDate(d.birthday).slice(0, 5)}` : null,
    ].filter(Boolean).join(' · ');
  },
  fields: [
    { key: 'name', label: 'Tên (nhân viên chọn tên khi mở ca)', kind: 'text' },
    { key: 'phone', label: 'Số điện thoại (tuỳ chọn)', kind: 'text', tel: true },
    { key: 'id_number', label: 'Căn cước công dân (tuỳ chọn)', kind: 'text', numeric: true, hint: '12 số, hoặc CMND cũ 9 số. Số điện thoại, CCCD, sinh nhật, lương chỉ chủ xem được.' },
    { key: 'birthday', label: 'Sinh nhật (tuỳ chọn)', kind: 'date' },
    {
      key: 'day_rate',
      label: 'Lương một ngày',
      kind: 'money',
      section: 'Lương',
      hint: 'Lương tháng = số ngày có mở ca × lương một ngày (mở nhiều ca trong ngày vẫn tính 1 ngày), chủ cộng / trừ ngày công ở màn Lương. Đổi lương ngày áp dụng cho cả tháng đang tính.',
    },
    { ...SORT_FIELD, section: 'Khác' },
    { key: 'active', label: 'Đang làm', kind: 'bool' },
  ],
  toForm: (r, c) => {
    const s = r as Staff | null;
    const d = detailsOf(c, s?.id);
    return {
      name: s?.name ?? '',
      phone: d?.phone ? formatPhone(d.phone) : '',
      id_number: d?.id_number ?? '',
      birthday: d?.birthday ?? '',
      day_rate: String(d?.day_rate ?? 0),
      sort: s ? String(s.sort) : nextSort(c.staff),
      active: s?.active ?? true,
    };
  },
  fromForm: (f, c, selfId) => {
    const v: Omit<Staff, 'id'> = { name: str(f, 'name').trim(), sort: count(f, 'sort', 'Thứ tự'), active: bool(f, 'active') };
    checkStaff(v, c.staff, selfId);
    return v;
  },
  details: (f, c, selfId) => {
    const v: Omit<StaffDetails, 'id'> = {
      phone: parsePhone(str(f, 'phone')),
      id_number: parseIdNumber(str(f, 'id_number')),
      birthday: parseBirthday(str(f, 'birthday')),
      day_rate: money(f, 'day_rate', 'Lương một ngày'),
    };
    const old = detailsOf(c, selfId);
    const same = old
      ? old.phone === v.phone && old.id_number === v.id_number && old.birthday === v.birthday && old.day_rate === v.day_rate
      : v.phone === null && v.id_number === null && v.birthday === null && v.day_rate === 0;
    return same ? null : v;
  },
};

const DINE_OPTIONS: Option[] = [
  { value: 'takeaway', label: 'Mang về' },
  { value: 'dinein', label: 'Tại chỗ' },
];

const points: EntityDef = {
  key: 'points',
  table: 'points',
  title: 'Điểm bán',
  noun: 'điểm bán',
  rows: (c) => c.points,
  summary: (r, c) => {
    const p = r as Point;
    return `Menu ${menuName(c, p.menu_id)} · mặc định ${p.default_dine_type === 'dinein' ? 'Tại chỗ' : 'Mang về'}`;
  },
  fields: [
    { key: 'name', label: 'Tên điểm bán', kind: 'text' },
    { key: 'menu_id', label: 'Menu', kind: 'select', options: menuOptions },
    { key: 'default_dine_type', label: 'Mặc định khi tạo đơn', kind: 'select', options: () => DINE_OPTIONS },
    SORT_FIELD,
    { key: 'active', label: 'Đang hoạt động', kind: 'bool' },
  ],
  toForm: (r, c) => {
    const p = r as Point | null;
    return {
      name: p?.name ?? '',
      menu_id: p?.menu_id ?? firstMenu(c),
      default_dine_type: p?.default_dine_type ?? 'takeaway',
      sort: p ? String(p.sort) : nextSort(c.points),
      active: p?.active ?? true,
    };
  },
  fromForm: (f, c, selfId) => {
    const v: Omit<Point, 'id'> = {
      name: str(f, 'name').trim(),
      menu_id: str(f, 'menu_id'),
      default_dine_type: str(f, 'default_dine_type') as PointDineType,
      sort: count(f, 'sort', 'Thứ tự'),
      active: bool(f, 'active'),
    };
    checkPoint(v, c, selfId);
    return v;
  },
};

const profiles: EntityDef = {
  key: 'profiles',
  table: 'tablet_profiles',
  title: 'Quầy',
  noun: 'quầy',
  rows: (c) => c.profiles,
  summary: (r, c) => {
    const p = r as TabletProfile;
    const names = c.points.filter((x) => p.point_ids.includes(x.id)).map((x) => x.name);
    return `${names.join(', ') || 'chưa có điểm bán'} · đầu ca ${p.default_boxes} hộp, ${p.default_plates} dĩa, ${formatVnd(p.default_float)} tiền lẻ`;
  },
  fields: [
    { key: 'name', label: 'Tên quầy', kind: 'text' },
    {
      key: 'point_ids',
      label: 'Điểm bán ở quầy này (thành tab khi tạo đơn)',
      kind: 'multi',
      options: (_f, c) => c.points.map((p) => ({ value: p.id, label: inactive(p.name, p.active) })),
    },
    { key: 'default_boxes', label: 'Số hộp đầu ca', kind: 'count' },
    { key: 'default_plates', label: 'Số dĩa đầu ca', kind: 'count' },
    { key: 'default_float', label: 'Tiền lẻ đầu ca', kind: 'money' },
  ],
  toForm: (r) => {
    const p = r as TabletProfile | null;
    return {
      name: p?.name ?? '',
      point_ids: p?.point_ids ?? [],
      default_boxes: String(p?.default_boxes ?? 0),
      default_plates: String(p?.default_plates ?? 0),
      default_float: String(p?.default_float ?? 0),
    };
  },
  fromForm: (f, c, selfId) => {
    const v: Omit<TabletProfile, 'id'> = {
      name: str(f, 'name').trim(),
      // Giữ thứ tự điểm bán như trong danh mục
      point_ids: c.points.filter((p) => list(f, 'point_ids').includes(p.id)).map((p) => p.id),
      default_boxes: count(f, 'default_boxes', 'Số hộp đầu ca'),
      default_plates: count(f, 'default_plates', 'Số dĩa đầu ca'),
      default_float: money(f, 'default_float', 'Tiền lẻ đầu ca'),
    };
    checkTabletProfile(v, c, selfId);
    return v;
  },
};

const menus: EntityDef = {
  key: 'menus',
  table: 'menus',
  title: 'Menu',
  noun: 'menu',
  rows: (c) => c.menus,
  summary: (r, c) => {
    const n = c.products.filter((p) => p.menu_id === r.id).length;
    const used = c.points.filter((p) => p.menu_id === r.id).map((p) => p.name);
    return `${n} món${used.length ? ` · dùng ở ${used.join(', ')}` : ''}`;
  },
  fields: [{ key: 'name', label: 'Tên menu', kind: 'text' }],
  toForm: (r) => ({ name: (r as Menu | null)?.name ?? '' }),
  fromForm: (f, c, selfId) => {
    const v: Omit<Menu, 'id'> = { name: str(f, 'name').trim() };
    checkMenu(v, c.menus, selfId);
    return v;
  },
};

export const ENTITIES: EntityDef[] = [products, toppings, combos, menus, points, profiles, staff];

export function entityByKey(key: string | undefined): EntityDef | undefined {
  return ENTITIES.find((e) => e.key === key);
}
