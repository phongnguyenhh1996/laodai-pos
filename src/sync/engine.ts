import type { LaodaiDB, OutboxEntry } from './db';

export type PushResult =
  | { status: 'ok' }
  | { status: 'duplicate' } // server đã xử lý op_id này rồi (retry)
  | { status: 'rejected'; reason: string }; // vi phạm nghiệp vụ: không thử lại, server đã ghi nhật ký

/** Gửi một thao tác lên server. Ném lỗi khi mất mạng / lỗi tạm thời ⇒ giữ nguyên outbox. */
export interface SyncTransport {
  push(op: OutboxEntry): Promise<PushResult>;
}

export interface FlushReport {
  sent: number;
  rejected: number;
  remaining: number;
  error: string | null;
}

/** Thao tác kết thúc vòng đời đơn trên tablet ⇒ xóa đơn khỏi IndexedDB sau khi sync. */
const TERMINAL = new Set(['pay_order', 'delete_order']);

/**
 * Gửi outbox theo đúng thứ tự. Dừng ở lỗi đầu tiên để không gửi lệch thứ tự.
 * Đơn đã thanh toán / đã xóa chỉ bị xóa khỏi tablet khi server xác nhận.
 */
export async function flushOutbox(db: LaodaiDB, transport: SyncTransport, now = () => new Date()): Promise<FlushReport> {
  let sent = 0;
  let rejected = 0;
  let error: string | null = null;

  for (;;) {
    const op = await db.outbox.orderBy('seq').first();
    if (!op) break;
    let res: PushResult;
    try {
      res = await transport.push(op);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await db.outbox.update(op.seq!, { attempts: op.attempts + 1, last_error: error });
      break;
    }

    await db.transaction('rw', db.outbox, db.orders, db.rejected, async () => {
      await db.outbox.delete(op.seq!);
      if (res.status === 'rejected') {
        rejected++;
        await db.rejected.put({ ...op, rejected_at: now().toISOString(), reason: res.reason });
      } else {
        sent++;
      }
      if (TERMINAL.has(op.kind)) {
        const stillPending = await db.outbox.where('entity_id').equals(op.entity_id).count();
        if (stillPending === 0) await db.orders.delete(op.entity_id);
      }
    });
  }

  return { sent, rejected, remaining: await db.outbox.count(), error };
}

/** Một luồng sync duy nhất tại một thời điểm. */
export class SyncEngine {
  private running: Promise<FlushReport> | null = null;
  private listeners = new Set<(r: FlushReport) => void>();

  constructor(
    private db: LaodaiDB,
    private transport: SyncTransport,
  ) {}

  onFlush(fn: (r: FlushReport) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  flush(): Promise<FlushReport> {
    if (!this.running) {
      this.running = flushOutbox(this.db, this.transport)
        .then((r) => {
          this.listeners.forEach((fn) => fn(r));
          return r;
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }
}
