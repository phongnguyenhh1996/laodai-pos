import Dexie, { type Table } from 'dexie';
import type { Order, Shift } from '@/domain/types';

export type OpKind =
  | 'open_shift'
  | 'close_shift'
  | 'create_order'
  | 'update_order'
  | 'serve_order'
  | 'pay_order'
  | 'delete_order'
  | 'debt_payment';

export interface OutboxEntry {
  seq?: number; // khóa tự tăng ⇒ thứ tự gửi
  op_id: string; // UUID v7, khóa idempotent phía server
  kind: OpKind;
  entity_id: string; // id đơn / ca / khoản thu
  payload: Record<string, unknown>;
  performed_at: string; // thời điểm thực hiện thật (để Telegram hiện khi sync muộn)
  attempts: number;
  last_error: string | null;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface UsedCode {
  date: string;
  code: string;
}

export interface RejectedOp extends OutboxEntry {
  rejected_at: string;
  reason: string;
}

export class LaodaiDB extends Dexie {
  meta!: Table<MetaEntry, string>;
  outbox!: Table<OutboxEntry, number>;
  orders!: Table<Order, string>;
  usedCodes!: Table<UsedCode, [string, string]>;
  rejected!: Table<RejectedOp, number>;

  constructor(name = 'laodai-pos') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      outbox: '++seq, op_id, kind, entity_id',
      orders: 'id, status, opened_shift_id, created_at',
      usedCodes: '[date+code], date',
      rejected: 'seq, op_id',
    });
  }
}

export async function getMeta<T>(db: LaodaiDB, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(db: LaodaiDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export const META = {
  deviceSeq: 'deviceSeq',
  activation: 'activation',
  shift: 'shift',
  /** Danh mục tải từ server (xem catalog.ts): dùng được khi offline. */
  catalog: 'catalog',
  /** Ghi nợ / thu nợ làm trên máy mà danh mục chưa phản ánh (xem debtLocal.ts). */
  debtJournal: 'debtJournal',
} as const;

export interface Activation {
  tablet_profile_id: string;
  tablet_name: string;
  activated_at: string;
  /** Email chủ đã kích hoạt máy: chế độ chủ trên tablet chỉ cần nhập lại mật khẩu. */
  owner_email: string;
}

export type LocalShift = Pick<
  Shift,
  'id' | 'tablet_profile_id' | 'staff_id' | 'opened_at' | 'open_boxes' | 'open_plates' | 'open_float'
> & { staff_name: string };
