import type { SupabaseClient } from '@supabase/supabase-js';
import type { Combo, Customer, Menu, Money, Point, Product, Staff, TabletProfile, Topping } from '@/domain/types';
import { META, getMeta, type Activation, type LaodaiDB } from './db';
import { loadDebtJournal, pruneDebtJournal } from './debtLocal';
import type { NetworkEnv, Scheduler } from './runner';

/**
 * Danh mục của tablet: menu, món, topping, combo, điểm bán, nhân viên, hồ sơ tablet và ngưỡng màu chờ.
 * Tải bằng phiên vai trò `tablet` (RLS chỉ cho đọc đúng những thứ này), lưu nguyên khối vào IndexedDB
 * để bán được khi offline. Chủ đổi cài đặt ⇒ tablet thấy sau lần làm mới kế tiếp ("sau khi đồng bộ").
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

export async function loadCatalog(db: LaodaiDB): Promise<Catalog | undefined> {
  return getMeta<Catalog>(db, META.catalog);
}

/** Tải danh mục mới và thay khối cũ (một lần ghi: không bao giờ có danh mục nửa cũ nửa mới). */
export async function refreshCatalog(
  db: LaodaiDB,
  source: CatalogSource,
  now: () => Date = () => new Date(),
): Promise<Catalog> {
  const act = await getMeta<Activation>(db, META.activation);
  if (!act) throw new CatalogFetchError('Tablet chưa được kích hoạt');
  const fetched_at = now().toISOString();
  const data = await source(act.tablet_profile_id);
  if (data.profile.id !== act.tablet_profile_id) throw new CatalogFetchError('Hồ sơ tablet không khớp');
  const catalog: Catalog = { ...data, fetched_at };
  await db.transaction('rw', db.meta, async () => {
    await db.meta.put({ key: META.catalog, value: catalog });
    // Khoản nợ đã đồng bộ trước lúc bắt đầu tải đã nằm trong dư nợ mới ⇒ bỏ khỏi nhật ký tại máy.
    await db.meta.put({ key: META.debtJournal, value: pruneDebtJournal(await loadDebtJournal(db), fetched_at) });
  });
  return catalog;
}

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

// ---------------------------------------------------------------- tự làm mới

export interface VisibilityEnv {
  /** Gọi `onVisible` khi app quay lại màn hình (bật màn hình, chuyển lại tab). */
  subscribe(onVisible: () => void): () => void;
}

export function browserVisibility(doc: Document = document): VisibilityEnv {
  return {
    subscribe(onVisible) {
      const h = () => {
        if (doc.visibilityState === 'visible') onVisible();
      };
      doc.addEventListener('visibilitychange', h);
      return () => doc.removeEventListener('visibilitychange', h);
    },
  };
}

export interface CatalogStatus {
  /** Đang tải lần đầu / đang làm mới. */
  loading: boolean;
  lastError: string | null;
  lastFetchedAt: string | null;
}

export interface CatalogRefresherOptions {
  network?: NetworkEnv;
  visibility?: VisibilityEnv;
  schedule?: Scheduler;
  now?: () => Date;
  /** Làm mới định kỳ (mặc định 5 phút). */
  intervalMs?: number;
  /** Lỗi ⇒ thử lại sớm hơn (mặc định 30 giây). */
  retryMs?: number;
}

const alwaysOnline: NetworkEnv = { isOnline: () => true, subscribe: () => () => undefined };
const noVisibility: VisibilityEnv = { subscribe: () => () => undefined };
const timeoutScheduler: Scheduler = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Làm mới danh mục: khi bắt đầu, khi có mạng lại, khi app quay lại màn hình, và định kỳ. */
export class CatalogRefresher {
  private network: NetworkEnv;
  private visibility: VisibilityEnv;
  private schedule: Scheduler;
  private now: () => Date;
  private intervalMs: number;
  private retryMs: number;

  private started = false;
  private cleanups: Array<() => void> = [];
  private cancelNext: (() => void) | null = null;
  private inflight: Promise<boolean> | null = null;
  private status: CatalogStatus = { loading: false, lastError: null, lastFetchedAt: null };
  private listeners = new Set<(s: CatalogStatus) => void>();

  constructor(
    private db: LaodaiDB,
    private source: CatalogSource,
    opts: CatalogRefresherOptions = {},
  ) {
    this.network = opts.network ?? alwaysOnline;
    this.visibility = opts.visibility ?? noVisibility;
    this.schedule = opts.schedule ?? timeoutScheduler;
    this.now = opts.now ?? (() => new Date());
    this.intervalMs = opts.intervalMs ?? 5 * 60_000;
    this.retryMs = opts.retryMs ?? 30_000;
  }

  get isStarted(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.cleanups.push(
      this.network.subscribe((online) => {
        if (online) void this.refresh();
      }),
      this.visibility.subscribe(() => void this.refresh()),
    );
    void this.refresh();
  }

  stop(): void {
    this.started = false;
    this.clearNext();
    this.cleanups.splice(0).forEach((fn) => fn());
  }

  getStatus(): CatalogStatus {
    return this.status;
  }

  subscribe(fn: (s: CatalogStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Làm mới ngay. Trả `true` khi đã tải được danh mục mới. Gọi chồng nhau thì dùng chung một lần tải. */
  refresh(): Promise<boolean> {
    if (!this.started) return Promise.resolve(false);
    if (this.inflight) return this.inflight;
    if (!this.network.isOnline()) {
      this.planNext(this.retryMs);
      return Promise.resolve(false);
    }
    this.set({ loading: true });
    this.inflight = refreshCatalog(this.db, this.source, this.now)
      .then((c) => {
        this.set({ loading: false, lastError: null, lastFetchedAt: c.fetched_at });
        this.planNext(this.intervalMs);
        return true;
      })
      .catch((e: unknown) => {
        this.set({ loading: false, lastError: e instanceof Error ? e.message : String(e) });
        this.planNext(this.retryMs);
        return false;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private planNext(ms: number): void {
    this.clearNext();
    if (!this.started) return;
    this.cancelNext = this.schedule(() => {
      this.cancelNext = null;
      void this.refresh();
    }, ms);
  }

  private clearNext(): void {
    this.cancelNext?.();
    this.cancelNext = null;
  }

  private set(patch: Partial<CatalogStatus>): void {
    this.status = { ...this.status, ...patch };
    const s = this.status;
    this.listeners.forEach((fn) => fn(s));
  }
}
