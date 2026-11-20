import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBO_XOI_FULL, CHA, TRUNG, XOI_GA } from '@/domain/fixtures';
import type { OrderItem } from '@/domain/types';
import { CATALOG } from '@/test-utils/tablet';
import { FakeServer } from '@/test-utils/fakeServer';
import { PosNetworkError, type PosBackend } from './backend';
import { debtBook } from './debt';
import { OFFLINE_MESSAGE, Pos, PosError, rejectMessage } from './ops';
import { TabletStore } from './store';

const line = (id = 'l1', qty = 1): OrderItem => ({
  id,
  product_id: COMBO_XOI_FULL.product_id,
  name_snap: 'Xôi gà',
  unit_price_snap: XOI_GA.price,
  qty,
  toppings_snap: [TRUNG, CHA].map((t) => ({ id: t.id, name: t.name, price: t.price, extra_box: t.extra_box_takeaway })),
});
const draft = (over = {}) => ({ point_id: 'xoi-a', dine_type: 'takeaway' as const, items: [line()], ...over });

let server: FakeServer;
let backend: PosBackend;
let store: TabletStore;
let pos: Pos;

async function boot(withShift = true) {
  store = new TabletStore(backend, { debounceMs: 0, schedule: () => () => undefined });
  pos = new Pos(store, { retryDelaysMs: [0, 0], sleep: async () => undefined });
  store.start('tab-a');
  await store.refresh();
  if (withShift) await pos.openShift({ staff_id: 's1' });
}

beforeEach(() => {
  server = new FakeServer(CATALOG);
  backend = server.device();
});

describe('ca', () => {
  it('mở ca: server ghi ca, store có ca ngay; đã có ca thì không mở nữa', async () => {
    await boot(false);
    const s = await pos.openShift({ staff_id: 's1' });
    expect(s).toMatchObject({ staff_id: 's1', staff_name: 'Lan', open_float: 500_000 });
    expect(store.getSnapshot().open?.shift).toEqual(s);
    await expect(pos.openShift({ staff_id: 's2' })).rejects.toThrow('đang có ca mở');
  });

  it('máy khác đã mở ca (máy này chưa thấy) ⇒ server từ chối, báo rõ, tải lại thấy ca đó', async () => {
    await boot(false);
    server.shifts.push({ id: 'x', tablet_profile_id: 'tab-a', staff_id: 's2', staff_name: 'Mai', opened_at: '', open_boxes: 0, open_plates: 0, open_float: 0, status: 'open' });
    await expect(pos.openShift({ staff_id: 's1' })).rejects.toThrow('có thể vừa mở ở máy khác');
    await vi.waitFor(() => expect(store.getSnapshot().open?.shift?.staff_name).toBe('Mai'));
  });

  it('server không trả ca ⇒ tải lại để lấy; vẫn không có thì báo lỗi', async () => {
    await boot(false);
    const push = vi.spyOn(backend, 'push').mockResolvedValueOnce({ status: 'ok' });
    await expect(pos.openShift({ staff_id: 's1' })).rejects.toThrow('Không mở được ca');
    push.mockRestore();
    server.shifts.push({ id: 'y', tablet_profile_id: 'tab-a', staff_id: 's1', staff_name: 'Lan', opened_at: '', open_boxes: 0, open_plates: 0, open_float: 0, status: 'open' });
    vi.spyOn(backend, 'push').mockResolvedValueOnce({ status: 'duplicate' });
    store.setShift(null);
    expect(await pos.openShift({ staff_id: 's1' })).toMatchObject({ id: 'y' });
  });

  it('đóng ca: số phải là số nguyên ≥ 0; xong thì store không còn ca', async () => {
    await boot();
    await expect(pos.closeShift({ boxes_left: -1, plates_left: 0, cash_counted: 0 })).rejects.toThrow('Số không hợp lệ: boxes_left');
    await expect(pos.closeShift({ boxes_left: 1, plates_left: 0.5, cash_counted: 0 })).rejects.toThrow('plates_left');
    await pos.closeShift({ boxes_left: 1, plates_left: 2, cash_counted: 3 });
    expect(store.getSnapshot().open?.shift).toBeNull();
    expect(server.ops.at(-1)?.payload).toMatchObject({ boxes_left: 1, plates_left: 2, cash_counted: 3 });
    await expect(pos.closeShift({ boxes_left: 0, plates_left: 0, cash_counted: 0 })).rejects.toThrow('Chưa mở ca');
  });
});

