import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { PosNetworkError, createSupabaseBackend, loadOpenStateFrom, parsePushResult } from './backend';

const ORDER = {
  id: 'o1', device_seq: 1, tablet_profile_id: 'tab-a', point_id: 'p', code: 'ABC', label: null, table_no: null,
  dine_type: 'takeaway', status: 'open', opened_shift_id: 's', paid_shift_id: null, created_at: 't', served_at: null,
  paid_at: null, deleted_at: null, delete_reason: null, total: 1, payment_method: null, cash_given: null, customer_id: null,
  owner_edited: false, recalculated_at: 'extra',
};

describe('parsePushResult', () => {
  it('ok / duplicate kèm đơn (chỉ giữ trường của Order) hoặc ca; rejected kèm lý do', () => {
    const item = { id: 'i', product_id: 'p', name_snap: 'n', unit_price_snap: 1, qty: 1, toppings_snap: [], sort: 1 };
    const r = parsePushResult({ status: 'ok', order: { ...ORDER, items: [item] } });
    expect(r).toEqual({ status: 'ok', order: { ...ORDER, recalculated_at: undefined, address: null, items: [{ ...item, sort: undefined }] } });
    expect(Object.keys((r as { order: object }).order)).not.toContain('recalculated_at');
    expect(parsePushResult({ status: 'duplicate', order: ORDER })).toMatchObject({ status: 'duplicate', order: { items: [] } });
    expect(parsePushResult({ status: 'ok', shift: { id: 's' } })).toEqual({ status: 'ok', shift: { id: 's' } });
    expect(parsePushResult({ status: 'duplicate' })).toEqual({ status: 'duplicate' });
    expect(parsePushResult({ status: 'rejected', reason: 'x' })).toEqual({ status: 'rejected', reason: 'x' });
    expect(parsePushResult({ status: 'rejected' })).toEqual({ status: 'rejected', reason: 'unknown' });
  });

  it('phản hồi lạ ⇒ lỗi tạm thời (gửi lại được)', () => {
    expect(() => parsePushResult(null)).toThrow(PosNetworkError);
    expect(() => parsePushResult({ status: 'weird' })).toThrow('không hợp lệ');
  });
});

type Res = { data: unknown; error: { message: string; code?: string } | null };

function fakeClient(opts: { rpc?: () => Promise<Res>; shifts?: Res; orders?: Res } = {}) {
  const handlers: Array<(m: unknown) => void> = [];
  let statusCb: ((s: string) => void) | null = null;
  const filters: Array<[string, unknown]> = [];
  const query = (res: Res) => {
    const q = Object.assign(Promise.resolve(res), {
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      in: (c: string, v: unknown) => (filters.push([c, v]), q),
    });
    return q;
  };
  const channel = {
    on: (_t: string, _f: unknown, h: (m: unknown) => void) => (handlers.push(h), channel),
    subscribe: (cb: (s: string) => void) => ((statusCb = cb), channel),
  };
  const client = {
    rpc: vi.fn(opts.rpc ?? (async () => ({ data: { status: 'ok' }, error: null }))),
    from: (t: string) => ({ select: () => query((t === 'shifts' ? opts.shifts : opts.orders) ?? { data: [], error: null }) }),
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  };
  return {
    client: client as unknown as SupabaseClient,
    raw: client,
    filters,
    emit: (m: unknown) => handlers.forEach((h) => h(m)),
    status: (s: string) => statusCb!(s),
  };
}

