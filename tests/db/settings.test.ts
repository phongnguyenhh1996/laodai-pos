// Bước 4 — cài đặt của chủ: ghi qua đúng module giao diện dùng (src/owner/settings/api.ts) với RLS thật,
// và tablet nhận thay đổi qua danh mục (src/pos, báo realtime qua live_pulse). Dữ liệu phía server cho E2E G32, G37.
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menuBoard, tabletPoints } from '@/domain/catalog';
import { buildItem, setItemQty } from '@/domain/pricing';
import { loadOwnerCatalog, loadPriceHistory, saveSetting } from '@/owner/settings/api';
import { createSupabaseCatalogSource, type Catalog } from '@/pos';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { SEED } from '../support/seed-ids';
import { liveTablet, type LiveTablet } from '../support/tablet';

let owner: SupabaseClient;
let tab: SupabaseClient;
let t: LiveTablet;

beforeEach(async () => {
  await resetDb();
  [owner, tab] = await Promise.all([ownerClient(), tabletClient(SEED.tablets.A)]);
  t = await liveTablet(tab, SEED.tablets.A);
});

afterEach(() => {
  t.stop();
});

const syncCatalog = async () => {
  await t.store.refreshCatalog();
  return t.store.getSnapshot().catalog!;
};
const product = (c: Catalog, id: string) => c.products.find((p) => p.id === id)!;

describe('chủ sửa cài đặt', () => {
  it('thêm menu, điểm bán, món, topping, combo, nhân viên, hồ sơ tablet; mỗi lần ghi có nhật ký', async () => {
    const menu = await saveSetting(owner, 'menus', null, { name: 'Bánh mì' });
    const point = await saveSetting(owner, 'points', null, { name: 'Bánh mì C', menu_id: menu, default_dine_type: 'takeaway', sort: 4, active: true });
    const p = await saveSetting(owner, 'products', null, {
      menu_id: menu, name: 'Bánh mì thịt', price: 20000, sort: 1, active: true, boxes_takeaway: 0, boxes_dinein: 0, plates_dinein: 0,
    });
    const t = await saveSetting(owner, 'toppings', null, { menu_id: menu, name: 'Pate', price: 3000, extra_box_takeaway: false, sort: 1, active: true });
    const combo = await saveSetting(owner, 'combos', null, { menu_id: menu, name: 'Bánh mì pate', product_id: p, topping_ids: [t], sort: 1, active: true });
    const staff = await saveSetting(owner, 'staff', null, { name: 'Tuấn', sort: 4, active: true });
    const profile = await saveSetting(owner, 'tablet_profiles', null, {
      name: 'Tablet C', point_ids: [point], default_boxes: 50, default_plates: 0, default_float: 200000,
    });

    const cat = await loadOwnerCatalog(owner);
    expect(cat.menus.map((m) => m.name)).toContain('Bánh mì');
    expect(cat.combos.find((c) => c.id === combo)).toMatchObject({ product_id: p, topping_ids: [t] });
    expect(cat.staff.find((s) => s.id === staff)).toMatchObject({ name: 'Tuấn', active: true });
    expect(cat.profiles.find((x) => x.id === profile)).toMatchObject({ point_ids: [point], default_float: 200000 });

    const log = await sql<{ entity: string; n: string }>(
      `select entity, count(*) n from audit_log where action = 'settings_create' and actor_kind = 'owner' group by entity order by entity`,
    );
    expect(log.map((r) => [r.entity, Number(r.n)])).toEqual([
      ['combos', 1], ['menus', 1], ['points', 1], ['products', 1], ['staff', 1], ['tablet_profiles', 1], ['toppings', 1],
    ]);

    // Ngừng bán = active=false (không có xóa); nhật ký có trước/sau
    await saveSetting(owner, 'staff', staff, { name: 'Tuấn', sort: 4, active: false });
    const [upd] = await sql(`select before, after from audit_log where action = 'settings_update' and entity_id = $1`, [staff]);
    expect(upd.before).toMatchObject({ active: true });
    expect(upd.after).toMatchObject({ active: false });
  });

  it('dữ liệu sai bị DB chặn kể cả khi gọi API trực tiếp', async () => {
    const reject = (p: Promise<unknown>, msg: RegExp) => expect(p).rejects.toThrow(msg);
    // Combo lệch menu
    await reject(
      saveSetting(owner, 'combos', null, { menu_id: SEED.menus.xoi, name: 'Lai', product_id: SEED.products.comGa, topping_ids: [], sort: 9, active: true }),
      /menu của combo/,
    );
    await reject(
      saveSetting(owner, 'combos', SEED.combos.xoiGaTrung, { topping_ids: [SEED.toppings.trung, SEED.toppings.canh] }),
      /menu của combo/,
    );
    await reject(saveSetting(owner, 'combos', SEED.combos.xoiGaTrung, { topping_ids: [SEED.toppings.trung, SEED.toppings.trung] }), /trùng/);
    // Hồ sơ tablet trỏ điểm bán không có
    await reject(
      saveSetting(owner, 'tablet_profiles', SEED.tablets.A, { point_ids: [SEED.points.xoiA, '00000000-0000-4000-8000-000000000000'] }),
      /không tồn tại/,
    );
    await reject(saveSetting(owner, 'tablet_profiles', SEED.tablets.A, { point_ids: [SEED.points.xoiA, SEED.points.xoiA] }), /trùng/);
    // Không đổi menu của món đã tạo
    await reject(saveSetting(owner, 'products', SEED.products.xoiGa, { menu_id: SEED.menus.com }), /Không đổi menu/);
    // Tên trùng / rỗng
    await reject(saveSetting(owner, 'points', SEED.points.xoiB, { name: 'Xôi A' }), /Tên này đã có/);
    await reject(saveSetting(owner, 'menus', SEED.menus.xoi, { name: '   ' }), /check constraint|violates/);
  });

  it('tablet không ghi được cài đặt (RLS): báo lỗi, dữ liệu không đổi', async () => {
    await expect(saveSetting(tab, 'products', SEED.products.xoiGa, { price: 1 })).rejects.toThrow(/Không lưu được|quyền/);
    await expect(saveSetting(tab, 'staff', null, { name: 'Lạ', sort: 9, active: true })).rejects.toThrow(/quyền|row-level/);
    const [p] = await sql('select price from products where id = $1', [SEED.products.xoiGa]);
    expect(p.price).toBe(25000);
  });
});

