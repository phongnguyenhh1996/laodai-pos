// Lớp offline của tablet (src/sync: Dexie + outbox + transport RPC) chạy thật với Supabase local:
// idempotent khi gửi lại, phát hiện lỗ hổng device_seq, đơn đã thanh toán bị xóa khỏi tablet sau khi sync.
import 'fake-indexeddb/auto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LaodaiDB, META, SyncRunner, SyncTransportError, createOrder, createRpcTransport, flushOutbox, openShift,
  payOrder, serveOrder, setMeta, type SyncTransport,
} from '@/sync';
import type { TabletProfile } from '@/domain/types';
import { resetDb, sql, tabletClient } from '../support/db';
import { item } from '../support/ops';
import { SEED } from '../support/seed-ids';

const PROFILE_A: TabletProfile = {
  id: SEED.tablets.A, name: 'Tablet A', point_ids: [SEED.points.xoiA, SEED.points.com],
  default_boxes: 0, default_plates: 0, default_float: 0, // server tự lấy mặc định của hồ sơ
};

let n = 0;
let db: LaodaiDB;
let tab: SupabaseClient;
let transport: SyncTransport;

const draft = (qty = 1) => ({ point_id: SEED.points.xoiA, dine_type: 'takeaway' as const, items: [item('xoiGa', ['trung'], qty)] });

/** Mất mạng: request không tới server. */
const offline: SyncTransport = { push: () => Promise.reject(new SyncTransportError('Failed to fetch')) };

beforeEach(async () => {
  await resetDb();
  tab = await tabletClient(SEED.tablets.A);
  transport = createRpcTransport(tab);
  db = new LaodaiDB(`db-sync-${++n}`);
  await setMeta(db, META.activation, { tablet_profile_id: SEED.tablets.A, tablet_name: 'Tablet A', activated_at: '', owner_email: '' });
  await openShift(db, { staff_id: SEED.staff.Lan, staff_name: 'Lan', profile: PROFILE_A });
});

afterEach(async () => {
  await db.delete();
});

describe('tablet ↔ sync_push', () => {
  it('offline: outbox giữ nguyên; online: gửi đúng thứ tự, server có đủ dữ liệu, đơn đã thanh toán bị xóa khỏi tablet', async () => {
    const a = await createOrder(db, draft());
    const b = await createOrder(db, draft(2));
    await serveOrder(db, a.id);
    await payOrder(db, a.id, { method: 'cash', cash_given: 50_000 });

    expect(await flushOutbox(db, offline)).toMatchObject({ sent: 0, remaining: 5, error: 'Failed to fetch' });
    expect(await sql('select id from orders')).toHaveLength(0);

    expect(await flushOutbox(db, transport)).toMatchObject({ sent: 5, rejected: 0, remaining: 0, error: null });
    const rows = await sql('select id, device_seq, status, total from orders order by device_seq');
    expect(rows).toEqual([
      { id: a.id, device_seq: 1, status: 'paid', total: a.total },
      { id: b.id, device_seq: 2, status: 'open', total: b.total },
    ]);
    expect(await sql('select 1 from seq_gaps')).toHaveLength(0);
    // Tablet không giữ dữ liệu doanh thu
    expect(await db.orders.get(a.id)).toBeUndefined();
    expect(await db.orders.get(b.id)).toMatchObject({ status: 'open' });
  });

  it('phản hồi bị mất rồi gửi lại: server trả duplicate, chỉ có một bản ghi', async () => {
    const a = await createOrder(db, draft());
    let lost = 0;
    const lossy: SyncTransport = {
      async push(op) {
        const r = await transport.push(op);
        if (op.kind === 'create_order' && lost++ === 0) throw new SyncTransportError('timeout');
        return r;
      },
    };
    expect(await flushOutbox(db, lossy)).toMatchObject({ sent: 1, remaining: 1, error: 'timeout' });
    const seen: string[] = [];
    const spy: SyncTransport = {
      async push(op) {
        const r = await transport.push(op);
        seen.push(r.status);
        return r;
      },
    };
    expect(await flushOutbox(db, spy)).toMatchObject({ sent: 1, remaining: 0 });
    expect(seen).toEqual(['duplicate']);
    expect(await sql('select id from orders where id = $1', [a.id])).toHaveLength(1);
    expect(await sql('select id from order_items where order_id = $1', [a.id])).toHaveLength(1);
    expect(await sql(`select 1 from audit_log where entity_id = $1 and action = 'order_create'`, [a.id])).toHaveLength(1);
  });

  it('xóa dữ liệu tablet trước khi sync (mất đơn số 2): server phát hiện thiếu device_seq và báo chủ', async () => {
    await createOrder(db, draft());
    const lost = await createOrder(db, draft());
    await createOrder(db, draft());
    await db.outbox.where('entity_id').equals(lost.id).delete();
    await db.orders.delete(lost.id);

    expect(await flushOutbox(db, transport)).toMatchObject({ sent: 3, remaining: 0 });
    expect(await sql('select device_seq from orders order by device_seq')).toEqual([{ device_seq: 1 }, { device_seq: 3 }]);
    expect(await sql('select missing_seq, resolved_at from seq_gaps')).toEqual([{ missing_seq: 2, resolved_at: null }]);
    const notes = await sql(`select payload from notifications where kind = 'seq_gap'`);
    expect(notes).toHaveLength(1);
    expect(notes[0].payload).toMatchObject({ tablet_name: 'Tablet A', missing: [2], received: 3 });
  });

  it('tổng bị sửa ở tablet: server từ chối, op rời outbox vào danh sách rejected, không chặn các thao tác sau', async () => {
    const a = await createOrder(db, draft());
    const bad = await db.outbox.where('entity_id').equals(a.id).first();
    const payload = bad!.payload as { order: { total: number } };
    await db.outbox.update(bad!.seq!, { payload: { ...payload, order: { ...payload.order, total: 1_000 } } });
    const b = await createOrder(db, draft());

    expect(await flushOutbox(db, transport)).toMatchObject({ sent: 2, rejected: 1, remaining: 0 });
    expect(await db.rejected.toArray()).toMatchObject([{ kind: 'create_order', entity_id: a.id }]);
    expect(await sql('select id from orders')).toEqual([{ id: b.id }]);
  });

  it('SyncRunner với transport thật: thao tác mới tự lên server', async () => {
    const runner = new SyncRunner(db, transport);
    runner.start();
    const a = await createOrder(db, draft());
    const end = Date.now() + 10_000;
    while (runner.getStatus().state !== 'synced' || (await db.outbox.count()) > 0) {
      if (Date.now() > end) throw new Error(`timeout: ${JSON.stringify(runner.getStatus())}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    runner.stop();
    expect(await sql('select id from orders')).toEqual([{ id: a.id }]);
  });
});
