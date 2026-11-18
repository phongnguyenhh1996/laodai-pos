import type { Order } from '@/domain/types';
import { PosNetworkError, type ChannelStatus, type PosBackend, type PulseScope } from './backend';
import type { Catalog } from './catalog';
import type { OpenState, TabletShift } from './types';

/**
 * Kết nối hiển thị cho nhân viên:
 * - `live`: đang nghe thay đổi từ server, lần gọi gần nhất thành công.
 * - `connecting`: đang mở (hoặc mở lại) kênh Realtime; thao tác vẫn gửi được.
 * - `offline`: máy báo mất mạng, hoặc lần gọi server gần nhất lỗi ⇒ thao tác sẽ không lưu được.
 */
export type ConnState = 'live' | 'connecting' | 'offline';

export interface TabletSnapshot {
  /** `undefined` khi chưa tải được lần nào. */
  catalog: Catalog | undefined;
  open: OpenState | undefined;
  conn: ConnState;
  /** Lỗi của lần tải / gửi gần nhất (null khi đã ổn). */
  error: string | null;
}

/** Nguồn trạng thái mạng (trình duyệt: `navigator.onLine` + sự kiện online/offline). */
export interface NetworkEnv {
  isOnline(): boolean;
  subscribe(onChange: (online: boolean) => void): () => void;
}

export interface VisibilityEnv {
  /** Gọi `onVisible` khi app quay lại màn hình (bật màn hình, chuyển lại tab). */
  subscribe(onVisible: () => void): () => void;
}

export type Scheduler = (fn: () => void, ms: number) => () => void;

export interface TabletStoreOptions {
  network?: NetworkEnv;
  visibility?: VisibilityEnv;
  schedule?: Scheduler;
  now?: () => Date;
  /** Tải lại ca + đơn định kỳ, phòng khi kênh Realtime rớt mà không báo (mặc định 30 giây). */
  pollMs?: number;
  /** Tải lại danh mục định kỳ (mặc định 5 phút). */
  catalogPollMs?: number;
  /** Gom các thông báo thay đổi liên tiếp thành một lần tải (mặc định 150 ms). */
  debounceMs?: number;
}

