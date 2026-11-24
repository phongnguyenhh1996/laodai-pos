// Mô tả từng loại cài đặt cho màn danh sách + màn sửa dùng chung (SettingsPages.tsx).
import { ListChecks, Printer, type LucideIcon } from 'lucide-react';
import {
  CatalogError, checkCombo, checkMenu, checkPoint, checkProduct, checkStaff, checkTabletProfile, checkTopping,
  parseCountInput,
} from '@/domain/catalog';
import { formatVnd } from '@/domain/money';
import { formatDate, formatPhone, parseBirthday, parseIdNumber, parsePhone, type StaffDetails } from '@/domain/payroll';
import { comboPrice } from '@/domain/pricing';
import { COUNT_ITEMS, DEFAULT_COUNT_ITEMS, type Combo, type CountItem, type PointDineType, type Menu, type Point, type Product, type Staff, type TabletProfile, type Topping } from '@/domain/types';
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
  /** Ô này mở một thẻ mới với tiêu đề này (ô đầu tiên không có ⇒ thẻ "Thông tin <noun>"). */
  section?: string;
  /** Dòng phụ dưới tiêu đề thẻ. */
  sectionHint?: string;
  /** Icon góc phải tiêu đề thẻ (Figma R32 "In tự động"). */
  sectionIcon?: LucideIcon;
  /** Tablet: thẻ này nằm cột phải. */
  side?: boolean;
  /** Ô nửa bề ngang: hai ô `half` liền nhau nằm chung một hàng. */
  half?: boolean;
  /** Đơn vị bên phải ô số (hộp, dĩa…). Ô tiền luôn có "đ". */
  unit?: string;
  /** Chỉ hiện khi điều kiện đúng (vd. số đầu ca của thứ đang bật đếm). */
  when?: (form: Form) => boolean;
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