describe('đơn', () => {
  it('tạo đơn: server cấp mã + số thứ tự; không gửi giờ máy; kiểm món / địa chỉ tại máy', async () => {
    await boot();
    await expect(pos.createOrder(draft({ items: [] }))).rejects.toThrow('Đơn chưa có món');
    await expect(pos.createOrder(draft({ items: [line('l1', 0)] }))).rejects.toThrow();
    await expect(pos.createOrder(draft({ dine_type: 'delivery', address: '  ' }))).rejects.toThrow('Đơn ship cần địa chỉ');
    const o = await pos.createOrder(draft({ label: '  bàn 1 ', table_no: ' ', dine_type: 'delivery', address: ' 12 Lê Lợi ' }));
    expect(o).toMatchObject({ device_seq: 1, label: 'bàn 1', table_no: null, address: '12 Lê Lợi', total: 39_000, status: 'open' });
    expect(o.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$/);
    expect(server.ops.at(-1)).not.toHaveProperty('performed_at');
    expect(store.getSnapshot().open?.orders).toEqual([o]);
    const o2 = await pos.createOrder(draft());
    expect(o2.device_seq).toBe(2);
    expect(o2.address).toBeNull();
  });

  it('sửa đơn: tổng tính lại, đổi loại đơn thì địa chỉ theo; đơn không còn mở thì báo', async () => {
    await boot();
    const o = await pos.createOrder(draft({ dine_type: 'delivery', address: 'A' }));
    const u = await pos.updateOrder(o.id, { items: [line('l1', 2)], label: ' x ', table_no: ' 3 ' });
    expect(u).toMatchObject({ total: 78_000, label: 'x', table_no: '3', address: 'A' });
    const u2 = await pos.updateOrder(o.id, { dine_type: 'takeaway' });
    expect(u2.address).toBeNull();
    await expect(pos.updateOrder(o.id, { items: [] })).rejects.toThrow('Đơn chưa có món');
    await expect(pos.updateOrder('nope', {})).rejects.toThrow('Đơn không còn mở');
  });

  it('ra món: đã ra món thì báo; máy khác vừa ra món ⇒ không phải lỗi', async () => {
    await boot();
    const o = await pos.createOrder(draft());
    expect((await pos.serveOrder(o.id)).status).toBe('served');
    await expect(pos.serveOrder(o.id)).rejects.toThrow('Đơn đã ra món');
    const o2 = await pos.createOrder(draft());
    Object.assign(server.order(o2.id)!, { status: 'served' }); // máy khác, chưa báo về
    expect((await pos.serveOrder(o2.id)).status).toBe('served');
    // Đơn biến mất hẳn sau khi tải lại ⇒ trả bản đã ra món
    const o3 = await pos.createOrder(draft());
    Object.assign(server.order(o3.id)!, { status: 'served' });
    vi.spyOn(backend, 'loadOpenState').mockResolvedValueOnce({ shift: store.getSnapshot().open!.shift, orders: [] });
    expect(await pos.serveOrder(o3.id)).toMatchObject({ id: o3.id, status: 'served' });
  });

  it('xóa đơn: gửi lý do + trạng thái lúc xóa, đơn rời hàng đợi', async () => {
    await boot();
    const o = await pos.createOrder(draft());
    await pos.deleteOrder(o.id, 'mistake');
    expect(server.ops.at(-1)?.payload).toMatchObject({ reason: 'mistake', status_before: 'open' });
    expect(store.getSnapshot().open?.orders).toEqual([]);
  });

  it('server không trả đơn ⇒ tải lại để lấy; không thấy ⇒ báo đơn không còn mở', async () => {
    await boot();
    vi.spyOn(backend, 'push').mockResolvedValueOnce({ status: 'ok' });
    await expect(pos.createOrder(draft())).rejects.toThrow('Đơn không còn mở');
    const o = await pos.createOrder(draft());
    vi.spyOn(backend, 'push').mockResolvedValueOnce({ status: 'ok' });
    expect((await pos.updateOrder(o.id, { label: 'z' })).id).toBe(o.id);
  });
});

