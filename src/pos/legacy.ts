import { PosNetworkError, type PosBackend } from './backend';
import type { Activation, WireOp } from './types';

/**
 * Chuyển tiếp từ bản offline (IndexedDB "laodai-pos" của Dexie): máy đang chạy bản cũ có thể còn
 * hồ sơ kích hoạt và thao tác chưa kịp gửi. Đọc một lần, gửi nốt theo đúng thứ tự (vẫn idempotent theo op_id)
 * rồi xóa hẳn cơ sở dữ liệu cũ. Bỏ được file này khi mọi tablet đã chạy bản realtime.
 */

export const LEGACY_DB = 'laodai-pos';

interface LegacyOutboxEntry {
  seq: number;
  op_id: string;
  kind: WireOp['kind'];
  entity_id: string;
  payload: Record<string, unknown>;
  performed_at: string;
}

export interface LegacyData {
  activation: Activation | null;
  outbox: LegacyOutboxEntry[];
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Mở cơ sở dữ liệu cũ nếu có (không tạo mới khi máy chưa từng chạy bản offline). */
function openExisting(idb: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let fresh = false;
    const r = idb.open(LEGACY_DB);
    r.onupgradeneeded = () => {
      fresh = true;
      r.transaction?.abort();
    };
    r.onsuccess = () => {
      if (fresh) {
        r.result.close();
        resolve(null);
      } else resolve(r.result);
    };
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}

export async function readLegacy(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<LegacyData | null> {
  if (!idb) return null;
  const db = await openExisting(idb);
  if (!db) return null;
  try {
    const stores = Array.from(db.objectStoreNames);
    let activation: Activation | null = null;
    let outbox: LegacyOutboxEntry[] = [];
    if (stores.includes('meta')) {
      const row = await req(db.transaction('meta').objectStore('meta').get('activation'));
      activation = (row as { value?: Activation } | undefined)?.value ?? null;
    }
    if (stores.includes('outbox')) {
      outbox = ((await req(db.transaction('outbox').objectStore('outbox').getAll())) as LegacyOutboxEntry[]).sort((a, b) => a.seq - b.seq);
    }
    return { activation, outbox };
  } finally {
    db.close();
  }
}

export async function deleteLegacy(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  if (!idb) return;
  await new Promise<void>((resolve) => {
    const r = idb.deleteDatabase(LEGACY_DB);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

export interface DrainReport {
  sent: number;
  rejected: number;
  /** Còn thao tác chưa gửi được (mất mạng): giữ nguyên cơ sở dữ liệu cũ, lần sau gửi tiếp. */
  remaining: number;
}

/** Gửi nốt các thao tác còn kẹt trong outbox cũ. Gửi hết ⇒ xóa cơ sở dữ liệu cũ. */
export async function drainLegacyOutbox(backend: PosBackend, idb: IDBFactory | undefined = globalThis.indexedDB): Promise<DrainReport> {
  const data = await readLegacy(idb);
  if (!data) return { sent: 0, rejected: 0, remaining: 0 };
  let sent = 0;
  let rejected = 0;
  for (const [i, e] of data.outbox.entries()) {
    try {
      // Payload theo hình dạng của bản offline cũ (có thể thiếu / thừa trường so với `OpPayloads`): server tự kiểm.
      const op = { op_id: e.op_id, kind: e.kind, entity_id: e.entity_id, payload: e.payload, performed_at: e.performed_at } as WireOp;
      const res = await backend.push(op);
      if (res.status === 'rejected') rejected++;
      else sent++;
    } catch (err) {
      if (!(err instanceof PosNetworkError)) throw err;
      // Chưa gửi được: lần sau gửi lại từ đầu (các op đã gửi sẽ được server trả "duplicate").
      return { sent, rejected, remaining: data.outbox.length - i };
    }
  }
  await deleteLegacy(idb);
  return { sent, rejected, remaining: 0 };
}
