import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildItem } from '@/domain/pricing';
import { XOI_GA, XOI_XEO, TRUNG } from '@/domain/fixtures';
import type { TabletProfile } from '@/domain/types';
import { LaodaiDB, META, setMeta, type OutboxEntry } from './db';
import { currentDeviceSeq, seedDeviceSeq } from './deviceSeq';
import { SyncEngine, flushOutbox, type PushResult, type SyncTransport } from './engine';
import {
  LocalOpError, closeShift, createOrder, deleteOrder, openShift, payOrder, recordDebtPayment,
  serveOrder, updateOrder, visibleOrders,
} from './localOps';
import { pendingCount, pendingOps } from './outbox';

const PROFILE: TabletProfile = {
  id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a', 'com-ga'], default_boxes: 200, default_plates: 50, default_float: 500_000,
};

let db: LaodaiDB;
let n = 0;
let t = Date.parse('2026-11-17T22:42:00Z');
const clock = () => new Date((t += 1000));

/** RPC giả lập server idempotent: ghi theo op_id, đếm số bản ghi thật. */
class MockServer implements SyncTransport {
  online = true;
  failNext = 0;
  seen = new Map<string, OutboxEntry>();
  received: OutboxEntry[] = [];
  rejectKinds = new Set<string>();
  async push(op: OutboxEntry): Promise<PushResult> {
    if (!this.online) throw new Error('offline');
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('500');
    }
    this.received.push(op);
    if (this.seen.has(op.op_id)) return { status: 'duplicate' };
    if (this.rejectKinds.has(op.kind)) return { status: 'rejected', reason: 'total_mismatch' };
    this.seen.set(op.op_id, op);
    return { status: 'ok' };
  }
}

async function activate(d = db) {
  await setMeta(d, META.activation, { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: new Date().toISOString(), owner_email: '' });
}

const draft = (qty = 1) => ({ point_id: 'xoi-a', dine_type: 'takeaway' as const, items: [buildItem(`it${++n}`, XOI_GA, [TRUNG], qty)] });

beforeEach(async () => {
  db = new LaodaiDB(`test-${++n}`);
  await activate();
  await openShift(db, { staff_id: 'lan', staff_name: 'Lan', profile: PROFILE }, clock);
});

afterEach(async () => {
  await db.delete();
});