describe('tablet nhận cài đặt qua danh mục', () => {
  it('danh mục tải bằng phiên tablet: đủ menu / nhân viên / cấu hình, chỉ hồ sơ của chính mình', async () => {
    const c = await syncCatalog();
    expect(c.profile).toMatchObject({ id: SEED.tablets.A, point_ids: [SEED.points.xoiA, SEED.points.com], default_boxes: 200 });
    expect(c.staff.map((s) => s.name).sort()).toEqual(['Hùng', 'Lan', 'Mai']);
    expect(c.config).toEqual({ wait_yellow_min: 5, wait_red_min: 10, timezone: 'Asia/Ho_Chi_Minh' });
    expect(product(c, SEED.products.xoiGa).price).toBe(25000);
    expect(menuBoard(SEED.menus.xoi, c.products, c.toppings, c.combos).combos.find((x) => x.combo.id === SEED.combos.xoiGaTrung)?.price).toBe(31000);
    // Hồ sơ của tablet khác: không đọc được ⇒ không có danh mục
    await expect(createSupabaseCatalogSource(tab)(SEED.tablets.B)).rejects.toThrow('phiên tablet không hợp lệ');
  });

  it('G37 (dữ liệu): bỏ Cơm gà khỏi tablet A ⇒ tablet A nhận ngay qua realtime, tab Cơm gà biến mất', async () => {
    const rt = await liveTablet(tab, SEED.tablets.A, { realtime: true });
    let c = rt.store.getSnapshot().catalog!;
    expect(tabletPoints(c.profile, c.points).map((p) => p.name)).toEqual(['Xôi A', 'Cơm gà']);
    await vi.waitFor(() => expect(rt.store.getSnapshot().conn).toBe('live'), { timeout: 10_000 });

    await saveSetting(owner, 'tablet_profiles', SEED.tablets.A, { point_ids: [SEED.points.xoiA] });
    // Không cần tải lại tay: server báo qua live_pulse
    await vi.waitFor(() => expect(rt.store.getSnapshot().catalog!.profile.point_ids).toEqual([SEED.points.xoiA]), { timeout: 10_000 });
    c = rt.store.getSnapshot().catalog!;
    expect(tabletPoints(c.profile, c.points).map((p) => p.name)).toEqual(['Xôi A']);
    rt.stop();
    // Tablet B không bị ảnh hưởng
    const tabB = await tabletClient(SEED.tablets.B);
    expect((await createSupabaseCatalogSource(tabB)(SEED.tablets.B)).profile.point_ids).toEqual([SEED.points.xoiB]);
  });

  it('G32 (dữ liệu): đổi giá ⇒ đơn đang mở trên tablet giữ giá cũ, đơn mới dùng giá mới, có lịch sử giá', async () => {
    let c = await syncCatalog();
    await t.pos.openShift({ staff_id: SEED.staff.Lan });
    const open = await t.pos.createOrder({
      point_id: SEED.points.xoiA, dine_type: 'takeaway', items: [buildItem('a0000000-0000-7000-8000-000000000001', product(c, SEED.products.xoiGa), [])],
    });

    // Chủ đổi giá Xôi gà 25.000 → 28.000
    await saveSetting(owner, 'products', SEED.products.xoiGa, { price: 28000 });
    expect(await loadPriceHistory(owner, 'product', SEED.products.xoiGa)).toEqual([
      expect.objectContaining({ old_price: 25000, new_price: 28000 }),
    ]);

    c = await syncCatalog();
    expect(product(c, SEED.products.xoiGa).price).toBe(28000);

    // Đơn đang mở giữ giá cũ, kể cả khi sửa số lượng sau khi đổi giá
    await t.store.refreshOpen();
    const live = t.store.getSnapshot().open!.orders.find((o) => o.id === open.id)!;
    expect(live.items[0].unit_price_snap).toBe(25000);
    await t.pos.updateOrder(open.id, { items: [setItemQty(live.items[0], 2)] });
    // Đơn mới dựng từ danh mục mới ⇒ giá mới
    const fresh = await t.pos.createOrder({
      point_id: SEED.points.xoiA, dine_type: 'takeaway', items: [buildItem('a0000000-0000-7000-8000-000000000002', product(c, SEED.products.xoiGa), [])],
    });
    expect(fresh.total).toBe(28000);

    const rows = await sql<{ id: string; total: number; unit_price_snap: number; qty: number }>(
      `select o.id, o.total, i.unit_price_snap, i.qty from orders o join order_items i on i.order_id = o.id and i.removed_at is null`,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: open.id, total: 50000, unit_price_snap: 25000, qty: 2 },
        { id: fresh.id, total: 28000, unit_price_snap: 28000, qty: 1 },
      ]),
    );
  });
});
