// Hết món (SPEC mục 4.8): `sync_push` kind `set_sold_out` + `sold_out_today()`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import type { OpPayloads } from '@/pos/types';
import { TabletSim, op, push, wire } from '../support/ops';
import { SEED } from '../support/seed-ids';

let tab: SupabaseClient;
let sim: TabletSim;

type Mark = OpPayloads['set_sold_out'];
const markPayload = (p: Partial<Mark>): Mark =>
  ({ shift_id: sim.shift, point_id: SEED.points.xoiA, item_kind: 'product', item_id: '', sold_out: true, ...p });
const mark = (p: Partial<Mark> & Pick<Mark, 'item_id'>, at?: string) => wire('set_sold_out', p.item_id, markPayload(p), at);
/** Op thô: cố tình gửi giá trị ngoài kiểu (`combo`, `'yes'`). */
const markRaw = (p: Record<string, unknown> & Pick<Mark, 'item_id'>) => op('set_sold_out', p.item_id, { ...markPayload({}), ...p });

const today = async (c: SupabaseClient) => {
  const { data, error } = await c.rpc('sold_out_today');
  if (error) throw error;
  return (data as Array<{ point_id: string; item_kind: string; item_id: string }>).map((r) => `${r.point_id}:${r.item_kind}:${r.item_id}`).sort();
};

beforeEach(async () => {
  await resetDb();
  tab = await tabletClient(SEED.tablets.A);
  sim = new TabletSim(tab, SEED.tablets.A);
  await sim.openShift('Lan');
});

describe('hết món', () => {
  it('báo hết / bán lại: ghi theo điểm bán + ngày, mọi máy đọc được qua sold_out_today, nhật ký có tên món', async () => {
    const now = new Date().toISOString();
    expect(await push(tab, mark({ item_id: SEED.products.xoiGa }, now))).toMatchObject({ status: 'ok' });
    expect(await push(tab, mark({ item_kind: 'topping', item_id: SEED.toppings.trung }, now))).toMatchObject({ status: 'ok' });
    // Báo hết lần nữa (máy khác cùng quầy) ⇒ không ghi thêm nhật ký.
    expect(await push(tab, mark({ item_id: SEED.products.xoiGa }, now))).toMatchObject({ status: 'ok' });

    expect(await today(tab)).toEqual([
      `${SEED.points.xoiA}:product:${SEED.products.xoiGa}`,
      `${SEED.points.xoiA}:topping:${SEED.toppings.trung}`,
    ].sort());
    const logs = await sql(`select action, entity, after, staff_id from audit_log where action like 'sold_out%' order by at, action`);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ action: 'sold_out_set', staff_id: SEED.staff.Lan, after: { point_name: 'Xôi A' } });

    // Bán lại: dòng còn nguyên (không xóa), chỉ ghi cleared_at.
    expect(await push(tab, mark({ item_id: SEED.products.xoiGa, sold_out: false }))).toMatchObject({ status: 'ok' });
    expect(await today(tab)).toEqual([`${SEED.points.xoiA}:topping:${SEED.toppings.trung}`]);
    expect(await sql(`select cleared_at is not null as cleared from sold_out where item_id = $1`, [SEED.products.xoiGa])).toEqual([{ cleared: true }]);
    expect(await sql(`select 1 from audit_log where action = 'sold_out_clear'`)).toHaveLength(1);

    // Báo hết lại cùng ngày ⇒ dùng lại dòng cũ.
    await push(tab, mark({ item_id: SEED.products.xoiGa }));
    expect(await sql(`select count(*)::int n from sold_out where item_id = $1`, [SEED.products.xoiGa])).toEqual([{ n: 1 }]);
    expect(await today(tab)).toHaveLength(2);
  });

  it('báo hết từ hôm trước không còn hiệu lực hôm nay', async () => {
    const yesterday = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
    await sql(`update shifts set opened_at = $1 where id = $2`, [yesterday, sim.shiftId]);
    expect(await push(tab, mark({ item_id: SEED.products.xoiGa }, yesterday))).toMatchObject({ status: 'ok' });
    expect(await sql(`select 1 from sold_out`)).toHaveLength(1);
    expect(await today(tab)).toEqual([]);
  });

  it('từ chối: điểm bán không thuộc quầy, món của menu khác, chưa mở ca', async () => {
    expect(await push(tab, mark({ point_id: SEED.points.xoiB, item_id: SEED.products.xoiGa }))).toEqual({ status: 'rejected', reason: 'point_not_allowed' });
    expect(await push(tab, mark({ item_id: SEED.products.comGa }))).toEqual({ status: 'rejected', reason: 'bad_item' });
    expect(await push(tab, markRaw({ item_kind: 'combo', item_id: SEED.combos.xoiGaTrung }))).toEqual({ status: 'rejected', reason: 'bad_item_kind' });
    expect(await push(tab, markRaw({ item_id: SEED.products.xoiGa, sold_out: 'yes' }))).toEqual({ status: 'rejected', reason: 'bad_sold_out' });
    expect(await sim.closeShift(190, 60, 500_000)).toMatchObject({ status: 'ok' });
    expect(await push(tab, mark({ item_id: SEED.products.xoiGa }))).toEqual({ status: 'rejected', reason: 'shift_not_open' });
    expect(await sql(`select 1 from sold_out`)).toHaveLength(0);
  });

  it('quyền: tablet không đọc thẳng bảng, chỉ thấy điểm bán của quầy mình; chủ thấy mọi điểm', async () => {
    await push(tab, mark({ item_id: SEED.products.xoiGa }));
    const { data } = await tab.from('sold_out').select('*');
    expect(data).toEqual([]);
    const tabB = await tabletClient(SEED.tablets.B);
    const [{ point_ids }] = await sql(`select point_ids from tablet_profiles where id = $1`, [SEED.tablets.B]);
    expect(await today(tabB)).toEqual(point_ids.includes(SEED.points.xoiA) ? [`${SEED.points.xoiA}:product:${SEED.products.xoiGa}`] : []);
    const owner = await ownerClient();
    expect(await today(owner)).toHaveLength(1);
    expect((await owner.from('sold_out').select('item_id')).data).toEqual([{ item_id: SEED.products.xoiGa }]);
    // Ghi thẳng bảng bị chặn.
    const ins = await tab.from('sold_out').insert({ point_id: SEED.points.xoiA, item_kind: 'product', item_id: SEED.products.xoiXeo, day: '2026-01-01' });
    expect(ins.error).not.toBeNull();
  });
});