describe('createSupabaseBackend', () => {
  it('push gọi sync_push; lỗi RPC / lỗi fetch ⇒ PosNetworkError', async () => {
    const f = fakeClient();
    const b = createSupabaseBackend(f.client);
    const op = { op_id: '1', kind: 'serve_order' as const, entity_id: 'o', payload: {} };
    expect(await b.push(op)).toEqual({ status: 'ok' });
    expect(f.raw.rpc).toHaveBeenCalledWith('sync_push', { op });
    const e1 = createSupabaseBackend(fakeClient({ rpc: async () => ({ data: null, error: { message: 'JWT expired', code: 'PGRST301' } }) }).client);
    await expect(e1.push(op)).rejects.toMatchObject({ name: 'PosNetworkError', code: 'PGRST301' });
    const e2 = createSupabaseBackend(fakeClient({ rpc: async () => ({ data: null, error: { message: 'x' } }) }).client);
    await expect(e2.push(op)).rejects.toMatchObject({ code: null });
    const e3 = createSupabaseBackend(fakeClient({ rpc: () => Promise.reject(new TypeError('Failed to fetch')) }).client);
    await expect(e3.push(op)).rejects.toThrow(PosNetworkError);
    const e4 = createSupabaseBackend(fakeClient({ rpc: () => Promise.reject('down') }).client);
    await expect(e4.push(op)).rejects.toThrow('down');
  });

  it('nghe live_pulse: đúng khóa hồ sơ ⇒ "open", "catalog" ⇒ danh mục, khóa khác bỏ qua; trạng thái kênh', () => {
    const f = fakeClient();
    const b = createSupabaseBackend(f.client);
    const onPulse = vi.fn();
    const onStatus = vi.fn();
    const off = b.subscribe('tab-a', onPulse, onStatus);
    expect(onStatus).toHaveBeenLastCalledWith('connecting');
    f.emit({ new: { key: 'profile:tab-a' } });
    f.emit({ new: {}, old: { key: 'catalog' } });
    f.emit({ new: { key: 'profile:tab-b' } });
    f.emit({ new: null, old: null });
    expect(onPulse.mock.calls).toEqual([['open'], ['catalog']]);
    f.status('SUBSCRIBED');
    expect(onStatus).toHaveBeenLastCalledWith('live');
    for (const s of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      f.status(s);
      expect(onStatus).toHaveBeenLastCalledWith('down');
    }
    off();
    expect(f.raw.removeChannel).toHaveBeenCalled();
  });
});

describe('loadOpenStateFrom', () => {
  it('ca đang mở (kèm tên nhân viên) + đơn đang mở; dòng đã bỏ bị lọc, đúng thứ tự', async () => {
    const it = (id: string, sort: number, removed_at: string | null = null) => ({
      id, product_id: 'p', name_snap: 'n', unit_price_snap: 1, qty: 1, toppings_snap: [], sort, removed_at,
    });
    const f = fakeClient({
      shifts: { data: [{ id: 's', tablet_profile_id: 'tab-a', staff_id: 'st', opened_at: 't', open_boxes: 1, open_plates: 2, open_float: 3, staff: { name: 'Lan' } }], error: null },
      orders: { data: [{ ...ORDER, order_items: [it('b', 2), it('x', 3, 'gone'), it('a', 1)] }], error: null },
    });
    const s = await loadOpenStateFrom(f.client, 'tab-a');
    expect(s.shift).toMatchObject({ id: 's', staff_name: 'Lan', open_float: 3 });
    expect(s.orders[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(f.filters).toContainEqual(['tablet_profile_id', 'tab-a']);
    expect(f.filters).toContainEqual(['status', ['open', 'served']]);
    const noStaff = fakeClient({ shifts: { data: [{ id: 's', staff: null }], error: null }, orders: { data: null, error: null } });
    expect(await loadOpenStateFrom(noStaff.client, 'tab-a')).toMatchObject({ shift: { staff_name: '?' }, orders: [] });
    const none = fakeClient({ shifts: { data: null, error: null } });
    expect((await loadOpenStateFrom(none.client, 'tab-a')).shift).toBeNull();
  });

  it('lỗi đọc ⇒ PosNetworkError', async () => {
    const bad = { data: null, error: { message: 'boom' } };
    await expect(loadOpenStateFrom(fakeClient({ shifts: bad }).client, 'x')).rejects.toThrow('ca đang mở: boom');
    await expect(loadOpenStateFrom(fakeClient({ orders: bad }).client, 'x')).rejects.toThrow('đơn đang mở: boom');
    const b = createSupabaseBackend(fakeClient({ orders: bad }).client);
    await expect(b.loadOpenState('x')).rejects.toThrow(PosNetworkError);
  });
});
