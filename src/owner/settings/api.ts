import type { SupabaseClient } from '@supabase/supabase-js';
import { sortCatalog } from '@/domain/catalog';
import type { StaffDetails } from '@/domain/payroll';
import type { Combo, Menu, Point, Product, Staff, TabletProfile, Topping } from '@/domain/types';

/** Toàn bộ danh mục cho màn Cài đặt (dữ liệu nhỏ: tải hết một lần, tải lại sau mỗi lần lưu). */
export interface OwnerCatalog {
  menus: Menu[];
  points: Point[];
  products: Product[];
  toppings: Topping[];
  combos: Combo[];
  staff: Staff[];
  /** SĐT, CCCD, sinh nhật, lương ngày (chỉ chủ đọc được). Nhân viên chưa có dòng = chưa nhập. */
  staffDetails: StaffDetails[];
  profiles: TabletProfile[];
}

export type SettingsTable = 'menus' | 'points' | 'products' | 'toppings' | 'combos' | 'staff' | 'tablet_profiles';

const COLUMNS: Record<SettingsTable, string> = {
  menus: 'id,name',
  points: 'id,name,menu_id,active,default_dine_type,sort',
  products: 'id,menu_id,name,price,sort,active,boxes_takeaway,boxes_dinein,plates_dinein',
  toppings: 'id,menu_id,name,price,extra_box_takeaway,sort,active',
  combos: 'id,menu_id,name,product_id,topping_ids,sort,active',
  staff: 'id,name,active,sort',
  tablet_profiles: 'id,name,point_ids,default_boxes,default_plates,default_float',
};

export class SettingsError extends Error {}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Tên này đã có, hãy đặt tên khác';
  if (error.code === '42501') return 'Không có quyền sửa cài đặt';
  return error.message;
}

async function rows<T>(client: SupabaseClient, table: SettingsTable): Promise<T[]> {
  const { data, error } = await client.from(table).select(COLUMNS[table]);
  if (error) throw new SettingsError(`Không tải được dữ liệu: ${friendly(error)}`);
  return (data ?? []) as T[];
}

export async function loadOwnerCatalog(client: SupabaseClient): Promise<OwnerCatalog> {
  const [menus, points, products, toppings, combos, staff, profiles, staffDetails] = await Promise.all([
    rows<Menu>(client, 'menus'),
    rows<Point>(client, 'points'),
    rows<Product>(client, 'products'),
    rows<Topping>(client, 'toppings'),
    rows<Combo>(client, 'combos'),
    rows<Staff>(client, 'staff'),
    rows<TabletProfile>(client, 'tablet_profiles'),
    loadStaffDetails(client),
  ]);
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'vi');
  return {
    menus: [...menus].sort(byName),
    points: sortCatalog(points),
    products: sortCatalog(products),
    toppings: sortCatalog(toppings),
    combos: sortCatalog(combos),
    staff: sortCatalog(staff),
    staffDetails,
    profiles: [...profiles].sort(byName),
  };
}

/**
 * Tạo (id = null) hoặc sửa một dòng cài đặt. Không có xóa: ngừng bán / nghỉ việc = active=false.
 * Đổi giá ⇒ trigger ghi `price_history`; mọi thay đổi ⇒ trigger ghi `audit_log`.
 */
export async function saveSetting(
  client: SupabaseClient,
  table: SettingsTable,
  id: string | null,
  values: Record<string, unknown>,
): Promise<string> {
  if (id) {
    const { data, error } = await client.from(table).update(values).eq('id', id).select('id');
    if (error) throw new SettingsError(friendly(error));
    if (!data?.length) throw new SettingsError('Không lưu được (không có quyền hoặc dữ liệu không còn)');
    return id;
  }
  const { data, error } = await client.from(table).insert(values).select('id').single();
  if (error) throw new SettingsError(friendly(error));
  return (data as { id: string }).id;
}

export const STAFF_DETAILS_COLUMNS = 'id,phone,id_number,birthday,day_rate';

export async function loadStaffDetails(client: SupabaseClient): Promise<StaffDetails[]> {
  const { data, error } = await client.from('staff_details').select(STAFF_DETAILS_COLUMNS);
  if (error) throw new SettingsError(`Không tải được thông tin nhân viên: ${friendly(error)}`);
  return (data ?? []) as StaffDetails[];
}

/** Ghi SĐT / CCCD / sinh nhật / lương ngày của nhân viên `id` (tạo dòng nếu chưa có). Mỗi lần ghi ⇒ nhật ký. */
export async function saveStaffDetails(client: SupabaseClient, id: string, values: Omit<StaffDetails, 'id'>): Promise<void> {
  const { error } = await client.from('staff_details').upsert({ id, ...values });
  if (error) {
    if (error.code === '23514') throw new SettingsError('Số điện thoại, căn cước công dân hoặc sinh nhật không hợp lệ');
    throw new SettingsError(`Không lưu được thông tin nhân viên: ${friendly(error)}`);
  }
}

export interface PriceChange {
  id: string;
  old_price: number;
  new_price: number;
  changed_at: string;
}

export async function loadPriceHistory(
  client: SupabaseClient,
  type: 'product' | 'topping',
  entityId: string,
): Promise<PriceChange[]> {
  const { data, error } = await client
    .from('price_history')
    .select('id,old_price,new_price,changed_at')
    .eq('entity_type', type)
    .eq('entity_id', entityId)
    .order('changed_at', { ascending: false });
  if (error) throw new SettingsError(`Không tải được lịch sử giá: ${friendly(error)}`);
  return (data ?? []) as PriceChange[];
}