describe('outbox', () => {
  it('ghi thao tác theo đúng thứ tự', async () => {
    const o = await createOrder(db, draft(), clock);
    await serveOrder(db, o.id, clock);
    await payOrder(db, o.id, { method: 'cash', cash_given: 50_000 }, clock);
    expect((await pendingOps(db)).map((x) => x.kind)).toEqual(['open_shift', 'create_order', 'serve_order', 'pay_order']);
  });

  it('mất mạng thì outbox giữ nguyên; có mạng lại thì gửi đúng thứ tự', async () => {
    const server = new MockServer();
    server.online = false;
    const a = await createOrder(db, draft(), clock);
    const b = await createOrder(db, draft(), clock);
    const rep1 = await flushOutbox(db, server);
    expect(rep1).toMatchObject({ sent: 0, remaining: 3, error: 'offline' });
    expect((await pendingOps(db))[0].attempts).toBe(1);

    server.online = true;
    const rep2 = await flushOutbox(db, server);
    expect(rep2).toMatchObject({ sent: 3, remaining: 0, error: null });
    expect(server.received.map((x) => [x.kind, x.entity_id])).toEqual([
      ['open_shift', expect.any(String)],
      ['create_order', a.id],
      ['create_order', b.id],
    ]);
  });

  it('lỗi giữa chừng thì dừng, không gửi lệch thứ tự', async () => {
    const server = new MockServer();
    await createOrder(db, draft(), clock);
    await createOrder(db, draft(), clock);
    await flushOutbox(db, { push: (op) => (op.kind === 'create_order' ? Promise.reject(new Error('boom')) : server.push(op)) });
    expect(await pendingCount(db)).toBe(2);
    expect(server.received.map((x) => x.kind)).toEqual(['open_shift']);
  });

  it('gửi trùng (retry) không tạo bản ghi trùng', async () => {
    const server = new MockServer();
    await createOrder(db, draft(), clock);
    const ops = await pendingOps(db);
    // Server nhận được nhưng phản hồi bị mất ⇒ client gửi lại
    await server.push(ops[0]);
    await server.push(ops[1]);
    await flushOutbox(db, server);
    expect(server.received.length).toBe(4);
    expect(server.seen.size).toBe(2);
    expect(await pendingCount(db)).toBe(0);
  });

  it('op bị server từ chối thì bỏ khỏi outbox, lưu vào danh sách rejected, không chặn hàng đợi', async () => {
    const server = new MockServer();
    server.rejectKinds.add('update_order');
    const o = await createOrder(db, draft(), clock);
    await updateOrder(db, o.id, { label: 'bàn 3' }, clock);
    await serveOrder(db, o.id, clock);
    const rep = await flushOutbox(db, server, () => new Date('2026-11-18T00:00:00Z'));
    expect(rep).toMatchObject({ sent: 3, rejected: 1, remaining: 0 });
    const rej = await db.rejected.toArray();
    expect(rej).toHaveLength(1);
    expect(rej[0]).toMatchObject({ kind: 'update_order', reason: 'total_mismatch' });
  });

  it('SyncEngine chỉ chạy một luồng flush tại một thời điểm và báo listener', async () => {
    const server = new MockServer();
    const spy = vi.spyOn(server, 'push');
    const engine = new SyncEngine(db, server);
    const seen: number[] = [];
    const off = engine.onFlush((r) => seen.push(r.sent));
    await createOrder(db, draft(), clock);
    const [r1, r2] = await Promise.all([engine.flush(), engine.flush()]);
    expect(r1).toBe(r2);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([2]);
    off();
    await engine.flush();
    expect(seen).toEqual([2]);
  });
});

describe('device_seq', () => {
  it('tăng liên tục, không nhảy khi app reload', async () => {
    const a = await createOrder(db, draft(), clock);
    const b = await createOrder(db, draft(), clock);
    // "Reload": đóng kết nối, mở lại cùng DB
    const name = db.name;
    db.close();
    db = new LaodaiDB(name);
    await db.open();
    const c = await createOrder(db, draft(), clock);
    expect([a.device_seq, b.device_seq, c.device_seq]).toEqual([1, 2, 3]);
    expect(await currentDeviceSeq(db)).toBe(3);
  });

  it('transaction lỗi thì không tiêu số', async () => {
    await expect(createOrder(db, { ...draft(), items: [] }, clock)).rejects.toThrow(LocalOpError);
    await db.meta.delete(META.shift);
    await expect(createOrder(db, draft(), clock)).rejects.toThrow('Chưa mở ca');
    expect(await currentDeviceSeq(db)).toBe(0);
  });

  it('kích hoạt lại: tiếp tục từ số lớn nhất của server, không bao giờ lùi', async () => {
    await seedDeviceSeq(db, 41);
    expect((await createOrder(db, draft(), clock)).device_seq).toBe(42);
    await seedDeviceSeq(db, 10);
    expect(await currentDeviceSeq(db)).toBe(42);
  });
});

