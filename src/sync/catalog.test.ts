// @vitest-environment jsdom
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBOS, PRODUCTS, TOPPINGS, XOI_MENU } from '@/domain/fixtures';
import type { TabletProfile } from '@/domain/types';
import {
  CatalogFetchError, CatalogRefresher, browserVisibility, createSupabaseCatalogSource, loadCatalog, refreshCatalog,
  type CatalogData, type CatalogSource, type VisibilityEnv,
} from './catalog';
import { LaodaiDB, META, setMeta, type Activation } from './db';
import type { NetworkEnv } from './runner';

const ACT: Activation = { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: 'o@x.vn' };
const PROFILE: TabletProfile = {
  id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a', 'com'], default_boxes: 200, default_plates: 60, default_float: 500_000,
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
const NOW = () => new Date('2026-11-17T00:00:00.000Z');

let db: LaodaiDB;
let n = 0;

beforeEach(async () => {
  db = new LaodaiDB(`catalog-test-${++n}`);
  await setMeta(db, META.activation, ACT);
});

afterEach(async () => {
  await db.delete();
});

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('refreshCatalog', () => {
  it('lưu nguyên khối danh mục kèm thời điểm tải, đọc lại được khi offline', async () => {
    const source = vi.fn<CatalogSource>().mockResolvedValue(data());
    const c = await refreshCatalog(db, source, NOW);
    expect(source).toHaveBeenCalledWith('tab-a');
    expect(c.fetched_at).toBe('2026-11-17T00:00:00.000Z');
    expect(await loadCatalog(db)).toEqual(c);
  });

  it('chủ bỏ một điểm bán khỏi hồ sơ ⇒ lần làm mới sau thay danh mục cũ', async () => {
    await refreshCatalog(db, async () => data(), NOW);
    await refreshCatalog(db, async () => data({ profile: { ...PROFILE, point_ids: ['xoi-a'] } }), NOW);
    expect((await loadCatalog(db))?.profile.point_ids).toEqual(['xoi-a']);
  });

  it('tải lỗi ⇒ giữ nguyên danh mục cũ', async () => {
    const old = await refreshCatalog(db, async () => data(), NOW);
    await expect(refreshCatalog(db, () => Promise.reject(new Error('offline')), NOW)).rejects.toThrow('offline');
    expect(await loadCatalog(db)).toEqual(old);
  });

  it('chưa kích hoạt hoặc hồ sơ trả về không khớp ⇒ không lưu', async () => {
    await expect(
      refreshCatalog(db, async () => data({ profile: { ...PROFILE, id: 'tab-b' } }), NOW),
    ).rejects.toBeInstanceOf(CatalogFetchError);
    await db.meta.delete(META.activation);
    await expect(refreshCatalog(db, async () => data(), NOW)).rejects.toThrow('chưa được kích hoạt');
    expect(await loadCatalog(db)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- nguồn Supabase

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Result>, rpc: Result, balances: Result = { data: [], error: null }) {
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
    rpc: vi.fn(async (fn: string) => (fn === 'customer_balances' ? balances : rpc)),
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
    expect(await createSupabaseCatalogSource(client)('tab-a')).toEqual(d);
    expect(calls.find((c) => c.table === 'tablet_profiles')?.eq).toEqual(['id', 'tab-a']);
    expect(client.rpc).toHaveBeenCalledWith('tablet_config');
  });

  it('không đọc được hồ sơ (phiên hết hạn / anon ⇒ RLS trả 0 dòng): báo lỗi, không trả danh mục rỗng', async () => {
    const { client } = fakeClient({ ...tables(), tablet_profiles: ok([]) }, ok(d.config));
    await expect(createSupabaseCatalogSource(client)('tab-a')).rejects.toThrow('phiên tablet không hợp lệ');
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
    expect(calls.find((c) => c.table === 'customers')?.cols).toBe('id,name,description,phone,merged_into_id');
    const nul = fakeClient(tables(), ok(d.config), ok(null));
    expect((await createSupabaseCatalogSource(nul.client)('tab-a')).balances).toEqual({});
    const bad = fakeClient(tables(), ok(d.config), { data: null, error: { message: 'boom' } });
    await expect(createSupabaseCatalogSource(bad.client)('tab-a')).rejects.toThrow('dư nợ');
  });

  it('bảng trả null ⇒ danh sách rỗng', async () => {
    const { client } = fakeClient({ ...tables(), combos: ok(null) }, ok(d.config));
    expect((await createSupabaseCatalogSource(client)('tab-a')).combos).toEqual([]);
  });
});

// ---------------------------------------------------------------- tự làm mới

class FakeNetwork implements NetworkEnv {
  online = true;
  private fns = new Set<(o: boolean) => void>();
  isOnline = () => this.online;
  subscribe(fn: (o: boolean) => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  set(online: boolean) {
    this.online = online;
    this.fns.forEach((fn) => fn(online));
  }
  get listeners() {
    return this.fns.size;
  }
}

class FakeVisibility implements VisibilityEnv {
  private fns = new Set<() => void>();
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  show() {
    this.fns.forEach((fn) => fn());
  }
  get listeners() {
    return this.fns.size;
  }
}

class ManualScheduler {
  jobs: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  schedule = (fn: () => void, ms: number) => {
    const job = { fn, ms, cancelled: false };
    this.jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  };
  get active() {
    return this.jobs.filter((j) => !j.cancelled);
  }
  runAll() {
    const jobs = this.active;
    jobs.forEach((j) => (j.cancelled = true));
    jobs.forEach((j) => j.fn());
  }
}

describe('CatalogRefresher', () => {
  function setup(source: CatalogSource = vi.fn<CatalogSource>().mockResolvedValue(data())) {
    const network = new FakeNetwork();
    const visibility = new FakeVisibility();
    const sched = new ManualScheduler();
    const r = new CatalogRefresher(db, source, {
      network, visibility, schedule: sched.schedule, now: NOW, intervalMs: 300_000, retryMs: 30_000,
    });
    return { r, network, visibility, sched, source: source as ReturnType<typeof vi.fn<CatalogSource>> };
  }

  it('chưa start: không tải', async () => {
    const { r, source } = setup();
    expect(await r.refresh()).toBe(false);
    expect(source).not.toHaveBeenCalled();
    expect(r.isStarted).toBe(false);
  });

  it('start ⇒ tải ngay, rồi hẹn làm mới định kỳ', async () => {
    const { r, sched, source } = setup();
    const seen: boolean[] = [];
    r.subscribe((s) => seen.push(s.loading));
    r.start();
    r.start(); // gọi lại không tải thêm
    await settle();
    expect(source).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([true, false]);
    expect(r.getStatus()).toEqual({ loading: false, lastError: null, lastFetchedAt: '2026-11-17T00:00:00.000Z' });
    expect(await loadCatalog(db)).toBeDefined();
    expect(sched.active.map((j) => j.ms)).toEqual([300_000]);

    sched.runAll();
    await settle();
    expect(source).toHaveBeenCalledTimes(2);
    expect(sched.active).toHaveLength(1);
    r.stop();
  });

  it('có mạng lại / app quay lại màn hình ⇒ làm mới', async () => {
    const { r, network, visibility, source } = setup();
    r.start();
    await settle();
    network.set(false);
    await settle();
    expect(source).toHaveBeenCalledTimes(1);
    network.set(true);
    await settle();
    expect(source).toHaveBeenCalledTimes(2);
    visibility.show();
    await settle();
    expect(source).toHaveBeenCalledTimes(3);
    r.stop();
  });

  it('offline ⇒ không gọi server, hẹn thử lại', async () => {
    const { r, network, sched, source } = setup();
    network.online = false;
    r.start();
    await settle();
    expect(source).not.toHaveBeenCalled();
    expect(sched.active.map((j) => j.ms)).toEqual([30_000]);
    r.stop();
  });

  it('lỗi ⇒ giữ danh mục cũ, ghi lỗi, thử lại sớm; lần sau thành công thì xóa lỗi', async () => {
    const source = vi.fn<CatalogSource>().mockRejectedValueOnce(new Error('mất kết nối')).mockRejectedValueOnce('lạ').mockResolvedValue(data());
    const { r, sched } = setup(source);
    r.start();
    await settle();
    expect(r.getStatus().lastError).toBe('mất kết nối');
    expect(sched.active.map((j) => j.ms)).toEqual([30_000]);
    sched.runAll();
    await settle();
    expect(r.getStatus().lastError).toBe('lạ');
    sched.runAll();
    await settle();
    expect(r.getStatus().lastError).toBeNull();
    expect(sched.active.map((j) => j.ms)).toEqual([300_000]);
    r.stop();
  });

  it('gọi chồng nhau ⇒ dùng chung một lần tải', async () => {
    let resolve!: (d: CatalogData) => void;
    const source = vi.fn<CatalogSource>(() => new Promise((res) => (resolve = res)));
    const { r } = setup(source);
    r.start();
    const again = r.refresh();
    await settle();
    expect(source).toHaveBeenCalledTimes(1);
    resolve(data());
    expect(await again).toBe(true);
    r.stop();
  });

  it('stop ⇒ gỡ sự kiện, hủy hẹn giờ; kết quả về muộn không hẹn thêm', async () => {
    let resolve!: (d: CatalogData) => void;
    const source = vi.fn<CatalogSource>(() => new Promise((res) => (resolve = res)));
    const { r, network, visibility, sched } = setup(source);
    r.start();
    await settle(); // đang chờ server
    expect(network.listeners).toBe(1);
    expect(visibility.listeners).toBe(1);
    r.stop();
    expect(network.listeners).toBe(0);
    expect(visibility.listeners).toBe(0);
    resolve(data());
    await settle();
    expect(sched.active).toHaveLength(0);
  });
});

describe('browserVisibility', () => {
  it('chỉ báo khi trang hiện lại', () => {
    const fn = vi.fn();
    let state: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    const off = browserVisibility(document).subscribe(fn);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fn).not.toHaveBeenCalled();
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
