import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { COMBOS, PRODUCTS, TOPPINGS, XOI_MENU } from '@/domain/fixtures';
import type { TabletProfile } from '@/domain/types';
import { CatalogFetchError, createSupabaseCatalogSource, type CatalogData } from './catalog';

const PROFILE: TabletProfile = {
  id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a', 'com'], default_boxes: 200, default_plates: 60, default_cans: 0, default_float: 500_000, count_items: ['cash', 'boxes', 'plates'],
};
const data = (over: Partial<CatalogData> = {}): CatalogData => ({
  profile: PROFILE,
  menus: [{ id: XOI_MENU, name: 'Xôi' }],
  points: [
    { id: 'xoi-a', name: 'Xôi A', menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 1 },
    { id: 'com', name: 'Cơm gà', menu_id: 'menu-com', active: true, default_dine_type: 'dinein', sort: 2 },
  ],
  products: PRODUCTS,
  toppings: TOPPINGS,
  combos: COMBOS,
  staff: [{ id: 's1', name: 'Lan', active: true, sort: 1 }],
  config: { wait_yellow_min: 5, wait_red_min: 10, timezone: 'Asia/Ho_Chi_Minh' },
  customers: [],
  balances: {},
  ...over,
});

// ---------------------------------------------------------------- nguồn Supabase

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(
  tables: Record<string, Result>,
  rpc: Result,
  balances: Result = { data: [], error: null },
  soldOut: Result = { data: [], error: null },
) {
  const calls: Array<{ table: string; cols: string; eq?: [string, string] }> = [];
  const client = {
    from(table: string) {
      return {
        select(cols: string) {
          const call: { table: string; cols: string; eq?: [string, string] } = { table, cols };
          calls.push(call);
          const res = Promise.resolve(tables[table] ?? { data: [], error: null });
          return Object.assign(res, {
            eq(col: string, v: string) {
              call.eq = [col, v];
              return res;
            },
          });
        },
      };
    },
    rpc: vi.fn(async (fn: string) => (fn === 'customer_balances' ? balances : fn === 'sold_out_today' ? soldOut : rpc)),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('createSupabaseCatalogSource', () => {
  const d = data();
  const ok = (rows: unknown): Result => ({ data: rows, error: null });
  const tables = () => ({
    tablet_profiles: ok([d.profile]),
    menus: ok(d.menus),
    points: ok(d.points),
    products: ok(d.products),
    toppings: ok(d.toppings),
    combos: ok(d.combos),
    staff: ok(d.staff),
  });

  it('đọc đủ các bảng danh mục + hồ sơ của chính tablet + cấu hình', async () => {
    const { client, calls } = fakeClient(tables(), ok(d.config));
    expect(await createSupabaseCatalogSource(client)('tab-a')).toEqual({ ...d, sold_out: [] });
    expect(calls.find((c) => c.table === 'tablet_profiles')?.eq).toEqual(['id', 'tab-a']);
    expect(client.rpc).toHaveBeenCalledWith('tablet_config');
  });

  it('không đọc được hồ sơ (phiên hết hạn / anon ⇒ RLS trả 0 dòng): báo lỗi, không trả danh mục rỗng', async () => {
    const { client } = fakeClient({ ...tables(), tablet_profiles: ok([]) }, ok(d.config));
    await expect(createSupabaseCatalogSource(client)('tab-a')).rejects.toThrow('phiên của máy không hợp lệ');
    const nul = fakeClient({ ...tables(), tablet_profiles: ok(null) }, ok(d.config));
    await expect(createSupabaseCatalogSource(nul.client)('tab-a')).rejects.toBeInstanceOf(CatalogFetchError);
  });

  it('lỗi ở bất kỳ bảng / RPC nào ⇒ báo lỗi', async () => {
    const fail = { data: null, error: { message: 'boom' } };
    for (const t of ['tablet_profiles', 'products']) {
      const { client } = fakeClient({ ...tables(), [t]: fail }, ok(d.config));
      await expect(createSupabaseCatalogSource(client)('tab-a')).rejects.toThrow('boom');
    }
    await expect(createSupabaseCatalogSource(fakeClient(tables(), fail).client)('tab-a')).rejects.toThrow('boom');
    await expect(createSupabaseCatalogSource(fakeClient(tables(), ok(null)).client)('tab-a')).rejects.toThrow('cấu hình');
  });

  it('khách nợ + dư nợ theo khách gốc (gợi ý / thu nợ khi offline); lỗi dư nợ ⇒ báo lỗi', async () => {
    const customers = [{ id: 'c1', name: 'Dũng', description: 'giáo viên', phone: null, merged_into_id: null }];
    const { client, calls } = fakeClient({ ...tables(), customers: ok(customers) }, ok(d.config), ok([{ customer_id: 'c1', balance: 45_000 }]));
    const got = await createSupabaseCatalogSource(client)('tab-a');
    expect(got.customers).toEqual(customers);
    expect(got.balances).toEqual({ c1: 45_000 });
    expect(calls.find((c) => c.table === 'customers')?.cols).toBe('id,name,description,phone,address,merged_into_id');
    const nul = fakeClient(tables(), ok(d.config), ok(null));
    expect((await createSupabaseCatalogSource(nul.client)('tab-a')).balances).toEqual({});
    const bad = fakeClient(tables(), ok(d.config), { data: null, error: { message: 'boom' } });
    await expect(createSupabaseCatalogSource(bad.client)('tab-a')).rejects.toThrow('dư nợ');
  });

  it('món hết hôm nay (sold_out_today); lỗi ⇒ báo lỗi', async () => {
    const rows = [{ point_id: 'xoi-a', item_kind: 'product', item_id: 'xoi-ga', day: '2026-11-20', at: '2026-11-20T01:00:00Z' }];
    const { client } = fakeClient(tables(), ok(d.config), ok([]), ok(rows));
    expect((await createSupabaseCatalogSource(client)('tab-a')).sold_out).toEqual(rows);
    const bad = fakeClient(tables(), ok(d.config), ok([]), { data: null, error: { message: 'boom' } });
    await expect(createSupabaseCatalogSource(bad.client)('tab-a')).rejects.toThrow('món hết');
  });

  it('bảng trả null ⇒ danh sách rỗng', async () => {
    const { client } = fakeClient({ ...tables(), combos: ok(null) }, ok(d.config));
    expect((await createSupabaseCatalogSource(client)('tab-a')).combos).toEqual([]);
  });
});
