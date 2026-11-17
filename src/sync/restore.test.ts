import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LaodaiDB, META, setMeta, type LocalShift } from './db';
import { buildItem } from '@/domain/pricing';
import { XOI_GA, order } from '@/domain/fixtures';
import { createOrder, visibleOrders } from './localOps';
import { RestoreError, createSupabaseRestoreSource, restoreOpenState, type RestoreSource } from './restore';

const SHIFT: LocalShift = {
  id: 'sh-1', tablet_profile_id: 'tab-a', staff_id: 's1', staff_name: 'Lan',
  opened_at: '2026-11-17T22:40:00.000Z', open_boxes: 200, open_plates: 60, open_float: 500_000,
};

let db: LaodaiDB;
let n = 0;

beforeEach(async () => {
  db = new LaodaiDB(`restore-${++n}`);
  await setMeta(db, META.activation, { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: '' });
});

afterEach(async () => {
  await db.delete();
});

describe('khôi phục ca + đơn đang mở khi kích hoạt lại', () => {
  it('máy trống: lấy lại ca đang mở và đơn đang mở; mã đơn đã dùng không bị cấp lại', async () => {
    const o1 = order({ id: 'o1', code: 'ABC', opened_shift_id: 'sh-0', created_at: '2026-11-17T22:00:00.000Z' }); // ca trước
    const o2 = order({ id: 'o2', code: 'XYZ', status: 'served', opened_shift_id: 'sh-1', created_at: '2026-11-17T23:00:00.000Z' });
    const source = vi.fn<RestoreSource>().mockResolvedValue({ shift: SHIFT, orders: [o1, o2] });
    expect(await restoreOpenState(db, source)).toEqual({ shift: true, orders: 2 });
    expect(source).toHaveBeenCalledWith('tab-a');
    expect((await db.meta.get(META.shift))?.value).toEqual(SHIFT);
    expect((await visibleOrders(db)).map((o) => o.id).sort()).toEqual(['o1', 'o2']);
    expect((await db.usedCodes.toArray()).map((u) => u.code).sort()).toEqual(['ABC', 'XYZ']);
    // Đơn mới sau khôi phục dùng được ca đã lấy lại
    const created = await createOrder(db, { point_id: 'xoi-a', dine_type: 'takeaway', items: [buildItem('i', XOI_GA, [])] });
    expect(created.opened_shift_id).toBe('sh-1');
    expect(['ABC', 'XYZ']).not.toContain(created.code);
  });

  it('không ghi đè dữ liệu trên máy: ca đang có giữ nguyên, đơn đã có giữ bản trên máy', async () => {
    const local: LocalShift = { ...SHIFT, id: 'sh-local', staff_name: 'Mai' };
    await setMeta(db, META.shift, local);
    await db.orders.add(order({ id: 'o1', label: 'trên máy' }));
    const res = await restoreOpenState(db, async () => ({ shift: SHIFT, orders: [order({ id: 'o1', label: 'server' }), order({ id: 'o3' })] }));
    expect(res).toEqual({ shift: false, orders: 1 });
    expect((await db.meta.get(META.shift))?.value).toEqual(local);
    expect((await db.orders.get('o1'))?.label).toBe('trên máy');
  });

  it('bỏ qua dữ liệu không thuộc hồ sơ này hoặc không còn mở; server không có ca mở thì thôi', async () => {
    const res = await restoreOpenState(db, async () => ({
      shift: { ...SHIFT, tablet_profile_id: 'tab-b' },
      orders: [order({ id: 'x', tablet_profile_id: 'tab-b' }), order({ id: 'y', status: 'paid' })],
    }));
    expect(res).toEqual({ shift: false, orders: 0 });
    expect(await db.meta.get(META.shift)).toBeUndefined();
    expect(await restoreOpenState(db, async () => ({ shift: null, orders: [] }))).toEqual({ shift: false, orders: 0 });
  });

  it('chưa kích hoạt / lỗi nguồn ⇒ báo lỗi, không đổi gì', async () => {
    await expect(restoreOpenState(db, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    await db.meta.delete(META.activation);
    await expect(restoreOpenState(db, async () => ({ shift: SHIFT, orders: [] }))).rejects.toBeInstanceOf(RestoreError);
    expect(await db.meta.get(META.shift)).toBeUndefined();
  });
});

describe('createSupabaseRestoreSource', () => {
  type R = { data: unknown; error: { message: string } | null };
  function fake(shifts: R, orders: R) {
    const calls: Record<string, unknown[]> = {};
    const chain = (table: string, res: R) => {
      const p = Promise.resolve(res);
      const q = Object.assign(p, {
        eq: (...a: unknown[]) => ((calls[`${table}.eq`] ??= []).push(a), q),
        in: (...a: unknown[]) => ((calls[`${table}.in`] ??= []).push(a), q),
      });
      return q;
    };
    const client = { from: (t: string) => ({ select: () => chain(t, t === 'shifts' ? shifts : orders) }) };
    return { client: client as unknown as SupabaseClient, calls };
  }

  it('đọc ca đang mở (kèm tên nhân viên) và đơn đang mở; bỏ dòng đơn đã bị bỏ, giữ thứ tự dòng', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { items, ...head } = order({ id: 'o1' });
    const { client, calls } = fake(
      { data: [{ ...SHIFT, staff_name: undefined, staff: { name: 'Lan' } }], error: null },
      {
        data: [{
          ...head,
          order_items: [
            { id: 'b', product_id: 'p', name_snap: 'B', unit_price_snap: 1, qty: 1, toppings_snap: [], sort: 1, removed_at: null },
            { id: 'x', product_id: 'p', name_snap: 'X', unit_price_snap: 1, qty: 1, toppings_snap: [], sort: 0, removed_at: '2026-11-17T00:00:00Z' },
            { id: 'a', product_id: 'p', name_snap: 'A', unit_price_snap: 1, qty: 2, toppings_snap: [], sort: 0, removed_at: null },
          ],
        }],
        error: null,
      },
    );
    const got = await createSupabaseRestoreSource(client)('tab-a');
    expect(got.shift).toEqual(SHIFT);
    expect(got.orders[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(got.orders[0].items[0]).toEqual({ id: 'a', product_id: 'p', name_snap: 'A', unit_price_snap: 1, qty: 2, toppings_snap: [] });
    expect(calls['shifts.eq']).toEqual([['tablet_profile_id', 'tab-a'], ['status', 'open']]);
    expect(calls['orders.in']).toEqual([['status', ['open', 'served']]]);
  });

  it('không có ca mở ⇒ null; lỗi ⇒ RestoreError', async () => {
    expect((await createSupabaseRestoreSource(fake({ data: [], error: null }, { data: null, error: null }).client)('tab-a'))).toEqual({ shift: null, orders: [] });
    const noName = await createSupabaseRestoreSource(fake({ data: [{ ...SHIFT, staff: null }], error: null }, { data: [], error: null }).client)('tab-a');
    expect(noName.shift?.staff_name).toBe('?');
    const boom = { data: null, error: { message: 'boom' } };
    await expect(createSupabaseRestoreSource(fake(boom, { data: [], error: null }).client)('tab-a')).rejects.toThrow('ca đang mở');
    await expect(createSupabaseRestoreSource(fake({ data: [], error: null }, boom).client)('tab-a')).rejects.toThrow('đơn đang mở');
  });
});