export function browserNetwork(win: Window = window): NetworkEnv {
  return {
    isOnline: () => win.navigator.onLine,
    subscribe(onChange) {
      const on = () => onChange(true);
      const off = () => onChange(false);
      win.addEventListener('online', on);
      win.addEventListener('offline', off);
      return () => {
        win.removeEventListener('online', on);
        win.removeEventListener('offline', off);
      };
    },
  };
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

const alwaysOnline: NetworkEnv = { isOnline: () => true, subscribe: () => () => undefined };
const noVisibility: VisibilityEnv = { subscribe: () => () => undefined };
const timeoutScheduler: Scheduler = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Một lần tải chạy tại một thời điểm; yêu cầu tới trong lúc đang tải ⇒ tải thêm đúng một lần nữa sau đó. */
class Coalesced {
  private running: Promise<void> | null = null;
  private again = false;
  constructor(private fn: () => Promise<void>) {}
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.fn();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}

/**
 * Trạng thái màn bán hàng, lấy thẳng từ server: danh mục, ca đang mở, đơn đang mở của hồ sơ tablet.
 * Không lưu gì xuống máy. Mọi máy dùng chung hồ sơ thấy cùng một ca + cùng hàng đợi:
 * server báo thay đổi qua Realtime (`live_pulse`) ⇒ tải lại; kèm tải lại khi có mạng lại, khi quay lại màn hình và định kỳ.
 */
export class TabletStore {
  private network: NetworkEnv;
  private visibility: VisibilityEnv;
  private schedule: Scheduler;
  private now: () => Date;
  private pollMs: number;
  private catalogPollMs: number;
  private debounceMs: number;

  private profileId: string | null = null;
  private cleanups: Array<() => void> = [];
  private timers = new Map<string, () => void>();
  private channel: ChannelStatus = 'connecting';
  private online = true;
  /** Tăng mỗi lần ghi kết quả thao tác vào bộ nhớ: lần tải bắt đầu trước đó (dữ liệu cũ) phải tải lại. */
  private localRev = 0;
  private snap: TabletSnapshot = { catalog: undefined, open: undefined, conn: 'connecting', error: null };
  private listeners = new Set<() => void>();
  private openLoader = new Coalesced(() => this.loadOpen());
  private catalogLoader = new Coalesced(() => this.loadCatalog());

  constructor(
    private backend: PosBackend,
    opts: TabletStoreOptions = {},
  ) {
    this.network = opts.network ?? alwaysOnline;
    this.visibility = opts.visibility ?? noVisibility;
    this.schedule = opts.schedule ?? timeoutScheduler;
    this.now = opts.now ?? (() => new Date());
    this.pollMs = opts.pollMs ?? 30_000;
    this.catalogPollMs = opts.catalogPollMs ?? 5 * 60_000;
    this.debounceMs = opts.debounceMs ?? 150;
  }

  get started(): boolean {
    return this.profileId !== null;
  }

  get api(): PosBackend {
    return this.backend;
  }

  /** Bắt đầu cho một hồ sơ tablet (gọi lại với cùng hồ sơ thì không làm gì). */
  start(profileId: string): void {
    if (this.profileId === profileId) return;
    this.stop();
    this.profileId = profileId;
    this.online = this.network.isOnline();
    this.channel = 'connecting';
    this.cleanups.push(
      this.backend.subscribe(
        profileId,
        (scope) => this.onPulse(scope),
        (s) => {
          const wasLive = this.channel === 'live';
          this.channel = s;
          this.emit({});
          // Vừa nối (lại) kênh: có thể đã lỡ thay đổi trong lúc mất kết nối.
          if (s === 'live' && !wasLive) void this.refresh();
        },
      ),
      this.network.subscribe((online) => {
        this.online = online;
        this.emit({});
        if (online) void this.refresh();
      }),
      this.visibility.subscribe(() => void this.refresh()),
    );
    void this.refresh();
  }

  stop(): void {
    this.profileId = null;
    this.cleanups.splice(0).forEach((fn) => fn());
    this.timers.forEach((cancel) => cancel());
    this.timers.clear();
  }

  /** Về trạng thái ban đầu (dùng khi đổi máy / trong test). */
  reset(backend?: PosBackend): void {
    this.stop();
    if (backend) this.backend = backend;
    this.localRev = 0;
    this.channel = 'connecting';
    this.snap = { catalog: undefined, open: undefined, conn: 'connecting', error: null };
    this.listeners.forEach((fn) => fn());
  }

  getSnapshot = (): TabletSnapshot => this.snap;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Tải lại cả ca + đơn lẫn danh mục. */
  async refresh(): Promise<void> {
    await Promise.all([this.refreshOpen(), this.refreshCatalog()]);
  }

  refreshOpen(): Promise<void> {
    if (!this.profileId) return Promise.resolve();
    return this.openLoader.run();
  }

  refreshCatalog(): Promise<void> {
    if (!this.profileId) return Promise.resolve();
    return this.catalogLoader.run();
  }

  // ---------------------------------------------------------------- kết quả thao tác (cập nhật ngay, không chờ tải lại)

  setShift(shift: TabletShift | null): void {
    this.patchOpen((o) => ({ shift, orders: o.orders }));
  }

  /** Đơn còn mở ⇒ thêm / thay; đơn đã thanh toán / đã xóa ⇒ bỏ khỏi hàng đợi. */
  applyOrder(order: Order): void {
    if (order.status !== 'open' && order.status !== 'served') return this.removeOrder(order.id);
    this.patchOpen((o) => ({ shift: o.shift, orders: [...o.orders.filter((x) => x.id !== order.id), order] }));
  }

  removeOrder(id: string): void {
    this.patchOpen((o) => ({ shift: o.shift, orders: o.orders.filter((x) => x.id !== id) }));
  }

  /** Gọi server thành công / thất bại vì mạng (thao tác của màn bán hàng báo về để chỉ báo kết nối đúng). */
  reportOk(): void {
    if (this.snap.error) this.emit({ error: null });
  }

  reportError(e: unknown): void {
    this.emit({ error: errText(e) });
  }

  // ---------------------------------------------------------------- nội bộ

  private patchOpen(fn: (o: OpenState) => OpenState): void {
    this.localRev++;
    this.emit({ open: fn(this.snap.open ?? { shift: null, orders: [] }) });
  }

  private onPulse(scope: PulseScope): void {
    const key = `pulse-${scope}`;
    this.timers.get(key)?.();
    this.timers.set(
      key,
      this.schedule(() => {
        this.timers.delete(key);
        void (scope === 'open' ? this.refreshOpen() : this.refreshCatalog());
      }, this.debounceMs),
    );
  }

  private async loadOpen(): Promise<void> {
    const profileId = this.profileId;
    if (!profileId) return;
    for (;;) {
      const rev = this.localRev;
      try {
        const open = await this.backend.loadOpenState(profileId);
        if (this.profileId !== profileId) return;
        if (rev !== this.localRev) continue; // có thao tác ghi xen vào giữa lúc tải ⇒ dữ liệu vừa tải có thể đã cũ
        this.emit({ open, error: null });
      } catch (e) {
        if (this.profileId === profileId) this.emit({ error: errText(e) });
      }
      break;
    }
    this.plan('poll-open', this.pollMs, () => void this.refreshOpen());
  }

  private async loadCatalog(): Promise<void> {
    const profileId = this.profileId;
    if (!profileId) return;
    const fetched_at = this.now().toISOString();
    try {
      const data = await this.backend.loadCatalog(profileId);
      if (this.profileId !== profileId) return;
      if (data.profile.id !== profileId) throw new PosNetworkError('Hồ sơ tablet không khớp');
      this.emit({ catalog: { ...data, fetched_at }, error: null });
    } catch (e) {
      if (this.profileId === profileId) this.emit({ error: errText(e) });
    }
    this.plan('poll-catalog', this.catalogPollMs, () => void this.refreshCatalog());
  }

  private plan(key: string, ms: number, fn: () => void): void {
    this.timers.get(key)?.();
    if (!this.profileId) return;
    this.timers.set(
      key,
      this.schedule(() => {
        this.timers.delete(key);
        fn();
      }, ms),
    );
  }

  private emit(patch: Partial<TabletSnapshot>): void {
    const next = { ...this.snap, ...patch };
    next.conn = !this.online || next.error ? 'offline' : this.channel === 'live' ? 'live' : 'connecting';
    this.snap = next;
    this.listeners.forEach((fn) => fn());
  }
}
