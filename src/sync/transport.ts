import type { OutboxEntry } from './db';
import type { PushResult, SyncTransport } from './engine';

/** Phần của supabase-js mà transport cần (dễ thay bằng client giả khi test). */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** Lỗi tạm thời (mất mạng, hết phiên, lỗi server): op được giữ lại trong outbox để thử lại. */
export class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

/** Dạng gửi lên `sync_push`: bỏ các trường chỉ dùng ở tablet (seq, attempts, last_error). */
export function toWire(op: OutboxEntry) {
  return {
    op_id: op.op_id,
    kind: op.kind,
    entity_id: op.entity_id,
    performed_at: op.performed_at,
    payload: op.payload,
  };
}

function parseResult(data: unknown): PushResult {
  const d = data as { status?: unknown; reason?: unknown } | null;
  if (d?.status === 'ok' || d?.status === 'duplicate') return { status: d.status };
  if (d?.status === 'rejected') return { status: 'rejected', reason: typeof d.reason === 'string' ? d.reason : 'unknown' };
  throw new SyncTransportError(`Phản hồi sync_push không hợp lệ: ${JSON.stringify(data)}`);
}

/**
 * Transport gọi RPC idempotent `sync_push`. Server trả `ok` / `duplicate` (đã nhận op_id này) /
 * `rejected` (vi phạm nghiệp vụ, đã ghi nhật ký + báo chủ). Mọi lỗi khác đều là tạm thời ⇒ ném lỗi.
 */
export function createRpcTransport(client: RpcClient): SyncTransport {
  return {
    async push(op) {
      let res: Awaited<ReturnType<RpcClient['rpc']>>;
      try {
        res = await client.rpc('sync_push', { op: toWire(op) });
      } catch (e) {
        throw new SyncTransportError(e instanceof Error ? e.message : String(e));
      }
      if (res.error) throw new SyncTransportError(res.error.message, res.error.code ?? null);
      return parseResult(res.data);
    },
  };
}
