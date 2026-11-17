import { liveQuery } from 'dexie';
import type { LaodaiDB } from './db';
import { SyncEngine, type FlushReport, type SyncTransport } from './engine';

/**
 * Trạng thái hiển thị cho nhân viên (mục 7: "đã sync / đang chờ N thao tác / offline"):
 * - `offline`: thiết bị báo mất mạng ⇒ không thử gửi, chờ sự kiện `online`.
 * - `retrying`: có mạng nhưng lần gửi gần nhất lỗi (server không tới được, hết phiên…) ⇒ đang chờ thử lại.
 * - `pending`: còn thao tác chờ gửi, đang gửi.
 * - `synced`: outbox trống.
 */
export type SyncState = 'offline' | 'retrying' | 'pending' | 'synced';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastError: string | null;
  lastSyncedAt: string | null;
}

/** Nguồn trạng thái mạng (trình duyệt: `navigator.onLine` + sự kiện online/offline). */
export interface NetworkEnv {
  isOnline(): boolean;
  subscribe(onChange: (online: boolean) => void): () => void;
}

export type Scheduler = (fn: () => void, ms: number) => () => void;

export interface SyncRunnerOptions {
  network?: NetworkEnv;
  schedule?: Scheduler;
  now?: () => Date;
  /** Thử lại sau lỗi: base, 2×base, 4×base… tối đa maxMs. */
  retryBaseMs?: number;
  retryMaxMs?: number;
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

const alwaysOnline: NetworkEnv = { isOnline: () => true, subscribe: () => () => undefined };

const timeoutScheduler: Scheduler = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export function retryDelay(failures: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, failures - 1), maxMs);
}

/**
 * Tự động đẩy outbox lên server:
 * - ngay khi có thao tác mới (theo dõi outbox bằng liveQuery),
 * - khi có mạng trở lại,
 * - thử lại với backoff khi lỗi tạm thời.
 * Thứ tự và idempotent do `flushOutbox` + `sync_push` đảm bảo.
 */
export class SyncRunner {
  private engine: SyncEngine;
  private network: NetworkEnv;
  private schedule: Scheduler;
  private now: () => Date;
  private retryBaseMs: number;
  private retryMaxMs: number;

  private started = false;
  private cleanups: Array<() => void> = [];
  private cancelRetry: (() => void) | null = null;
  private failures = 0;
  private flushing = false;
  private online: boolean;
  private status: SyncStatus = { state: 'synced', pending: 0, lastError: null, lastSyncedAt: null };
  private listeners = new Set<(s: SyncStatus) => void>();

  constructor(
    private db: LaodaiDB,
    transport: SyncTransport,
    opts: SyncRunnerOptions = {},
  ) {
    this.engine = new SyncEngine(db, transport);
    this.network = opts.network ?? alwaysOnline;
    this.schedule = opts.schedule ?? timeoutScheduler;
    this.now = opts.now ?? (() => new Date());
    this.retryBaseMs = opts.retryBaseMs ?? 2_000;
    this.retryMaxMs = opts.retryMaxMs ?? 60_000;
    this.online = this.network.isOnline();
  }

  get isStarted(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.online = this.network.isOnline();
    this.cleanups.push(
      this.network.subscribe((online) => {
        this.online = online;
        if (online) {
          this.failures = 0;
          this.clearRetry();
          void this.kick();
        } else {
          this.clearRetry();
          this.emit();
        }
      }),
    );
    const sub = liveQuery(() => this.db.outbox.count()).subscribe({
      next: (count) => {
        if (count !== this.status.pending) {
          this.status = { ...this.status, pending: count };
          this.emit();
        }
        // Đang gửi thì vòng gửi hiện tại tự nhặt thao tác mới; đang chờ thử lại (backoff) thì không gửi dồn.
        if (count > 0 && !this.flushing && !this.cancelRetry) void this.kick();
      },
      error: (e) => {
        this.status = { ...this.status, lastError: e instanceof Error ? e.message : String(e) };
        this.emit();
      },
    });
    this.cleanups.push(() => sub.unsubscribe());
    this.emit();
  }

  stop(): void {
    this.started = false;
    this.clearRetry();
    this.cleanups.splice(0).forEach((fn) => fn());
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Gửi ngay (nếu đang chạy và có mạng). Trả null khi không gửi. */
  async kick(): Promise<FlushReport | null> {
    if (!this.started || !this.online) {
      this.emit();
      return null;
    }
    // Đã có vòng gửi đang chạy: dùng chung kết quả, để vòng đó tự xử lý (không đếm lỗi hai lần).
    if (this.flushing) return this.engine.flush();
    this.flushing = true;
    let report: FlushReport;
    try {
      report = await this.engine.flush();
    } catch (e) {
      // Lỗi IndexedDB (không phải lỗi mạng): coi như lỗi tạm thời, thử lại sau.
      report = { sent: 0, rejected: 0, remaining: this.status.pending, error: e instanceof Error ? e.message : String(e) };
    } finally {
      this.flushing = false;
    }
    if (!this.started) return report;

    if (report.error) {
      this.failures++;
      this.status = { ...this.status, pending: report.remaining, lastError: report.error };
      this.scheduleRetry();
    } else {
      this.failures = 0;
      this.status = { ...this.status, pending: report.remaining, lastError: null, lastSyncedAt: this.now().toISOString() };
      // Thao tác được thêm đúng lúc vòng gửi vừa kết thúc ⇒ gửi tiếp.
      if (report.remaining > 0) queueMicrotask(() => void this.kick());
    }
    this.emit();
    return report;
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (!this.online) return;
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null;
      void this.kick();
    }, retryDelay(this.failures, this.retryBaseMs, this.retryMaxMs));
  }

  private clearRetry(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  private emit(): void {
    const { pending, lastError } = this.status;
    const state: SyncState = !this.online ? 'offline' : lastError ? 'retrying' : pending > 0 ? 'pending' : 'synced';
    if (state !== this.status.state) this.status = { ...this.status, state };
    const snapshot = this.status;
    this.listeners.forEach((fn) => fn(snapshot));
  }
}
