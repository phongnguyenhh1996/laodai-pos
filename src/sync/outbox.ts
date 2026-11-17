import { v7 as uuidv7 } from 'uuid';
import type { LaodaiDB, OpKind, OutboxEntry } from './db';

/** Ghi một thao tác vào outbox. Gọi trong cùng transaction với thay đổi dữ liệu local. */
export async function enqueue(
  db: LaodaiDB,
  kind: OpKind,
  entity_id: string,
  payload: Record<string, unknown>,
  performed_at: string,
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    op_id: uuidv7(),
    kind,
    entity_id,
    payload,
    performed_at,
    attempts: 0,
    last_error: null,
  };
  entry.seq = await db.outbox.add(entry);
  return entry;
}

export async function pendingOps(db: LaodaiDB): Promise<OutboxEntry[]> {
  return db.outbox.orderBy('seq').toArray();
}

export async function pendingCount(db: LaodaiDB): Promise<number> {
  return db.outbox.count();
}
