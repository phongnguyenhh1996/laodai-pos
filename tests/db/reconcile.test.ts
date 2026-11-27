import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../fixtures/reconcile-cases.json';
import { ownerClient, resetDb, sql, withPg } from '../support/db';
import type { ReconcileResult } from '../../supabase/functions/_shared/reconcile';
import { SEED } from '../support/seed-ids';

// `private.reconcile_shift` là implementation duy nhất của công thức đối soát (ADR 0006); bộ dữ liệu ghim kết quả.

const SHIFT_IDS = ['00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2'];
type Case = (typeof fixture.cases)[number];

async function loadCase(c: Case) {
  await resetDb();
  await withPg(async (db) => {
    for (const p of fixture.products) {
      await db.query(
        `insert into products (id, menu_id, name, price, boxes_takeaway, boxes_dinein, plates_dinein, cans) values ($1,$2,$3,0,$4,$5,$6,$7)`,
        [p.id, SEED.menus.xoi, p.name, p.boxes_takeaway, p.boxes_dinein, p.plates_dinein, p.cans],
      );
    }
    const s: Case['input']['shift'] & { open_cans?: number; close_cans_left?: number | null; count_items?: string[]; closed?: boolean } = c.input.shift;
    const open = s.closed === undefined ? s.close_cash_counted === null : !s.closed;
    for (const id of SHIFT_IDS) {
      const main = id === s.id;
      await db.query(
        `insert into shifts (id, tablet_profile_id, staff_id, opened_at, open_boxes, open_plates, open_cans, open_float,
                             close_boxes_left, close_plates_left, close_cans_left, close_cash_counted, status, closed_at, count_items)
         values ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, main ? SEED.tablets.A : SEED.tablets.B, SEED.staff.Lan,
         main ? s.open_boxes : 0, main ? s.open_plates : 0, main ? (s.open_cans ?? 0) : 0, main ? s.open_float : 0,
         main ? s.close_boxes_left : 0, main ? s.close_plates_left : 0, main ? (s.close_cans_left ?? null) : null, main ? s.close_cash_counted : 0,
         main && open ? 'open' : 'closed', main && open ? null : new Date(), main ? (s.count_items ?? ['cash', 'boxes', 'plates']) : ['cash', 'boxes', 'plates']],
      );
    }
    for (const a of c.input.adjustments) {
      await db.query('insert into shift_adjustments (shift_id, kind, qty) values ($1,$2,$3)', [a.shift_id, a.kind, a.qty]);
    }
    let seq = 0;
    for (const o of c.input.orders) {
      await db.query(
        `insert into orders (id, device_seq, tablet_profile_id, point_id, code, dine_type, address, status, opened_shift_id, paid_shift_id,
                             created_at, served_at, paid_at, deleted_at, ship_fee, ship_mode, ship_payout, total, payment_method, customer_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [o.id, ++seq, SEED.tablets.A, SEED.points.xoiA, o.code, o.dine_type, o.dine_type === 'delivery' ? '12 Lê Lợi' : null,
         o.status, o.opened_shift_id, o.paid_shift_id,
         o.served_at, o.status === 'paid' ? new Date() : null, o.deleted_at, 'ship_fee' in o ? o.ship_fee : 0,
         'ship_mode' in o ? o.ship_mode : 'shop', 'ship_payout' in o ? o.ship_payout : 0, o.total, o.payment_method,
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
    const expenses: Array<{ id: string; shift_id: string; amount: number; note: string; actor_kind: string; voided_at: string | null }> =
      ('expenses' in c.input ? c.input.expenses : undefined) ?? [];
    for (const e of expenses) {
      await db.query(
        `insert into shift_expenses (id, shift_id, amount, note, actor_kind, staff_id, voided_at, void_actor_kind) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.id, e.shift_id, e.amount, e.note, e.actor_kind, e.actor_kind === 'staff' ? SEED.staff.Lan : null, e.voided_at, e.voided_at ? e.actor_kind : null],
      );
    }
  });
}

describe('reconcile_shift (bộ dữ liệu)', () => {
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

const caseNamed = (name: string) => fixture.cases.find((c) => c.name === name)!;

/** Nạp một ca của bộ dữ liệu rồi đối soát; `tweak` sửa dữ liệu trước khi gọi. */
async function reconcileCase(name: string, tweak?: string): Promise<ReconcileResult> {
  const c = caseNamed(name);
  await loadCase(c);
  if (tweak) await sql(tweak);
  const { data, error } = await (await ownerClient()).rpc('reconcile_shift', { p_shift: c.input.shift.id });
  expect(error).toBeNull();
  return data as ReconcileResult;
}

describe('reconcile_shift: quy tắc', () => {
  const r: Record<string, ReconcileResult> = {};
  beforeAll(async () => {
    for (const name of ['co-ban', 'chu-sua-truoc', 'chu-sua-sau-tm-thanh-ck', 'dem-thieu-tien', 'dung-hop-khong-don', 'khoan-chi']) {
      r[name] = await reconcileCase(name);
    }
  });

  it('tiền mặt kỳ vọng = tiền lẻ + chủ bổ sung + đơn TM theo ca thu + TM thu nợ', () => {
    expect(r['co-ban'].cash.expected).toBe(500_000 + 200_000 + (30_000 + 35_000 + 45_000) + 50_000);
  });

  it('không tính CK, nợ, đơn đã xóa, đơn mở ở ca này nhưng thu ở ca khác', () => {
    const c = r['co-ban'];
    expect(c.revenue.cash).toBe(110_000); // không có 40.000 của đơn thu ở ca b2
    expect(c.revenue.transfer).toBe(25_000);
    expect(c.revenue.debt).toBe(20_000);
    expect(c.debt_collected).toEqual({ cash: 50_000, transfer: 30_000 });
  });

  it('hộp & dĩa theo ca mở đơn, bỏ qua đơn xóa', () => {
    expect(r['co-ban'].boxes.by_orders).toBe(12);
    expect(r['co-ban'].plates.by_orders).toBe(2);
  });

  it('"bao bì của đơn bị xóa sau khi ra món" chỉ gồm đơn có served_at trước lúc xóa', () => {
    expect(r['co-ban'].deleted_count).toBe(2);
    expect(r['co-ban'].deleted_after_served.map((d) => d.code)).toEqual(['A24']);
  });

  it('chủ đổi tiền mặt → chuyển khoản: đối soát tính lại thay đổi đúng', () => {
    const before = r['chu-sua-truoc'];
    const after = r['chu-sua-sau-tm-thanh-ck'];
    expect(before.cash.diff).toBe(0);
    expect(after.cash.expected).toBe(before.cash.expected - 15_000);
    expect(after.cash.diff).toBe(15_000);
    expect(after.revenue.total).toBe(before.revenue.total);
  });

  it('đếm thiếu tiền: chênh lệch âm đúng số thiếu; thu nợ ở ca khác và đơn mở ở ca trước (thu ở ca này) tính đúng ca', () => {
    const d = r['dem-thieu-tien'];
    expect(d.cash).toEqual({ expected: 500_000 + 100_000 + 31_000 + 28_000 + 50_000, counted: 689_000, diff: -20_000 });
    expect(d.boxes.by_orders).toBe(2); // đơn mở ở ca trước không tính hộp cho ca này
  });

  it('dùng hộp không có đơn: thực dùng (đầu ca + bổ sung − còn lại) lớn hơn theo đơn ⇒ chênh lệch dương', () => {
    const d = r['dung-hop-khong-don'];
    // 200 + 50 − 230 = 20 hộp; theo đơn: xôi 2 + cơm mang về (1 + 2 topping thêm hộp) + cơm tại chỗ 0 + đơn mở 1 = 6
    expect(d.boxes).toEqual({ used: 20, by_orders: 6, diff: 14 });
    expect(d.plates).toEqual({ used: 1, by_orders: 1, diff: 0 });
    expect(d.deleted_after_served).toEqual([{ order_id: expect.any(String), code: 'F24', boxes: 3, plates: 0, cans: 0 }]);
  });

  it('khoản chi: kỳ vọng trừ khoản chưa hủy của ca này (cả khoản chủ ghi); doanh thu không đổi', () => {
    const k = r['khoan-chi'];
    const base = r['chu-sua-truoc'];
    expect(k.expenses).toEqual({ count: 3, total: 20_000 + 30_000 + 10_000 });
    expect(k.cash.expected).toBe(base.cash.expected - 60_000);
    expect(k.revenue).toEqual(base.revenue);
    expect(base.expenses).toEqual({ count: 0, total: 0 });
  });

  it('đơn xóa có served_at sau deleted_at (dữ liệu lạ) không tính là "xóa sau khi ra món"', async () => {
    const res = await reconcileCase('co-ban', `update orders set served_at = '2026-11-17T23:30:00Z' where code = 'A24'`);
    expect(res.deleted_after_served).toEqual([]);
  });
});

describe('bao bì một đơn (private.order_packaging)', () => {
  const [XOI, COM, LON] = fixture.products.map((p) => p.id); // xôi: 1 hộp mọi kiểu; cơm: mang về 1 hộp, tại chỗ 1 dĩa; lon: 1 lon
  const { canh: CANH, dua: DUA, trung: TRUNG } = fixture.toppings; // canh, dưa có cờ thêm hộp; trứng không
  const SHIFT = '00000000-0000-4000-8000-0000000000b1';
  let n = 0;

  beforeAll(async () => {
    await loadCase(caseNamed('chu-sua-truoc'));
  });

  type Line = [product: string, qty: number, toppings: Array<typeof CANH>];
  async function pack(dine: 'dinein' | 'takeaway' | 'delivery', lines: Line[]) {
    const id = `00000000-0000-4000-8000-${String(990000000000 + ++n)}`;
    await sql(
      `insert into orders (id, device_seq, tablet_profile_id, point_id, code, dine_type, address, status, opened_shift_id, created_at, total)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8, now(), 0)`,
      [id, 9000 + n, SEED.tablets.A, SEED.points.xoiA, `P${10 + n}`, dine, dine === 'delivery' ? '12 Lê Lợi' : null, SHIFT],
    );
    for (const [i, [product, qty, tops]] of lines.entries()) {
      await sql(
        `insert into order_items (id, order_id, product_id, name_snap, unit_price_snap, qty, toppings_snap, sort)
         values (gen_random_uuid(), $1, $2, 'x', 0, $3, $4, $5)`,
        [id, product, qty, JSON.stringify(tops), i],
      );
    }
    const [row] = await sql<{ p: { boxes: number; plates: number; cans: number } }>('select private.order_packaging($1) as p', [id]);
    return row.p;
  }

  it('xôi mang về và tại chỗ: mỗi phần 1 hộp, không dĩa (topping không cờ không thêm hộp)', async () => {
    expect(await pack('takeaway', [[XOI, 1, [TRUNG]]])).toEqual({ boxes: 1, plates: 0, cans: 0 });
    expect(await pack('dinein', [[XOI, 1, [TRUNG]]])).toEqual({ boxes: 1, plates: 0, cans: 0 });
  });

  it('cơm mang về: 1 hộp + 1 hộp mỗi topping có cờ (2 topping có cờ + 1 không cờ ⇒ 3 hộp)', async () => {
    expect(await pack('takeaway', [[COM, 1, []]])).toEqual({ boxes: 1, plates: 0, cans: 0 });
    expect(await pack('takeaway', [[COM, 1, [CANH, DUA, TRUNG]]])).toEqual({ boxes: 3, plates: 0, cans: 0 });
  });

  it('đơn ship tính bao bì như mang về', async () => {
    expect(await pack('delivery', [[COM, 2, [CANH, TRUNG]]])).toEqual({ boxes: 4, plates: 0, cans: 0 });
  });

  it('cơm tại chỗ: 1 dĩa, 0 hộp, kể cả khi có topping gắn cờ', async () => {
    expect(await pack('dinein', [[COM, 1, [CANH, DUA]]])).toEqual({ boxes: 0, plates: 1, cans: 0 });
  });

  it('số lượng > 1 được nhân đúng; cộng cả đơn', async () => {
    expect(await pack('takeaway', [[COM, 3, [CANH, DUA]]])).toEqual({ boxes: 9, plates: 0, cans: 0 });
    expect(await pack('dinein', [[COM, 4, [CANH]], [XOI, 5, []]])).toEqual({ boxes: 5, plates: 4, cans: 0 });
  });

  it('nước lon: qty × số lon mỗi phần, như nhau cho tại chỗ / mang về / ship', async () => {
    for (const dine of ['dinein', 'takeaway', 'delivery'] as const) {
      expect(await pack(dine, [[LON, 3, []]])).toEqual({ boxes: 0, plates: 0, cans: 3 });
    }
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
