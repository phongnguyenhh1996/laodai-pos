import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildItem } from '@/domain/pricing';
import { TRUNG, XOI_GA } from '@/domain/fixtures';
import type { TabletProfile } from '@/domain/types';
import { LaodaiDB, META, setMeta, type OutboxEntry } from './db';
import type { PushResult, SyncTransport } from './engine';
import { createOrder, openShift, payOrder } from './localOps';
import { pendingOps } from './outbox';
import { SyncRunner, browserNetwork, retryDelay, type NetworkEnv, type SyncStatus } from './runner';
import { SyncTransportError, createRpcTransport, toWire, type RpcClient } from './transport';

const PROFILE: TabletProfile = {
  id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a'], default_boxes: 200, default_plates: 50, default_float: 500_000,
};

let n = 0;
let db: LaodaiDB;
const draft = () => ({ point_id: 'xoi-a', dine_type: 'takeaway' as const, items: [buildItem(`it${++n}`, XOI_GA, [TRUNG], 1)] });

/** Chờ cho các promise / liveQuery của Dexie chạy hết. */
const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

async function until(pred: () => boolean | Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

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

/** Bộ hẹn giờ thủ công: test tự quyết định khi nào "hết giờ". */
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

/** Server giả idempotent theo op_id. */
class Server implements SyncTransport {
  reachable = true;
  seen = new Set<string>();
  calls: OutboxEntry[] = [];
  async push(op: OutboxEntry): Promise<PushResult> {
    this.calls.push(op);
    if (!this.reachable) throw new SyncTransportError('Failed to fetch');
    if (this.seen.has(op.op_id)) return { status: 'duplicate' };
    this.seen.add(op.op_id);
    return { status: 'ok' };
  }
}

beforeEach(async () => {
  db = new LaodaiDB(`runner-${++n}`);
  await setMeta(db, META.activation, { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: '' });
});

afterEach(async () => {
  await db.delete();
});

describe('createRpcTransport', () => {
  const op: OutboxEntry = {
    seq: 7, op_id: '0190a000-0000-7000-8000-000000000001', kind: 'serve_order', entity_id: 'o1',
    payload: { order_id: 'o1' }, performed_at: '2026-11-17T00:00:00.000Z', attempts: 3, last_error: 'x',
  };
  const client = (res: Awaited<ReturnType<RpcClient['rpc']>> | Error) => {
    const rpc = vi.fn(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
    return { rpc } satisfies RpcClient;
  };

  it('gọi sync_push với op đã bỏ các trường chỉ dùng ở tablet', async () => {
    const c = client({ data: { status: 'ok' }, error: null });
    expect(await createRpcTransport(c).push(op)).toEqual({ status: 'ok' });
    expect(c.rpc).toHaveBeenCalledWith('sync_push', { op: toWire(op) });
    expect(toWire(op)).toEqual({
      op_id: op.op_id, kind: 'serve_order', entity_id: 'o1', performed_at: op.performed_at, payload: { order_id: 'o1' },
    });
  });

  it('trả đúng duplicate / rejected kèm lý do', async () => {
    expect(await createRpcTransport(client({ data: { status: 'duplicate' }, error: null })).push(op)).toEqual({ status: 'duplicate' });
    expect(await createRpcTransport(client({ data: { status: 'rejected', reason: 'total_mismatch' }, error: null })).push(op)).toEqual({
      status: 'rejected', reason: 'total_mismatch',
    });
    expect(await createRpcTransport(client({ data: { status: 'rejected' }, error: null })).push(op)).toEqual({
      status: 'rejected', reason: 'unknown',
    });
  });

  it('lỗi mạng, lỗi phiên/quyền, phản hồi lạ đều là lỗi tạm thời (ném lỗi ⇒ op ở lại outbox)', async () => {
    await expect(createRpcTransport(client(new TypeError('Failed to fetch'))).push(op)).rejects.toThrow(SyncTransportError);
    const forbidden = createRpcTransport(client({ data: null, error: { message: 'forbidden', code: '42501' } }));
    await expect(forbidden.push(op)).rejects.toMatchObject({ name: 'SyncTransportError', code: '42501', message: 'forbidden' });
    const noCode = createRpcTransport(client({ data: null, error: { message: 'JWT expired' } }));
    await expect(noCode.push(op)).rejects.toMatchObject({ code: null });
    await expect(createRpcTransport(client({ data: null, error: null })).push(op)).rejects.toThrow('không hợp lệ');
    await expect(createRpcTransport(client({ data: { status: 'weird' }, error: null })).push(op)).rejects.toThrow('không hợp lệ');
  });

  it('client ném giá trị không phải Error vẫn được bọc lại', async () => {
    const c: RpcClient = {
      rpc: () => {
        throw 'socket hang up';
      },
    };
    await expect(createRpcTransport(c).push(op)).rejects.toMatchObject({ name: 'SyncTransportError', message: 'socket hang up' });
  });
});

describe('retryDelay', () => {
  it('nhân đôi sau mỗi lần lỗi, có trần', () => {
    expect([1, 2, 3, 4, 5, 10].map((f) => retryDelay(f, 2000, 30_000))).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    expect(retryDelay(0, 2000, 30_000)).toBe(2000);
  });
});

describe('browserNetwork', () => {
  it('đọc navigator.onLine và nghe sự kiện online/offline', () => {
    const target = new EventTarget();
    const win = Object.assign(target, { navigator: { onLine: false } }) as unknown as Window;
    const net = browserNetwork(win);
    expect(net.isOnline()).toBe(false);
    const seen: boolean[] = [];
    const off = net.subscribe((o) => seen.push(o));
    target.dispatchEvent(new Event('online'));
    target.dispatchEvent(new Event('offline'));
    off();
    target.dispatchEvent(new Event('online'));
    expect(seen).toEqual([true, false]);
  });
});

describe('SyncRunner', () => {
  let net: FakeNetwork;
  let timers: ManualScheduler;
  let server: Server;
  let runner: SyncRunner;
  let statuses: SyncStatus[];

  beforeEach(() => {
    net = new FakeNetwork();
    timers = new ManualScheduler();
    server = new Server();
    runner = new SyncRunner(db, server, {
      network: net, schedule: timers.schedule, now: () => new Date('2026-11-17T23:00:00Z'), retryBaseMs: 1000, retryMaxMs: 8000,
    });
    statuses = [];
    runner.subscribe((s) => statuses.push(s));
  });

  afterEach(() => runner.stop());

  it('chưa start thì không gửi gì', async () => {
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    expect(runner.isStarted).toBe(false);
    expect(await runner.kick()).toBeNull();
    await settle();
    expect(server.calls).toHaveLength(0);
  });

  it('thao tác mới được tự gửi ngay; trạng thái về "đã đồng bộ"', async () => {
    runner.start();
    runner.start(); // gọi lại không đăng ký trùng
    expect(net.listeners).toBe(1);
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    await createOrder(db, draft());
    await until(async () => (await db.outbox.count()) === 0 && runner.getStatus().pending === 0);
    expect(server.calls.map((c) => c.kind)).toEqual(['open_shift', 'create_order']);
    expect(runner.getStatus()).toMatchObject({ state: 'synced', pending: 0, lastError: null, lastSyncedAt: '2026-11-17T23:00:00.000Z' });
    expect(statuses.some((s) => s.state === 'pending')).toBe(true);
  });

  it('offline: không thử gửi, outbox giữ nguyên, báo "offline · chờ N"; có mạng lại thì gửi đúng thứ tự', async () => {
    net.online = false;
    runner.start();
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    const a = await createOrder(db, draft());
    const b = await createOrder(db, draft());
    await payOrder(db, a.id, { method: 'transfer' });
    await until(() => runner.getStatus().pending === 4);
    await settle();
    expect(server.calls).toHaveLength(0);
    expect(runner.getStatus()).toMatchObject({ state: 'offline', pending: 4 });
    expect(await db.orders.get(a.id)).toMatchObject({ status: 'paid' }); // chưa sync ⇒ vẫn giữ

    net.set(true);
    await until(() => runner.getStatus().state === 'synced');
    expect(server.calls.map((c) => [c.kind, c.entity_id])).toEqual([
      ['open_shift', expect.any(String)],
      ['create_order', a.id],
      ['create_order', b.id],
      ['pay_order', a.id],
    ]);
    expect(await db.orders.get(a.id)).toBeUndefined(); // đã thanh toán + sync xong ⇒ xóa khỏi tablet
    expect(await db.orders.get(b.id)).toBeDefined();
  });

  it('mất mạng giữa chừng (sự kiện offline) hủy lịch thử lại', async () => {
    runner.start();
    server.reachable = false;
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    await until(() => timers.active.length === 1);
    net.set(false);
    expect(timers.active).toHaveLength(0);
    expect(runner.getStatus().state).toBe('offline');
    timers.runAll(); // không còn job nào
    expect(server.calls).toHaveLength(1);
  });

  it('server không tới được: báo "đang thử lại", backoff tăng dần, thao tác mới không gửi dồn; thành công thì reset', async () => {
    server.reachable = false;
    runner.start();
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    await until(() => timers.active.length === 1);
    expect(runner.getStatus()).toMatchObject({ state: 'retrying', pending: 1, lastError: 'Failed to fetch' });
    expect(timers.active[0].ms).toBe(1000);
    expect((await pendingOps(db))[0].attempts).toBe(1);

    // Thao tác mới trong lúc chờ thử lại: không gửi ngay
    await createOrder(db, draft());
    await until(() => runner.getStatus().pending === 2);
    await settle();
    expect(server.calls).toHaveLength(1);

    timers.runAll();
    await until(() => server.calls.length === 2 && timers.active.length === 1);
    expect(timers.active[0].ms).toBe(2000);
    timers.runAll();
    await until(() => timers.active.length === 1 && timers.active[0].ms === 4000);

    server.reachable = true;
    timers.runAll();
    await until(() => runner.getStatus().state === 'synced');
    expect(runner.getStatus()).toMatchObject({ pending: 0, lastError: null });
    expect([...server.seen]).toHaveLength(2);

    // Lỗi lần sau bắt đầu lại từ base
    server.reachable = false;
    await createOrder(db, draft());
    await until(() => timers.active.length === 1);
    expect(timers.active[0].ms).toBe(1000);
  });

  it('có mạng trở lại thì gửi ngay, không chờ hết backoff', async () => {
    server.reachable = false;
    runner.start();
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    await until(() => timers.active.length === 1);
    server.reachable = true;
    net.set(true);
    await until(() => runner.getStatus().state === 'synced');
    expect(timers.active).toHaveLength(0);
  });

  it('phản hồi bị mất ⇒ gửi lại không tạo bản ghi trùng', async () => {
    let dropOnce = true;
    const lossy: SyncTransport = {
      async push(op) {
        const r = await server.push(op);
        if (dropOnce) {
          dropOnce = false;
          throw new SyncTransportError('timeout'); // server đã ghi, client không nhận được phản hồi
        }
        return r;
      },
    };
    const r = new SyncRunner(db, lossy, { network: net, schedule: timers.schedule });
    r.start();
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    await until(() => timers.active.length === 1);
    timers.runAll();
    await until(() => r.getStatus().state === 'synced');
    expect(server.calls).toHaveLength(2);
    expect(server.seen.size).toBe(1);
    r.stop();
  });

  it('thao tác thêm vào đúng lúc vòng gửi kết thúc vẫn được gửi', async () => {
    runner.start();
    let injected = false;
    const orig = server.push.bind(server);
    server.push = async (op) => {
      const res = await orig(op);
      if (!injected) {
        injected = true;
        // Một thao tác khác chen vào outbox trong lúc đang gửi
        await createOrder(db, draft());
      }
      return res;
    };
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    await until(async () => (await db.outbox.count()) === 0 && server.calls.length === 2);
    expect(server.calls.map((c) => c.kind)).toEqual(['open_shift', 'create_order']);
  });

  it('kick khi vòng gửi còn sót thao tác thì tự gửi tiếp', async () => {
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    // Engine báo còn sót (giả lập thao tác thêm vào sau khi vòng gửi đọc outbox lần cuối)
    const engine = (runner as unknown as { engine: { flush: () => Promise<unknown> } }).engine;
    const real = engine.flush.bind(engine);
    let first = true;
    engine.flush = async () => {
      if (first) {
        first = false;
        return { sent: 0, rejected: 0, remaining: 1, error: null };
      }
      return real();
    };
    runner.start();
    await until(async () => (await db.outbox.count()) === 0);
    expect(server.calls.map((c) => c.kind)).toEqual(['open_shift']);
  });

  it('stop: gỡ listener, hủy thử lại; kết quả về sau không làm đổi trạng thái', async () => {
    server.reachable = false;
    runner.start();
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    await until(() => timers.active.length === 1);
    runner.stop();
    expect(net.listeners).toBe(0);
    expect(timers.active).toHaveLength(0);
    const before = runner.getStatus();
    await createOrder(db, draft());
    await settle();
    expect(runner.getStatus()).toBe(before);
    expect(await runner.kick()).toBeNull();
  });

  it('runner dừng trong lúc đang gửi: bỏ qua kết quả', async () => {
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: SyncTransport = {
      async push(op) {
        await gate;
        return server.push(op);
      },
    };
    const r = new SyncRunner(db, slow, { network: net, schedule: timers.schedule });
    r.start();
    const p = r.kick();
    r.stop();
    release();
    const report = await p;
    expect(report).toMatchObject({ sent: 1 });
    expect(r.getStatus().lastSyncedAt).toBeNull();
  });

  it('kick khi đang gửi thì dùng chung vòng gửi, không đếm lỗi hai lần', async () => {
    server.reachable = false;
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    runner.start();
    const [a, b] = await Promise.all([runner.kick(), runner.kick()]);
    expect(a).toBe(b);
    await until(() => timers.active.length === 1);
    expect(timers.active[0].ms).toBe(1000);
  });

  it('lỗi IndexedDB khi gửi: không văng lỗi, chuyển sang thử lại', async () => {
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    const engine = (runner as unknown as { engine: { flush: () => Promise<unknown> } }).engine;
    const real = engine.flush.bind(engine);
    let calls = 0;
    engine.flush = () => (++calls === 1 ? Promise.reject(new Error('QuotaExceeded')) : real());
    runner.start();
    await until(() => timers.active.length === 1);
    expect(runner.getStatus()).toMatchObject({ state: 'retrying', lastError: 'QuotaExceeded', pending: 1 });
    engine.flush = () => (++calls === 2 ? Promise.reject('hỏng') : real());
    timers.runAll();
    await until(() => runner.getStatus().lastError === 'hỏng');
    timers.runAll();
    await until(() => runner.getStatus().state === 'synced');
  });

  it('lỗi đọc outbox (liveQuery) được báo ra trạng thái', async () => {
    const broken = new LaodaiDB(`broken-${n}`);
    vi.spyOn(broken.outbox, 'count').mockRejectedValue(new Error('IDB hỏng'));
    const r = new SyncRunner(broken, server, { network: net, schedule: timers.schedule });
    r.start();
    await until(() => r.getStatus().lastError !== null);
    expect(r.getStatus()).toMatchObject({ state: 'retrying', lastError: 'IDB hỏng' });
    r.stop();
    await broken.delete();
  });

  it('lỗi không phải Error từ liveQuery vẫn được ghi lại', async () => {
    const broken = new LaodaiDB(`broken2-${n}`);
    vi.spyOn(broken.outbox, 'count').mockRejectedValue('hỏng');
    const r = new SyncRunner(broken, server, { network: net, schedule: timers.schedule });
    r.start();
    await until(() => r.getStatus().lastError === 'hỏng');
    r.stop();
    await broken.delete();
  });

  it('mặc định: luôn coi là có mạng và hẹn giờ thử lại bằng setTimeout', async () => {
    server.reachable = false;
    const r = new SyncRunner(db, server, { retryBaseMs: 20 });
    await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE });
    r.start();
    await until(() => r.getStatus().state === 'retrying');
    server.reachable = true;
    await until(() => r.getStatus().state === 'synced');
    expect(server.seen.size).toBe(1);
    r.stop();
  });
});
