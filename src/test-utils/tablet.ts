// Tablet giả cho test component: hồ sơ kích hoạt trên máy + server giả trong bộ nhớ (FakeServer).
import { COMBOS, COM_MENU, PRODUCTS, TOPPINGS, XOI_MENU } from '@/domain/fixtures';
import { pos, tabletStore } from '@/lib/pos';
import { writeActivation, type Activation, type Catalog, type CatalogData } from '@/pos';
import { storeSession } from './auth';
import { FakeServer } from './fakeServer';

export const ACT: Activation = { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: 'owner@x.vn' };

export const CATALOG: Catalog = {
  fetched_at: '2026-11-17T00:00:00.000Z',
  profile: { id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a', 'com'], default_boxes: 200, default_plates: 60, default_cans: 0, default_float: 500_000, count_items: ['cash', 'boxes', 'plates'] },
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
  customers: [
    { id: 'c-gv', name: 'Dũng', description: 'giáo viên', phone: null, address: null, merged_into_id: null },
    { id: 'c-pb', name: 'Dũng', description: 'phường B', phone: '0909000111', address: null, merged_into_id: null },
    { id: 'c-hoa', name: 'Cô Hoa', description: '20 Lê Lợi', phone: null, address: '20 Lê Lợi, P.3', merged_into_id: null },
  ],
  balances: { 'c-gv': 0, 'c-pb': 120_000, 'c-hoa': 30_000 },
};

/** Server giả dùng cho test hiện tại (đặt lại ở mỗi `useFakeServer`). */
export let server: FakeServer;

/** Tablet của app dùng server giả (gọi trong beforeEach). Không gửi lại khi lỗi mạng để test chạy nhanh. */
export function useFakeServer(catalog: CatalogData = CATALOG): FakeServer {
  server = new FakeServer(catalog);
  tabletStore.reset(server.device());
  pos.reset();
  pos.retryDelaysMs = [];
  return server;
}

/** Máy đã kích hoạt cho hồ sơ Tablet A (hồ sơ kích hoạt + phiên vai trò tablet). */
export function activateDevice(
  session: Parameters<typeof storeSession>[0] | null = { role: 'tablet', tablet_profile_id: 'tab-a' },
): void {
  writeActivation(ACT);
  if (session) storeSession(session);
}

/** Dọn giữa các test. */
export function resetTablet(): void {
  tabletStore.reset();
  pos.reset();
}
