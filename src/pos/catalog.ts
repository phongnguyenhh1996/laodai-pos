import type { SupabaseClient } from '@supabase/supabase-js';
import type { Combo, Customer, Menu, Money, Point, Product, Staff, TabletProfile, Topping } from '@/domain/types';

/**
 * Danh mục của tablet: menu, món, topping, combo, điểm bán, nhân viên, hồ sơ tablet, ngưỡng màu chờ,
 * khách nợ + dư nợ. Tải bằng phiên vai trò `tablet` (RLS chỉ cho đọc đúng những thứ này), giữ trong bộ nhớ;
 * chủ đổi cài đặt ⇒ server báo qua Realtime (`live_pulse`) và tablet tải lại ngay.
 */

export interface TabletConfig {
  wait_yellow_min: number;
  wait_red_min: number;
  timezone: string;
}

export interface CatalogData {
  profile: TabletProfile;
  menus: Menu[];
  points: Point[];
  products: Product[];
  toppings: Topping[];
  combos: Combo[];
  staff: Staff[];
  config: TabletConfig;
  /** Khách nợ (gợi ý khi ghi nợ / thu nợ) và dư nợ theo khách gốc. */
  customers: Customer[];
  balances: Record<string, Money>;
}

export interface Catalog extends CatalogData {
  /** Thời điểm BẮT ĐẦU tải: mọi thao tác server nhận trước thời điểm này đã nằm trong danh mục. */
  fetched_at: string;
}

/** Nguồn danh mục (server). Lỗi mạng / hết phiên ⇒ ném lỗi, danh mục cũ được giữ nguyên. */
export type CatalogSource = (profileId: string) => Promise<CatalogData>;

export class CatalogFetchError extends Error {}

const COLUMNS = {
  menus: 'id,name',
  points: 'id,name,menu_id,active,default_dine_type,sort',
  products: 'id,menu_id,name,price,sort,active,boxes_takeaway,boxes_dinein,plates_dinein',
  toppings: 'id,menu_id,name,price,extra_box_takeaway,sort,active',
  combos: 'id,menu_id,name,product_id,topping_ids,sort,active',
  staff: 'id,name,active,sort',
  customers: 'id,name,description,phone,merged_into_id',
} as const;

const PROFILE_COLUMNS = 'id,name,point_ids,default_boxes,default_plates,default_float';

export function createSupabaseCatalogSource(client: SupabaseClient): CatalogSource {
  return async (profileId) => {
    const table = async <T>(name: keyof typeof COLUMNS): Promise<T[]> => {
      const { data, error } = await client.from(name).select(COLUMNS[name]);
      if (error) throw new CatalogFetchError(`Không tải được ${name}: ${error.message}`);
      return (data ?? []) as T[];
    };
    const profileQuery = async (): Promise<TabletProfile> => {
      const { data, error } = await client.from('tablet_profiles').select(PROFILE_COLUMNS).eq('id', profileId);
      if (error) throw new CatalogFetchError(`Không tải được hồ sơ tablet: ${error.message}`);
      // RLS: phiên không phải tablet của hồ sơ này (hết phiên, anon) ⇒ 0 dòng. Không được lưu danh mục rỗng.
      const p = (data as TabletProfile[] | null)?.[0];
      if (!p) throw new CatalogFetchError('Không đọc được hồ sơ tablet (phiên tablet không hợp lệ)');
      return p;
    };
    const configQuery = async (): Promise<TabletConfig> => {
      const { data, error } = await client.rpc('tablet_config');
      if (error) throw new CatalogFetchError(`Không tải được cấu hình: ${error.message}`);
      if (!data) throw new CatalogFetchError('Không tải được cấu hình');
      return data as TabletConfig;
    };
    const balancesQuery = async (): Promise<Record<string, Money>> => {
      const { data, error } = await client.rpc('customer_balances');
      if (error) throw new CatalogFetchError(`Không tải được dư nợ: ${error.message}`);
      return Object.fromEntries(((data ?? []) as Array<{ customer_id: string; balance: number }>).map((r) => [r.customer_id, r.balance]));
    };
    const [profile, config, menus, points, products, toppings, combos, staff, customers, balances] = await Promise.all([
      profileQuery(),
      configQuery(),
      table<Menu>('menus'),
      table<Point>('points'),
      table<Product>('products'),
      table<Topping>('toppings'),
      table<Combo>('combos'),
      table<Staff>('staff'),
      table<Customer>('customers'),
      balancesQuery(),
    ]);
    return { profile, config, menus, points, products, toppings, combos, staff, customers, balances };
  };
}