/** Ô tiền giữ số đồng dạng chữ ("25000", MoneyInput đọc / ghi); trống ⇒ lỗi. */
function money(f: Form, k: string, label: string): number {
  const n = parseCountInput(str(f, k));
  if (n === null) throw new CatalogError(`${label}: nhập số tiền`);
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

/** Ô đầu ca chỉ hiện khi quầy bật đếm thứ đó. */
const counting = (k: CountItem) => (f: Form) => f[`count_${k}`] === true;

const SORT_FIELD: FieldDef = { key: 'sort', label: 'Thứ tự hiển thị', kind: 'count' };
/** Thẻ "Hiển thị" ở cột phải tablet: thứ tự + đang bán / đang làm. */
const SHOW_SECTION: Partial<FieldDef> = { section: 'Hiển thị', side: true };
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
    { key: 'boxes_takeaway', label: 'Hộp khi mang về', kind: 'count', unit: 'hộp', section: 'Hộp, dĩa & lon mỗi phần' },
    { key: 'boxes_dinein', label: 'Hộp khi ăn tại chỗ', kind: 'count', unit: 'hộp', half: true },
    { key: 'plates_dinein', label: 'Dĩa khi ăn tại chỗ', kind: 'count', unit: 'dĩa', half: true },
    { key: 'cans', label: 'Lon mỗi phần', kind: 'count', unit: 'lon', hint: 'Nước uống: tính như nhau cho tại chỗ, mang về, ship.' },
    { ...SORT_FIELD, ...SHOW_SECTION },
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
      cans: String(p?.cans ?? 0),
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
      cans: count(f, 'cans', 'Số lon mỗi phần'),
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
    { ...SORT_FIELD, ...SHOW_SECTION },
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
      section: 'Thành phần',
      sectionHint: 'Giá combo = tổng giá các thành phần',
      options: (f, c) => [
        { value: '', label: '— Chọn món —' },
        ...c.products.filter((p) => p.menu_id === str(f, 'menu_id')).map((p) => ({ value: p.id, label: `${inactive(p.name, p.active)} · ${formatVnd(p.price)}` })),
      ],
    },
    {
      key: 'topping_ids',
      label: 'Topping kèm',
      kind: 'multi',
      options: (f, c) => c.toppings.filter((t) => t.menu_id === str(f, 'menu_id')).map((t) => ({ value: t.id, label: `${inactive(t.name, t.active)} · ${formatVnd(t.price)}` })),
    },
    { ...SORT_FIELD, ...SHOW_SECTION },
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
    return [d.phone ? formatPhone(d.phone) : null, d.day_rate ? `${formatVnd(d.day_rate)} / ngày` : null, d.birthday ? `SN ${formatDate(d.birthday).slice(0, 5)}` : null].filter(Boolean).join(' · ');
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
      side: true,
      hint: 'Lương tháng = số ngày có mở ca × lương một ngày (mở nhiều ca trong ngày vẫn tính 1 ngày), chủ cộng / trừ ngày công ở màn Lương. Đổi lương ngày áp dụng cho cả tháng đang tính.',
    },
    { ...SORT_FIELD, ...SHOW_SECTION },
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
    { ...SORT_FIELD, ...SHOW_SECTION },
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
    const counts = p.count_items ?? DEFAULT_COUNT_ITEMS;
    const start = [
      counts.includes('boxes') && `${p.default_boxes} hộp`,
      counts.includes('plates') && `${p.default_plates} dĩa`,
      counts.includes('cans') && `${p.default_cans ?? 0} lon`,
      counts.includes('cash') && `${formatVnd(p.default_float)} tiền lẻ`,
    ].filter(Boolean);
    return `${names.join(', ') || 'chưa có điểm bán'} · ${start.length ? `đầu ca ${start.join(', ')}` : 'không đếm khi đóng ca'}`;
  },
  fields: [
    { key: 'name', label: 'Tên quầy', kind: 'text' },
    {
      key: 'point_ids',
      label: 'Điểm bán ở quầy này',
      kind: 'multi',
      section: 'Điểm bán ở quầy này',
      sectionHint: 'Mỗi điểm thành một tab khi tạo đơn',
      options: (_f, c) => c.points.map((p) => ({ value: p.id, label: inactive(p.name, p.active) })),
    },
    {
      key: 'default_boxes',
      label: 'Số hộp',
      kind: 'count',
      unit: 'hộp',
      half: true,
      section: 'Đầu ca mặc định',
      sectionHint: 'Chỉ hiện thứ đang bật đếm khi đóng ca',
      when: counting('boxes'),
    },
    { key: 'default_plates', label: 'Số dĩa', kind: 'count', unit: 'dĩa', half: true, when: counting('plates') },
    { key: 'default_cans', label: 'Số lon', kind: 'count', unit: 'lon', half: true, when: counting('cans') },
    { key: 'default_float', label: 'Tiền lẻ đầu ca', kind: 'money', when: counting('cash') },
    // Thứ nhân viên phải đếm khi đóng ca; ca chụp lại lúc mở ⇒ đổi áp dụng từ ca sau.
    {
      key: 'count_cash',
      label: 'Tiền mặt đếm được',
      kind: 'bool',
      section: 'Đếm khi đóng ca',
      sectionHint: 'Nhân viên phải nhập khi đóng ca · đổi áp dụng từ ca sau',
      sectionIcon: ListChecks,
      side: true,
    },
    { key: 'count_boxes', label: 'Số hộp còn lại', kind: 'bool' },
    { key: 'count_plates', label: 'Số dĩa sạch còn lại', kind: 'bool' },
    { key: 'count_cans', label: 'Số lon còn lại', kind: 'bool' },
    // SPEC 12.2: chỉ bật / tắt in TỰ ĐỘNG; bấm in tay lúc nào cũng in được.
    {
      key: 'auto_print_kitchen',
      label: 'Tự in phiếu bếp khi tạo đơn',
      kind: 'bool',
      section: 'In tự động',
      sectionHint: 'Chỉ áp dụng app Android có máy in',
      sectionIcon: Printer,
      side: true,
    },
    { key: 'auto_reprint_kitchen_on_edit', label: 'Tự in lại phiếu bếp khi sửa đơn', kind: 'bool' },
    { key: 'auto_print_bill', label: 'Tự in bill khi thanh toán xong', kind: 'bool' },
  ],
  toForm: (r) => {
    const p = r as TabletProfile | null;
    return {
      name: p?.name ?? '',
      point_ids: p?.point_ids ?? [],
      default_boxes: String(p?.default_boxes ?? 0),
      default_plates: String(p?.default_plates ?? 0),
      default_cans: String(p?.default_cans ?? 0),
      default_float: String(p?.default_float ?? 0),
      ...Object.fromEntries(COUNT_ITEMS.map((k) => [`count_${k}`, (p?.count_items ?? DEFAULT_COUNT_ITEMS).includes(k)])),
      auto_print_kitchen: p?.auto_print_kitchen !== false,
      auto_reprint_kitchen_on_edit: p?.auto_reprint_kitchen_on_edit !== false,
      auto_print_bill: p?.auto_print_bill !== false,
    };
  },
  fromForm: (f, c, selfId) => {
    const v: Omit<TabletProfile, 'id'> = {
      name: str(f, 'name').trim(),
      // Giữ thứ tự điểm bán như trong danh mục
      point_ids: c.points.filter((p) => list(f, 'point_ids').includes(p.id)).map((p) => p.id),
      default_boxes: count(f, 'default_boxes', 'Số hộp đầu ca'),
      default_plates: count(f, 'default_plates', 'Số dĩa đầu ca'),
      default_cans: count(f, 'default_cans', 'Số lon đầu ca'),
      default_float: money(f, 'default_float', 'Tiền lẻ đầu ca'),
      count_items: COUNT_ITEMS.filter((k) => f[`count_${k}`] === true),
      auto_print_kitchen: f.auto_print_kitchen === true,
      auto_reprint_kitchen_on_edit: f.auto_reprint_kitchen_on_edit === true,
      auto_print_bill: f.auto_print_bill === true,
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
