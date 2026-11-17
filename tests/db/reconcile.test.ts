import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../fixtures/reconcile-cases.json';
import { ownerClient, resetDb, sql, withPg } from '../support/db';
import { SEED } from '../support/seed-ids';

// Hàm đối soát SQL phải cho CÙNG kết quả với src/domain/reconcile.ts trên cùng bộ dữ liệu.

const SHIFT_IDS = ['00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2'];
type Case = (typeof fixture.cases)[number];

async function loadCase(c: Case) {
  await resetDb();
  await withPg(async (db) => {
    for (const p of fixture.products) {
      await db.query(
        `insert into products (id, menu_id, name, price, boxes_takeaway, boxes_dinein, plates_dinein) values ($1,$2,$3,0,$4,$5,$6)`,
        [p.id, SEED.menus.xoi, p.name, p.boxes_takeaway, p.boxes_dinein, p.plates_dinein],
      );
    }
    const s = c.input.shift;
    for (const id of SHIFT_IDS) {
      const main = id === s.id;
      await db.query(
        `insert into shifts (id, tablet_profile_id, staff_id, opened_at, open_boxes, open_plates, open_float,
                             close_boxes_left, close_plates_left, close_cash_counted, status, closed_at)
         values ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, main ? SEED.tablets.A : SEED.tablets.B, SEED.staff.Lan,
         main ? s.open_boxes : 0, main ? s.open_plates : 0, main ? s.open_float : 0,
         main ? s.close_boxes_left : 0, main ? s.close_plates_left : 0, main ? s.close_cash_counted : 0,
         main && s.close_cash_counted === null ? 'open' : 'closed', main && s.close_cash_counted === null ? null : new Date()],
      );
    }
    for (const a of c.input.adjustments) {
      await db.query('insert into shift_adjustments (shift_id, kind, qty) values ($1,$2,$3)', [a.shift_id, a.kind, a.qty]);
    }
    let seq = 0;
    for (const o of c.input.orders) {
      await db.query(
        `insert into orders (id, device_seq, tablet_profile_id, point_id, code, dine_type, status, opened_shift_id, paid_shift_id,
                             created_at, served_at, paid_at, deleted_at, total, payment_method, customer_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11,$12,$13,$14,$15)`,
        [o.id, ++seq, SEED.tablets.A, SEED.points.xoiA, o.code, o.dine_type, o.status, o.opened_shift_id, o.paid_shift_id,
         o.served_at, o.status === 'paid' ? new Date() : null, o.deleted_at, o.total, o.payment_method,
         o.payment_method === 'debt' ? SEED.customers.dungGv : null],
      );
      for (const [i, it] of o.items.entries()) {
        await db.query(
          `insert into order_items (id, order_id, product_id, name_snap, unit_price_snap, qty, toppings_snap, sort)
           values (gen_random_uuid(),$1,$2,'x',0,$3,$4,$5)`,
          [o.id, it.product_id, it.qty, JSON.stringify(it.toppings_snap), i],
        );
      }
    }
    for (const p of c.input.debt_payments) {
      await db.query('insert into debt_payments (id, customer_id, amount, method, shift_id, at) values (gen_random_uuid(),$1,$2,$3,$4,now())',
        [SEED.customers.dungGv, p.amount, p.method, p.shift_id]);
    }
  });
}

describe('reconcile_shift SQL = domain/reconcile', () => {
  let owner: SupabaseClient;
  beforeAll(async () => {
    owner = await ownerClient().catch(async () => {
      await resetDb();
      return ownerClient();
    });
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    await loadCase(c);
    owner = await ownerClient();
    const { data, error } = await owner.rpc('reconcile_shift', { p_shift: c.input.shift.id });
    expect(error).toBeNull();
    expect(data).toEqual(c.expected);
  });
});

describe('chủ sửa đơn của ca đã đóng', () => {
  it('cập nhật recalculated_at và đối soát thay đổi đúng', async () => {
    const before = fixture.cases.find((c) => c.name === 'chu-sua-truoc')!;
    const after = fixture.cases.find((c) => c.name === 'chu-sua-sau-tm-thanh-ck')!;
    await loadCase(before);
    const owner = await ownerClient();
    const shift = before.input.shift.id;
    expect((await sql('select recalculated_at from shifts where id = $1', [shift]))[0].recalculated_at).toBeNull();
    const { error } = await owner.rpc('owner_edit_order', { p_order: '00000000-0000-4000-8000-000000000202', p_payment_method: 'transfer' });
    expect(error).toBeNull();
    expect((await sql('select recalculated_at from shifts where id = $1', [shift]))[0].recalculated_at).not.toBeNull();
    expect((await owner.rpc('reconcile_shift', { p_shift: shift })).data).toEqual(after.expected);
    const [n] = await sql(`select payload from notifications where kind = 'owner_edit'`);
    expect(n.payload.recalculated.before[shift].cash.diff).toBe(0);
    expect(n.payload.recalculated.after[shift].cash.diff).toBe(15000);
  });

  it('chủ bổ sung giữa ca vào ca đã đóng cũng đánh dấu tính lại', async () => {
    await loadCase(fixture.cases.find((c) => c.name === 'chu-sua-truoc')!);
    const owner = await ownerClient();
    const shift = '00000000-0000-4000-8000-0000000000b1';
    const { error } = await owner.rpc('owner_adjust_shift', { p_shift: shift, p_kind: 'cash', p_qty: 200000, p_note: '+200k tiền lẻ' });
    expect(error).toBeNull();
    const rec = (await owner.rpc('reconcile_shift', { p_shift: shift })).data;
    expect(rec.cash.expected).toBe(530000);
    expect((await sql('select recalculated_at from shifts where id = $1', [shift]))[0].recalculated_at).not.toBeNull();
  });
});