describe('thanh toán & nợ', () => {
  it('tiền mặt thiếu ⇒ báo tại máy; đủ ⇒ đơn rời hàng đợi', async () => {
    await boot();
    const o = await pos.createOrder(draft());
    await expect(pos.payOrder(o.id, { method: 'cash', cash_given: 10_000 })).rejects.toThrow('chưa đủ tiền');
    await pos.payOrder(o.id, { method: 'cash', cash_given: 50_000 });
    expect(server.order(o.id)).toMatchObject({ status: 'paid', cash_given: 50_000 });
    expect(store.getSnapshot().open?.orders).toEqual([]);
  });

  it('ghi nợ: cần tên; khách mới được tạo, dư nợ có ngay', async () => {
    await boot();
    const o = await pos.createOrder(draft());
    await expect(pos.payOrder(o.id, { method: 'debt', customer: { name: ' ' } })).rejects.toThrow('Cần tên khách');
    await pos.payOrder(o.id, { method: 'debt', customer: { name: ' Hùng ', description: ' ', phone: ' 09 ' } });
    const c = server.ops.at(-1)!.payload.customer as { id: string };
    expect(c).toMatchObject({ is_new: true, name: 'Hùng', description: null, phone: '09' });
    expect(debtBook(store.getSnapshot().catalog).balance(c.id)).toBe(39_000);
  });

  it('thu nợ: số tiền phải dương; dư nợ giảm ngay', async () => {
    await boot();
    await expect(pos.recordDebtPayment({ customer_id: 'c-pb', amount: 0, method: 'cash' })).rejects.toThrow('Số tiền không hợp lệ');
    await pos.recordDebtPayment({ customer_id: 'c-pb', amount: 20_000, method: 'transfer' });
    expect(debtBook(store.getSnapshot().catalog).balance('c-pb')).toBe(100_000);
  });
});

