// Tablet giả cho test component: hồ sơ kích hoạt + danh mục đặt sẵn trong IndexedDB, không gọi server.
import { vi } from 'vitest';
import { COMBOS, COM_MENU, PRODUCTS, TOPPINGS, XOI_MENU } from '@/domain/fixtures';
import { localDb } from '@/lib/localdb';
import { catalogRefresher } from '@/lib/sync';
import type { Catalog } from '@/sync/catalog';
import { META, setMeta, type Activation } from '@/sync/db';
import { storeSession } from './auth';

export const ACT: Activation = { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: 'owner@x.vn' };

export const CATALOG: Catalog = {
  fetched_at: '2026-11-17T00:00:00.000Z',
  profile: { id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a', 'com'], default_boxes: 200, default_plates: 60, default_float: 500_000 },
  menus: [{ id: XOI_MENU, name: 'Xôi' }, { id: COM_MENU, name: 'Cơm gà' }],
  points: [
    { id: 'xoi-a', name: 'Xôi A', menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 1 },
    { id: 'xoi-b', name: 'Xôi B', menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 2 },
    { id: 'com', name: 'Cơm gà', menu_id: COM_MENU, active: true, default_dine_type: 'dinein', sort: 3 },
  ],
  products: PRODUCTS,
  toppings: TOPPINGS,
  combos: COMBOS,
  staff: [
    { id: 's1', name: 'Lan', active: true, sort: 1 },
    { id: 's2', name: 'Mai', active: true, sort: 2 },
    { id: 's9', name: 'Nghỉ việc', active: false, sort: 3 },
  ],
  config: { wait_yellow_min: 5, wait_red_min: 10, timezone: 'Asia/Ho_Chi_Minh' },
};

/** Không gọi server: danh mục được đặt sẵn trong IndexedDB như sau một lần đồng bộ. */
export function stubCatalog(): void {
  vi.spyOn(catalogRefresher, 'start').mockImplementation(() => undefined);
  vi.spyOn(catalogRefresher, 'refresh').mockResolvedValue(false);
}

export async function activateDevice(
  session: Parameters<typeof storeSession>[0] | null = { role: 'tablet', tablet_profile_id: 'tab-a' },
  catalog: Catalog = CATALOG,
): Promise<void> {
  await setMeta(localDb, META.activation, ACT);
  await setMeta(localDb, META.catalog, catalog);
  if (session) storeSession(session);
}

/** Xóa sạch dữ liệu tablet giữa các test. */
export async function clearLocalDb(): Promise<void> {
  await Promise.all([localDb.meta.clear(), localDb.outbox.clear(), localDb.orders.clear(), localDb.usedCodes.clear(), localDb.rejected.clear()]);
}
