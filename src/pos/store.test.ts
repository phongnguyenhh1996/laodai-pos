// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '@/domain/types';
import { CATALOG } from '@/test-utils/tablet';
import type { ChannelStatus, PosBackend, PulseScope } from './backend';
import { TabletStore, browserNetwork, browserVisibility, type NetworkEnv, type VisibilityEnv } from './store';
import type { OpenState, TabletShift } from './types';

const SHIFT: TabletShift = {
  id: 'sh1', tablet_profile_id: 'tab-a', staff_id: 's1', staff_name: 'Lan', opened_at: '', open_boxes: 1, open_plates: 1, open_float: 0,
};
const order = (id: string, status: Order['status'] = 'open'): Order =>
  ({ id, status, tablet_profile_id: 'tab-a', items: [], total: 0 }) as unknown as Order;

/** Backend điều khiển được: mỗi lần tải trả một promise do test quyết định. */
class ManualBackend implements PosBackend {
  openCalls: Array<{ resolve: (v: OpenState) => void; reject: (e: unknown) => void }> = [];
  catalogCalls: Array<{ resolve: (v: typeof CATALOG) => void; reject: (e: unknown) => void }> = [];
  onPulse: ((s: PulseScope) => void) | null = null;
  onStatus: ((s: ChannelStatus) => void) | null = null;
  unsubscribed = 0;
  push = vi.fn();
  loadOpenState = () => new Promise<OpenState>((resolve, reject) => this.openCalls.push({ resolve, reject }));
  loadCatalog = () => new Promise<typeof CATALOG>((resolve, reject) => this.catalogCalls.push({ resolve, reject }));
  subscribe(_p: string, onPulse: (s: PulseScope) => void, onStatus: (s: ChannelStatus) => void) {
    this.onPulse = onPulse;
    this.onStatus = onStatus;
    return () => {
      this.unsubscribed++;
    };
  }
  async answer(open: OpenState = { shift: SHIFT, orders: [] }, catalog = CATALOG) {
    this.openCalls.splice(0).forEach((c) => c.resolve(open));
    this.catalogCalls.splice(0).forEach((c) => c.resolve(catalog));
    await settle();
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
  active(ms?: number) {
    return this.jobs.filter((j) => !j.cancelled && (ms === undefined || j.ms === ms));
  }
  run(ms?: number) {
    const jobs = this.active(ms);
    jobs.forEach((j) => (j.cancelled = true));
    jobs.forEach((j) => j.fn());
  }
}

class FakeNetwork implements NetworkEnv {
  online = true;
  fns = new Set<(o: boolean) => void>();
  isOnline = () => this.online;
  subscribe(fn: (o: boolean) => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  set(online: boolean) {
    this.online = online;
    this.fns.forEach((fn) => fn(online));
  }
}

class FakeVisibility implements VisibilityEnv {
  fns = new Set<() => void>();
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  show() {
    this.fns.forEach((fn) => fn());
  }
}

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup() {
  const backend = new ManualBackend();
  const sched = new ManualScheduler();
  const network = new FakeNetwork();
  const visibility = new FakeVisibility();
  const store = new TabletStore(backend, { schedule: sched.schedule, network, visibility, now: () => new Date('2026-11-18T00:00:00Z') });
  return { backend, sched, network, visibility, store };
}

describe('TabletStore', () => {
  it('start ⇒ tải danh mục + ca/đơn; kênh realtime nối ⇒ "live"', async () => {
    const { backend, store } = setup();
    expect(store.started).toBe(false);
    store.start('tab-a');
    store.start('tab-a'); // gọi lại cùng hồ sơ: không làm gì
    expect(store.getSnapshot()).toMatchObject({ catalog: undefined, open: undefined, conn: 'connecting' });
    expect(backend.openCalls).toHaveLength(1);
    await backend.answer({ shift: SHIFT, orders: [order('o1')] });
    expect(store.getSnapshot().open).toEqual({ shift: SHIFT, orders: [order('o1')] });
    expect(store.getSnapshot().catalog).toMatchObject({ profile: CATALOG.profile, fetched_at: '2026-11-18T00:00:00.000Z' });
    backend.onStatus!('live');
    expect(store.getSnapshot().conn).toBe('live');
    // Vừa nối kênh ⇒ tải lại (có thể đã lỡ thay đổi)
    expect(backend.openCalls).toHaveLength(1);
  });

  it('server báo thay đổi ⇒ gom lại rồi tải đúng phần đổi', async () => {
    const { backend, sched, store } = setup();
    store.start('tab-a');
    await backend.answer();
    backend.onPulse!('open');
    backend.onPulse!('open');
    expect(sched.active(150)).toHaveLength(1);
    sched.run(150);
    expect(backend.openCalls).toHaveLength(1);
    expect(backend.catalogCalls).toHaveLength(0);
    await backend.answer({ shift: null, orders: [] });
    expect(store.getSnapshot().open?.shift).toBeNull();
    backend.onPulse!('catalog');
    sched.run(150);
    expect(backend.catalogCalls).toHaveLength(1);
    expect(backend.openCalls).toHaveLength(0);
  });

  it('kênh rớt ⇒ "connecting"; nối lại ⇒ tải lại cả hai', async () => {
    const { backend, store } = setup();
    store.start('tab-a');
    await backend.answer();
    backend.onStatus!('live');
    await backend.answer();
    backend.onStatus!('down');
    expect(store.getSnapshot().conn).toBe('connecting');
    backend.onStatus!('live');
    expect(backend.openCalls).toHaveLength(1);
    expect(backend.catalogCalls).toHaveLength(1);
  });

  it('mất mạng ⇒ "offline"; có mạng lại / quay lại màn hình ⇒ tải lại', async () => {
    const { backend, network, visibility, store } = setup();
    store.start('tab-a');
    await backend.answer();
    backend.onStatus!('live');
    await backend.answer();
    network.set(false);
    expect(store.getSnapshot().conn).toBe('offline');
    network.set(true);
    expect(backend.openCalls).toHaveLength(1);
    await backend.answer();
    expect(store.getSnapshot().conn).toBe('live');
    visibility.show();
    expect(backend.openCalls).toHaveLength(1);
  });

  it('tải lỗi ⇒ giữ dữ liệu cũ, ghi lỗi, "offline"; lần sau được thì xóa lỗi', async () => {
    const { backend, store } = setup();
    store.start('tab-a');
    await backend.answer();
    backend.onStatus!('live');
    backend.openCalls.splice(0).forEach((c) => c.reject(new Error('Failed to fetch')));
    backend.catalogCalls.splice(0).forEach((c) => c.reject('boom'));
    await settle();
    expect(store.getSnapshot()).toMatchObject({ conn: 'offline', error: 'boom' });
    expect(store.getSnapshot().open?.shift).toEqual(SHIFT);
    void store.refresh();
    await backend.answer();
    expect(store.getSnapshot()).toMatchObject({ conn: 'live', error: null });
  });

  it('danh mục trả về của hồ sơ khác ⇒ lỗi, không dùng', async () => {
    const { backend, store } = setup();
    store.start('tab-a');
    await backend.answer(undefined, { ...CATALOG, profile: { ...CATALOG.profile, id: 'tab-b' } });
    expect(store.getSnapshot().catalog).toBeUndefined();
    expect(store.getSnapshot().error).toBe('Hồ sơ tablet không khớp');
  });

  it('kết quả thao tác vào ngay; đơn đã thanh toán / đã xóa rời hàng đợi', async () => {
    const { backend, store } = setup();
    const seen = vi.fn();
    store.subscribe(seen);
    store.applyOrder(order('o1')); // chưa tải gì: vẫn ghi được
    store.start('tab-a');
    await backend.answer({ shift: null, orders: [order('o1')] });
    store.setShift(SHIFT);
    store.applyOrder(order('o2'));
    store.applyOrder({ ...order('o1'), status: 'served' });
    expect(store.getSnapshot().open).toEqual({ shift: SHIFT, orders: [order('o2'), order('o1', 'served')] });
    store.applyOrder(order('o2', 'paid'));
    store.removeOrder('o1');
    expect(store.getSnapshot().open?.orders).toEqual([]);
    expect(seen).toHaveBeenCalled();
    store.reportError(new Error('x'));
    expect(store.getSnapshot().conn).toBe('offline');
    store.reportOk();
    store.reportOk();
    expect(store.getSnapshot().error).toBeNull();
  });

  it('thao tác ghi xen vào lúc đang tải ⇒ bỏ kết quả tải cũ, tải lại', async () => {
    const { backend, store } = setup();
    store.start('tab-a');
    await backend.answer({ shift: SHIFT, orders: [] });
    void store.refreshOpen();
    const stale = backend.openCalls.shift()!;
    store.applyOrder(order('o1'));
    stale.resolve({ shift: SHIFT, orders: [] }); // tải bắt đầu trước khi có o1
    await settle();
    expect(store.getSnapshot().open?.orders.map((o) => o.id)).toEqual(['o1']);
    expect(backend.openCalls).toHaveLength(1); // đã tải lại
    await backend.answer({ shift: SHIFT, orders: [order('o1')] });
    expect(store.getSnapshot().open?.orders.map((o) => o.id)).toEqual(['o1']);
  });

  it('gọi tải chồng nhau ⇒ một lần đang chạy + đúng một lần nữa sau đó', async () => {
    const { backend, store } = setup();
    store.start('tab-a');
    void store.refreshOpen();
    void store.refreshOpen();
    expect(backend.openCalls).toHaveLength(1);
    await backend.answer();
    expect(backend.openCalls).toHaveLength(1);
    await backend.answer();
    expect(backend.openCalls).toHaveLength(0);
  });

  it('tải lại định kỳ (phòng khi realtime rớt mà không báo)', async () => {
    const { backend, sched, store } = setup();
    store.start('tab-a');
    await backend.answer();
    expect(sched.active(30_000)).toHaveLength(1);
    expect(sched.active(5 * 60_000)).toHaveLength(1);
    sched.run(30_000);
    expect(backend.openCalls).toHaveLength(1);
    sched.run(5 * 60_000);
    expect(backend.catalogCalls).toHaveLength(1);
  });

  it('stop ⇒ hủy đăng ký, hủy hẹn giờ; kết quả về muộn bị bỏ; chưa start thì refresh không làm gì', async () => {
    const { backend, sched, network, visibility, store } = setup();
    await store.refresh();
    expect(backend.openCalls).toHaveLength(0);
    store.start('tab-a');
    backend.onPulse!('open');
    store.stop();
    expect(backend.unsubscribed).toBe(1);
    expect(network.fns.size).toBe(0);
    expect(visibility.fns.size).toBe(0);
    expect(sched.active()).toHaveLength(0);
    await backend.answer({ shift: SHIFT, orders: [order('late')] });
    expect(store.getSnapshot().open).toBeUndefined();
    backend.openCalls.length = 0;
    // Lỗi về muộn cũng bị bỏ
    store.start('tab-a');
    const p = backend.openCalls.shift()!;
    store.stop();
    p.reject(new Error('late'));
    await settle();
    expect(store.getSnapshot().error).toBeNull();
  });

  it('đổi hồ sơ / reset ⇒ dừng hồ sơ cũ, về trạng thái ban đầu, đổi được backend', async () => {
    const { backend, store } = setup();
    store.start('tab-a');
    await backend.answer();
    store.start('tab-b');
    expect(backend.unsubscribed).toBe(1);
    const other = new ManualBackend();
    store.reset(other);
    expect(store.getSnapshot()).toEqual({ catalog: undefined, open: undefined, conn: 'connecting', error: null });
    expect(store.api).toBe(other);
    store.reset();
    expect(store.api).toBe(other);
  });
});

describe('môi trường trình duyệt', () => {
  it('browserNetwork theo navigator.onLine + sự kiện online/offline', () => {
    const env = browserNetwork(window);
    const fn = vi.fn();
    const off = env.subscribe(fn);
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(fn.mock.calls).toEqual([[false], [true]]);
    off();
    window.dispatchEvent(new Event('online'));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(env.isOnline()).toBe(navigator.onLine);
  });

  it('browserVisibility chỉ báo khi trang hiện lại', () => {
    const env = browserVisibility(document);
    const fn = vi.fn();
    const off = env.subscribe(fn);
    const set = (v: string) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
    set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('mặc định: luôn online, không theo dõi màn hình, hẹn giờ bằng setTimeout', async () => {
    const backend = new ManualBackend();
    const store = new TabletStore(backend, { debounceMs: 0 });
    store.start('tab-a');
    await backend.answer();
    backend.onPulse!('open');
    await settle();
    expect(backend.openCalls).toHaveLength(1);
    store.stop();
  });
});