describe('gửi lên server', () => {
  it('lỗi mạng ⇒ gửi lại cùng op_id; vẫn lỗi ⇒ báo mất kết nối, store "offline"', async () => {
    await boot();
    const push = vi.spyOn(backend, 'push');
    push.mockRejectedValueOnce(new PosNetworkError('x'));
    const o = await pos.createOrder(draft());
    expect(push.mock.calls[0][0].op_id).toBe(push.mock.calls[1][0].op_id);
    expect(server.openOrders()).toHaveLength(1);

    server.offline = true;
    await expect(pos.payOrder(o.id, { method: 'transfer' })).rejects.toThrow(OFFLINE_MESSAGE);
    expect(store.getSnapshot().conn).toBe('offline');
    expect(push).toHaveBeenCalledTimes(2 + 3);
  });

  /** Lần gửi đầu: server ghi nhưng phản hồi mất; các lần gửi lại tự động cũng lỗi mạng. */
  function loseResponse() {
    const orig = backend.push;
    return vi
      .spyOn(backend, 'push')
      .mockImplementationOnce(async (op) => {
        await orig(op);
        throw new PosNetworkError('lost');
      })
      .mockRejectedValueOnce(new PosNetworkError('x'))
      .mockRejectedValueOnce(new PosNetworkError('x'));
  }
  const opIds = (push: ReturnType<typeof loseResponse>, kind: string) =>
    new Set(push.mock.calls.filter((c) => c[0].kind === kind).map((c) => c[0].op_id));

  it('server đã ghi nhưng mất phản hồi ⇒ bấm lại đúng thao tác đó dùng lại op_id: không tạo đơn / thu nợ hai lần', async () => {
    await boot();
    let push = loseResponse();
    await expect(pos.createOrder(draft({ id: 'o-1' }))).rejects.toThrow(OFFLINE_MESSAGE);
    const o = await pos.createOrder(draft({ id: 'o-1' }));
    expect(opIds(push, 'create_order').size).toBe(1);
    expect(o).toMatchObject({ id: 'o-1', device_seq: 1 });
    expect(server.openOrders()).toHaveLength(1);
    push.mockRestore();

    push = loseResponse();
    await expect(pos.recordDebtPayment({ customer_id: 'c-pb', amount: 1000, method: 'cash' })).rejects.toThrow(OFFLINE_MESSAGE);
    const id = await pos.recordDebtPayment({ customer_id: 'c-pb', amount: 1000, method: 'cash' });
    expect(opIds(push, 'debt_payment').size).toBe(1);
    expect(server.ops.filter((x) => x.kind === 'debt_payment').map((x) => x.entity_id)).toEqual([id]);
    expect(server.catalog.balances['c-pb']).toBe(119_000);
    push.mockRestore();
    // Thao tác khác (số tiền khác) ⇒ id mới
    expect(await pos.recordDebtPayment({ customer_id: 'c-pb', amount: 2000, method: 'cash' })).not.toBe(id);
  });

  it('ghi nợ cho khách mới, gửi lỗi rồi bấm lại ⇒ cùng op, cùng id khách mới (không tạo hai khách)', async () => {
    await boot();
    const o = await pos.createOrder(draft());
    const push = vi.spyOn(backend, 'push');
    server.offline = true;
    await expect(pos.payOrder(o.id, { method: 'debt', customer: { name: 'Hùng' } })).rejects.toThrow(OFFLINE_MESSAGE);
    server.offline = false;
    await pos.payOrder(o.id, { method: 'debt', customer: { name: 'Hùng' } });
    const pays = push.mock.calls.filter((c) => c[0].kind === 'pay_order').map((c) => c[0]);
    expect(new Set(pays.map((x) => x.op_id)).size).toBe(1);
    expect(server.catalog.customers.filter((c) => c.name === 'Hùng')).toHaveLength(1);
  });

  it('bấm lại nhưng nội dung đã đổi ⇒ op mới (không lấy kết quả cũ)', async () => {
    await boot();
    const o = await pos.createOrder(draft());
    const push = loseResponse();
    await expect(pos.updateOrder(o.id, { label: 'a' })).rejects.toThrow(OFFLINE_MESSAGE);
    push.mockRestore();
    await pos.updateOrder(o.id, { label: 'b' });
    expect(server.ops.filter((x) => x.kind === 'update_order').map((x) => x.payload.label)).toEqual(['a', 'b']);
  });

  it('server từ chối ⇒ thông điệp dễ hiểu kèm lý do; lỗi không phải lỗi mạng ⇒ ném nguyên', async () => {
    await boot();
    vi.spyOn(backend, 'push').mockResolvedValueOnce({ status: 'rejected', reason: 'price_mismatch' });
    const err = await pos.createOrder(draft()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PosError);
    expect(err).toMatchObject({ reason: 'price_mismatch', message: 'Giá món vừa được chủ thay đổi. Kiểm tra lại đơn.' });
    vi.spyOn(backend, 'push').mockRejectedValueOnce(new TypeError('bug'));
    await expect(pos.createOrder(draft())).rejects.toThrow('bug');
    expect(rejectMessage('weird')).toBe('Máy chủ từ chối thao tác (weird).');
  });

  it('chưa mở ca / đơn không có ⇒ báo tại máy, không gửi', async () => {
    await boot(false);
    const push = vi.spyOn(backend, 'push');
    await expect(pos.createOrder(draft())).rejects.toThrow('Chưa mở ca');
    await expect(pos.recordDebtPayment({ customer_id: 'c', amount: 1, method: 'cash' })).rejects.toThrow('Chưa mở ca');
    await pos.openShift({ staff_id: 's1' });
    await expect(pos.payOrder('nope', { method: 'transfer' })).rejects.toThrow('Đơn không còn mở');
    await expect(pos.deleteOrder('nope', 'other')).rejects.toThrow('Đơn không còn mở');
    expect(push).toHaveBeenCalledTimes(1);
    pos.reset();
  });

  it('mặc định chờ thật giữa các lần gửi lại', async () => {
    store = new TabletStore(backend);
    const p = new Pos(store);
    expect(p.retryDelaysMs).toEqual([400, 1500]);
    vi.useFakeTimers();
    const done = p.sleep(400);
    vi.advanceTimersByTime(400);
    await done;
    vi.useRealTimers();
  });
});

describe('debtBook', () => {
  it('bỏ khách bị gộp; dư nợ theo khách gốc; không có danh mục ⇒ sổ rỗng', () => {
    const book = debtBook({
      customers: [
        { id: 'a', name: 'A', description: null, phone: null, address: null, merged_into_id: null },
        { id: 'b', name: 'B', description: null, phone: null, address: null, merged_into_id: 'a' },
      ],
      balances: { a: 5000 },
    });
    expect(book.customers.map((c) => c.id)).toEqual(['a']);
    expect(book.balance('b')).toBe(5000);
    expect(book.balance('zzz')).toBe(0);
    expect(debtBook(undefined).customers).toEqual([]);
  });
});