describe('đơn đã thanh toán trên tablet', () => {
  it('bị xóa khỏi IndexedDB ngay sau khi sync thành công', async () => {
    const server = new MockServer();
    const o = await createOrder(db, draft(), clock);
    await payOrder(db, o.id, { method: 'transfer' }, clock);
    expect(await visibleOrders(db)).toEqual([]); // ẩn ngay lúc thanh toán
    expect(await db.orders.get(o.id)).toMatchObject({ status: 'paid' }); // vẫn còn chờ sync
    await flushOutbox(db, server);
    expect(await db.orders.get(o.id)).toBeUndefined();
    expect(await db.orders.count()).toBe(0);
  });

  it('nếu sync thất bại thì đơn vẫn được giữ lại', async () => {
    const server = new MockServer();
    server.failNext = 1;
    const o = await createOrder(db, draft(), clock);
    await payOrder(db, o.id, { method: 'cash', cash_given: 31_000 }, clock);
    await flushOutbox(db, server);
    expect(await db.orders.get(o.id)).toMatchObject({ status: 'paid' });
    // pay_order lỗi ở giữa chừng cũng không xóa đơn
    const s2 = new MockServer();
    await flushOutbox(db, { push: (op) => (op.kind === 'pay_order' ? Promise.reject(new Error('x')) : s2.push(op)) });
    expect(await db.orders.get(o.id)).toMatchObject({ status: 'paid' });
    await flushOutbox(db, s2);
    expect(await db.orders.get(o.id)).toBeUndefined();
  });

  it('đơn đã xóa cũng được dọn khỏi tablet sau khi sync', async () => {
    const o = await createOrder(db, draft(), clock);
    await serveOrder(db, o.id, clock);
    await deleteOrder(db, o.id, 'customer_left', clock);
    expect(await visibleOrders(db)).toEqual([]);
    const ops = await pendingOps(db);
    expect(ops.at(-1)!.payload).toMatchObject({ reason: 'customer_left', status_before: 'served' });
    await flushOutbox(db, new MockServer());
    expect(await db.orders.count()).toBe(0);
  });
});

describe('thao tác tablet', () => {
  it('mở ca nhận số mặc định của hồ sơ tablet; không mở ca thứ hai', async () => {
    const shift = (await pendingOps(db))[0];
    expect(shift.kind).toBe('open_shift');
    await expect(openShift(db, { staff_id: 'x', staff_name: 'X', profile: PROFILE }, clock)).rejects.toThrow('đang có ca mở');
  });

  it('chưa kích hoạt thì không mở ca', async () => {
    const d = new LaodaiDB(`test-noact-${n}`);
    await expect(openShift(d, { staff_id: 'x', staff_name: 'X', profile: PROFILE }, clock)).rejects.toThrow('chưa được kích hoạt');
    await d.delete();
  });

  it('tạo đơn: mã 3 ký tự không trùng trong ngày, tổng tính từ món', async () => {
    const o = await createOrder(db, { ...draft(2), label: '  áo đỏ ', table_no: '' }, clock);
    expect(o.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/);
    expect(o.total).toBe((25_000 + 6_000) * 2);
    expect(o.label).toBe('áo đỏ');
    expect(o.table_no).toBeNull();
    const codes = new Set([o.code]);
    for (let i = 0; i < 30; i++) codes.add((await createOrder(db, draft(), clock)).code);
    expect(codes.size).toBe(31);
    expect(await db.usedCodes.count()).toBe(31);
  });

  it('sửa đơn đang mở: tính lại tổng, ghi outbox; đơn đã thanh toán thì không sửa được', async () => {
    const o = await createOrder(db, draft(2), clock);
    const after = await updateOrder(db, o.id, { items: [buildItem('x', XOI_XEO, [], 1)], dine_type: 'dinein', label: 'b5' }, clock);
    expect(after.total).toBe(15_000);
    expect(after.label).toBe('b5');
    const kept = await updateOrder(db, o.id, { table_no: ' 7 ' }, clock);
    expect(kept.label).toBe('b5');
    expect(kept.table_no).toBe('7');
    await payOrder(db, o.id, { method: 'transfer' }, clock);
    await expect(updateOrder(db, o.id, { label: 'x' }, clock)).rejects.toThrow('không còn mở');
    await expect(deleteOrder(db, o.id, 'mistake', clock)).rejects.toThrow('không còn mở');
    await expect(updateOrder(db, o.id, { items: [] }, clock)).rejects.toThrow('chưa có món');
  });

  it('không ra món hai lần', async () => {
    const o = await createOrder(db, draft(), clock);
    await serveOrder(db, o.id, clock);
    await expect(serveOrder(db, o.id, clock)).rejects.toThrow('đã ra món');
  });

  it('thanh toán tiền mặt thiếu thì từ chối; tiền tính vào ca đang mở lúc thu', async () => {
    const o = await createOrder(db, draft(), clock);
    await expect(payOrder(db, o.id, { method: 'cash', cash_given: 30_000 }, clock)).rejects.toThrow('chưa đủ');
    const firstShift = (await db.meta.get(META.shift))!.value as { id: string };
    await closeShift(db, { boxes_left: 150, plates_left: 50, cash_counted: 500_000 }, clock);
    await openShift(db, { staff_id: 'mai', staff_name: 'Mai', profile: PROFILE }, clock);
    const secondShift = (await db.meta.get(META.shift))!.value as { id: string };
    // Đơn mở từ ca trước vẫn hiện và thu được ở ca sau
    expect((await visibleOrders(db)).map((x) => x.id)).toEqual([o.id]);
    await payOrder(db, o.id, { method: 'cash', cash_given: 50_000 }, clock);
    const paid = await db.orders.get(o.id);
    expect(paid).toMatchObject({ opened_shift_id: firstShift.id, paid_shift_id: secondShift.id, cash_given: 50_000 });
  });

  it('ghi nợ: tên bắt buộc; tên mới thì tự tạo khách', async () => {
    const o = await createOrder(db, draft(), clock);
    await expect(payOrder(db, o.id, { method: 'debt', customer: { name: '  ' } }, clock)).rejects.toThrow('Cần tên');
    await payOrder(db, o.id, { method: 'debt', customer: { name: ' Hùng ', description: 'xe ôm', phone: '' } }, clock);
    const op = (await pendingOps(db)).at(-1)!;
    expect(op.payload.customer).toMatchObject({ is_new: true, name: 'Hùng', description: 'xe ôm', phone: null });
    const o2 = await createOrder(db, draft(), clock);
    await payOrder(db, o2.id, { method: 'debt', customer: { id: 'c-dung', name: 'Dũng' } }, clock);
    expect((await pendingOps(db)).at(-1)!.payload.customer).toMatchObject({ id: 'c-dung', is_new: false });
  });

  it('đóng ca: không trả số kỳ vọng, không chặn khi còn đơn mở, từ chối số âm', async () => {
    await createOrder(db, draft(), clock);
    await expect(closeShift(db, { boxes_left: -1, plates_left: 0, cash_counted: 0 }, clock)).rejects.toThrow();
    const res = await closeShift(db, { boxes_left: 190, plates_left: 50, cash_counted: 520_000 }, clock);
    expect(res).toBeUndefined();
    expect(await db.meta.get(META.shift)).toBeUndefined();
    expect((await visibleOrders(db)).length).toBe(1);
    await expect(closeShift(db, { boxes_left: 0, plates_left: 0, cash_counted: 0 }, clock)).rejects.toThrow('Chưa mở ca');
  });

  it('thu nợ ghi vào ca hiện tại', async () => {
    await expect(recordDebtPayment(db, { customer_id: 'c1', amount: 0, method: 'cash' }, clock)).rejects.toThrow();
    const id = await recordDebtPayment(db, { customer_id: 'c1', amount: 50_000, method: 'cash' }, clock);
    const op = (await pendingOps(db)).at(-1)!;
    const shift = (await db.meta.get(META.shift))!.value as { id: string };
    expect(op).toMatchObject({ kind: 'debt_payment', entity_id: id });
    expect(op.payload).toMatchObject({ amount: 50_000, method: 'cash', shift_id: shift.id });
  });
});
