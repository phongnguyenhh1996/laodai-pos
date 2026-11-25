// Khoản chi giữa ca (SPEC 4.9, 5, 6, 10; ADR 0006): bảng `shift_expenses`, sync_push `create_expense` / `void_expense`,
// RPC chủ, ghi chú gần đây, đối soát.
import type { SupabaseClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim, op, push } from '../support/ops';
import { SEED } from '../support/seed-ids';

let tabA: SupabaseClient;
let tabB: SupabaseClient;
let simA: TabletSim;
let simB: TabletSim;
let owner: SupabaseClient;

const rec = async (shift: string) => {
  const { data, error } = await owner.rpc('reconcile_shift', { p_shift: shift });
  if (error) throw error;
  return data as { cash: { expected: number; counted: number | null; diff: number | null }; expenses: { count: number; total: number } };
};
const notices = (kind: string) => sql(`select payload from notifications where kind = $1 order by created_at, id`, [kind]);
const audits = (action: string) => sql(`select actor_kind, shift_id, staff_id, before, after from audit_log where action = $1 order by at, id`, [action]);
const expenseRow = async (id: string) => (await sql('select * from shift_expenses where id = $1', [id]))[0];

beforeEach(async () => {
  await resetDb();
  owner = await ownerClient();
  tabA = await tabletClient(SEED.tablets.A);
  tabB = await tabletClient(SEED.tablets.B);
  simA = new TabletSim(tabA, SEED.tablets.A);
  simB = new TabletSim(tabB, SEED.tablets.B);
  await simA.openShift('Lan');
  await simB.openShift('Mai');
});

describe('dữ liệu', () => {
  it('constraint: số tiền > 0, bội 1.000; ghi chú 1–80 ký tự (không toàn khoảng trắng); không hard delete', async () => {
    const ins = (amount: number, note: string) =>
      sql(`insert into shift_expenses (id, shift_id, amount, note, actor_kind) values (gen_random_uuid(), $1, $2, $3, 'owner')`, [simA.shiftId, amount, note]);
    for (const [a, n] of [[0, 'x'], [7500, 'x'], [-1000, 'x'], [1000, ''], [1000, '   '], [1000, 'x'.repeat(81)]] as const) {
      await expect(ins(a, n), `${a} "${n}"`).rejects.toThrow(/check constraint/);
    }
    // Nhân viên ghi ⇒ phải có staff_id; hủy ⇒ phải có void_actor_kind.
    await expect(sql(`insert into shift_expenses (id, shift_id, amount, note, actor_kind) values (gen_random_uuid(), $1, 1000, 'x', 'staff')`, [simA.shiftId]))
      .rejects.toThrow(/check constraint/);
    const r = await simA.createExpense(20000, 'mua đá');
    expect(r.status).toBe('ok');
    await expect(sql(`update shift_expenses set voided_at = now()`)).rejects.toThrow(/check constraint/);
    await expect(sql('delete from shift_expenses')).rejects.toThrow(/xóa cứng/);
  });
});

describe('nhân viên ghi / hủy qua sync_push', () => {
  it('ghi: lưu ghi chú đã làm sạch, nhân viên của ca, trả khoản vừa ghi; nhật ký + Telegram ngay', async () => {
    const id = uuidv7();
    const r = await simA.createExpense(20000, '  Mua   đá ', id);
    expect(r).toMatchObject({ status: 'ok', expense: { id, amount: 20000, note: 'Mua đá', actor_kind: 'staff', voided_at: null } });
    expect(await expenseRow(id)).toMatchObject({ shift_id: simA.shiftId, amount: 20000, note: 'Mua đá', actor_kind: 'staff', staff_id: SEED.staff.Lan });

    const [a] = await audits('expense_create');
    expect(a).toMatchObject({ actor_kind: 'staff', shift_id: simA.shiftId, staff_id: SEED.staff.Lan, before: null, after: { amount: 20000, note: 'Mua đá' } });
    const [n] = await notices('expense_created');
    expect(n.payload).toMatchObject({ staff_name: 'Lan', actor: 'staff', expense: { id, amount: 20000, note: 'Mua đá' }, before: null, recalculated: null });
    expect(n.payload.tablet_name).toBeTruthy();
  });

  it('idempotent theo op_id: gửi lại ⇒ duplicate, không ghi thêm; cùng id khác op ⇒ expense_exists', async () => {
    const id = uuidv7();
    const o = op('create_expense', id, { id, shift_id: simA.shiftId, amount: 20000, note: 'mua đá' });
    expect(await push(tabA, o)).toMatchObject({ status: 'ok' });
    expect(await push(tabA, o)).toMatchObject({ status: 'duplicate', expense: { id } });
    expect(await simA.createExpense(20000, 'mua đá', id)).toEqual({ status: 'rejected', reason: 'expense_exists' });
    expect(await sql('select id from shift_expenses')).toHaveLength(1);
    expect(await notices('expense_created')).toHaveLength(1);
  });

  it('số tiền / ghi chú sai ⇒ từ chối, không lưu', async () => {
    for (const bad of [0, 7500, -1000, null, 'abc', '1e3']) {
      expect(await simA.createExpense(bad, 'mua đá'), String(bad)).toEqual({ status: 'rejected', reason: 'bad_expense_amount' });
    }
    for (const bad of [null, '', '   ', 'x'.repeat(81)]) {
      expect(await simA.createExpense(20000, bad), String(bad)).toEqual({ status: 'rejected', reason: 'bad_expense_note' });
    }
    expect(await sql('select id from shift_expenses')).toEqual([]);
  });

  it('ca của quầy khác / ca đã đóng ⇒ từ chối', async () => {
    expect((await simA.createExpense(20000, 'mua đá', uuidv7(), simB.shiftId)).status).toBe('rejected');
    const closedShift = simA.shiftId!;
    expect(await simA.closeShift(0, 0, 0)).toMatchObject({ status: 'ok' });
    expect(await simA.createExpense(20000, 'mua đá', uuidv7(), closedShift)).toEqual({ status: 'rejected', reason: 'shift_not_open' });
    expect(await sql('select id from shift_expenses')).toEqual([]);
  });

  it('hủy: chỉ khoản nhân viên ghi, ca đang mở, quầy mình; hủy lại ⇒ không đổi; Telegram + nhật ký', async () => {
    const id = uuidv7();
    await simA.createExpense(20000, 'mua đá', id);
    expect(await simB.voidExpense(id)).toEqual({ status: 'rejected', reason: 'expense_not_voidable' });
    expect(await simA.voidExpense(uuidv7())).toEqual({ status: 'rejected', reason: 'expense_not_voidable' });

    expect(await simA.voidExpense(id)).toMatchObject({ status: 'ok', expense: { id, voided_at: expect.any(String) } });
    const row = await expenseRow(id);
    expect(row.void_actor_kind).toBe('staff');
    expect(await simA.voidExpense(id)).toMatchObject({ status: 'ok' });
    expect((await expenseRow(id)).voided_at).toEqual(row.voided_at);
    expect(await audits('expense_void')).toHaveLength(1);
    const [n] = await notices('expense_voided');
    expect(n.payload).toMatchObject({ actor: 'staff', staff_name: 'Lan', expense: { amount: 20000, note: 'mua đá' } });

    // Khoản chủ ghi: nhân viên không hủy được.
    const { data: ownerId } = await owner.rpc('owner_create_expense', { p_shift: simA.shiftId, p_amount: 10000, p_note: 'mua chanh' });
    expect(await simA.voidExpense(ownerId as string)).toEqual({ status: 'rejected', reason: 'expense_not_voidable' });
  });

  it('hủy khoản của ca đã đóng ⇒ từ chối', async () => {
    const id = uuidv7();
    await simA.createExpense(20000, 'mua đá', id);
    await simA.closeShift(0, 0, 0);
    await simA.openShift('Lan');
    expect(await simA.voidExpense(id)).toEqual({ status: 'rejected', reason: 'expense_not_voidable' });
    expect((await expenseRow(id)).voided_at).toBeNull();
  });
});

describe('RLS tablet', () => {
  it('chỉ đọc khoản chi của ca đang mở của quầy mình (cả khoản chủ ghi); không ghi / sửa / xóa thẳng', async () => {
    const mine = uuidv7();
    await simA.createExpense(20000, 'mua đá', mine);
    await owner.rpc('owner_create_expense', { p_shift: simA.shiftId, p_amount: 10000, p_note: 'mua chanh' });
    await simB.createExpense(30000, 'mua ga');

    const { data } = await tabA.from('shift_expenses').select('amount,note,actor_kind').order('amount');
    expect(data).toEqual([
      { amount: 10000, note: 'mua chanh', actor_kind: 'owner' },
      { amount: 20000, note: 'mua đá', actor_kind: 'staff' },
    ]);

    const ins = await tabA.from('shift_expenses').insert({ id: uuidv7(), shift_id: simA.shiftId, amount: 1000, note: 'x', actor_kind: 'owner' }).select();
    expect(ins.error).not.toBeNull();
    const upd = await tabA.from('shift_expenses').update({ amount: 1000 }).eq('id', mine).select();
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true);
    const del = await tabA.from('shift_expenses').delete().eq('id', mine).select();
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);
    expect((await expenseRow(mine)).amount).toBe(20000);

    // Ca đóng ⇒ tablet không đọc được nữa; chủ vẫn đọc.
    await simA.closeShift(0, 0, 0);
    expect((await tabA.from('shift_expenses').select('id')).data).toEqual([]);
    expect((await owner.from('shift_expenses').select('id')).data).toHaveLength(3);
  });

  it('tablet không gọi được RPC chủ', async () => {
    const id = uuidv7();
    await simA.createExpense(20000, 'mua đá', id);
    for (const [fn, args] of [
      ['owner_create_expense', { p_shift: simA.shiftId, p_amount: 1000, p_note: 'x' }],
      ['owner_edit_expense', { p_id: id, p_amount: 1000, p_note: 'x' }],
      ['owner_void_expense', { p_id: id }],
      ['owner_expense_report', { p_from: '2026-01-01', p_to: '2026-12-31' }],
    ] as const) {
      const { error } = await tabA.rpc(fn, args);
      expect(error, fn).not.toBeNull();
    }
    expect((await expenseRow(id)).amount).toBe(20000);
  });
});

describe('ghi chú gần đây', () => {
  it('gộp "Mua đá" / " mua  đá "; xếp theo số lần; mọi quầy; bỏ khoản đã hủy và quá 30 ngày; chỉ trả chữ, tối đa 8', async () => {
    await simA.createExpense(20000, 'Mua đá');
    await simB.createExpense(10000, ' mua  đá ');
    await simA.createExpense(5000, 'mua đá');
    await simA.createExpense(30000, 'mua ga');
    await simB.createExpense(30000, 'mua ga');
    const v = uuidv7();
    await simA.createExpense(9000, 'ghi nhầm', v);
    await simA.voidExpense(v);
    const old = uuidv7();
    await simA.createExpense(9000, 'chuyện cũ', old);
    await sql(`update shift_expenses set at = now() - interval '31 days' where id = $1`, [old]);
    for (let i = 1; i <= 8; i++) await simA.createExpense(1000, `món ${i}`);

    const { data, error } = await tabA.rpc('recent_expense_notes');
    expect(error).toBeNull();
    const notes = data as string[];
    expect(notes).toHaveLength(8);
    expect(notes.slice(0, 2)).toEqual(['mua đá', 'mua ga']); // bản viết gần nhất của nhóm
    expect(notes.every((x) => typeof x === 'string')).toBe(true);
    expect(notes).not.toContain('ghi nhầm');
    expect(notes).not.toContain('chuyện cũ');
    expect(JSON.stringify(data)).not.toMatch(/20000|30000/);
    expect((await owner.rpc('recent_expense_notes')).data).toEqual(notes);
  });
});

describe('đối soát', () => {
  it('kỳ vọng tiền mặt trừ khoản chưa hủy; đóng ca ⇒ RPC vẫn chỉ trả ok; Telegram đóng ca có khối expenses', async () => {
    const before = await rec(simA.shiftId!);
    expect(before.expenses).toEqual({ count: 0, total: 0 });
    await simA.createExpense(20000, 'mua đá');
    const v = uuidv7();
    await simA.createExpense(50000, 'ghi nhầm', v);
    await simA.voidExpense(v);
    await owner.rpc('owner_create_expense', { p_shift: simA.shiftId, p_amount: 10000, p_note: 'mua chanh' });
    const after = await rec(simA.shiftId!);
    expect(after.expenses).toEqual({ count: 2, total: 30000 });
    expect(after.cash.expected).toBe(before.cash.expected - 30000);

    const shift = simA.shiftId!;
    const r = await simA.closeShift(0, 0, after.cash.expected);
    expect(r).toEqual({ status: 'ok' });
    const [n] = await notices('shift_close');
    expect(n.payload.reconcile).toMatchObject({ expenses: { count: 2, total: 30000 }, cash: { diff: 0 } });
    expect((await rec(shift)).cash.diff).toBe(0);
  });
});

describe('chủ ghi / sửa / hủy', () => {
  it('ca đang mở: ghi ⇒ actor owner, không staff_id; không đánh dấu tính lại', async () => {
    const { data: id, error } = await owner.rpc('owner_create_expense', { p_shift: simA.shiftId, p_amount: 10000, p_note: ' mua  chanh ' });
    expect(error).toBeNull();
    expect(await expenseRow(id as string)).toMatchObject({ actor_kind: 'owner', staff_id: null, note: 'mua chanh', amount: 10000 });
    expect((await sql('select recalculated_at from shifts where id = $1', [simA.shiftId]))[0].recalculated_at).toBeNull();
    const [n] = await notices('expense_created');
    expect(n.payload).toMatchObject({ actor: 'owner', recalculated: null });
    expect(await audits('expense_create')).toMatchObject([{ actor_kind: 'owner', shift_id: simA.shiftId }]);
  });

  it('số tiền / ghi chú sai ⇒ lỗi tiếng Việt, không lưu', async () => {
    for (const [a, n] of [[0, 'x'], [7500, 'x'], [1000, '  ']] as const) {
      const { error } = await owner.rpc('owner_create_expense', { p_shift: simA.shiftId, p_amount: a, p_note: n });
      expect(error?.message).toMatch(/Số tiền|ghi chú/);
    }
    expect(await sql('select id from shift_expenses')).toEqual([]);
  });

  it('ca đã đóng: sửa khoản ⇒ kỳ vọng đổi + recalculated_at; nhật ký trước/sau; Telegram có trước → sau + đối soát', async () => {
    const id = uuidv7();
    await simA.createExpense(20000, 'mua đá', id);
    const shift = simA.shiftId!;
    const r0 = await rec(shift);
    await simA.closeShift(0, 0, r0.cash.expected);
    expect((await rec(shift)).cash.diff).toBe(0);

    const { error } = await owner.rpc('owner_edit_expense', { p_id: id, p_amount: 25000, p_note: 'mua đá cây' });
    expect(error).toBeNull();
    const r1 = await rec(shift);
    expect(r1.cash.expected).toBe(r0.cash.expected - 5000);
    expect(r1.cash.diff).toBe(5000);
    expect((await sql('select recalculated_at from shifts where id = $1', [shift]))[0].recalculated_at).not.toBeNull();

    const [a] = await audits('expense_edit');
    expect(a).toMatchObject({ actor_kind: 'owner', before: { amount: 20000, note: 'mua đá' }, after: { amount: 25000, note: 'mua đá cây' } });
    const [n] = await notices('expense_edited');
    expect(n.payload).toMatchObject({
      actor: 'owner', before: { amount: 20000, note: 'mua đá' }, expense: { amount: 25000, note: 'mua đá cây' },
      recalculated: { before: { cash: { diff: 0 } }, after: { cash: { diff: 5000 } } },
    });

    // Không đổi gì ⇒ không ghi thêm.
    await owner.rpc('owner_edit_expense', { p_id: id, p_amount: 25000, p_note: 'mua đá cây' });
    expect(await audits('expense_edit')).toHaveLength(1);
  });

  it('ca đã đóng: chủ ghi thêm / hủy khoản nhân viên ghi ⇒ tính lại; hủy rồi không sửa được', async () => {
    const id = uuidv7();
    await simA.createExpense(20000, 'mua đá', id);
    const shift = simA.shiftId!;
    const r0 = await rec(shift);
    await simA.closeShift(0, 0, r0.cash.expected);

    await owner.rpc('owner_create_expense', { p_shift: shift, p_amount: 10000, p_note: 'mua chanh' });
    expect((await rec(shift)).cash.diff).toBe(10000);
    const { error } = await owner.rpc('owner_void_expense', { p_id: id });
    expect(error).toBeNull();
    expect(await expenseRow(id)).toMatchObject({ void_actor_kind: 'owner' });
    expect((await rec(shift)).cash.diff).toBe(10000 - 20000);
    expect(await notices('expense_voided')).toMatchObject([{ payload: { actor: 'owner', recalculated: { after: { cash: { diff: -10000 } } } } }]);
    // Hủy lại ⇒ không đổi.
    await owner.rpc('owner_void_expense', { p_id: id });
    expect(await audits('expense_void')).toHaveLength(1);
    const { error: e2 } = await owner.rpc('owner_edit_expense', { p_id: id, p_amount: 1000, p_note: 'x' });
    expect(e2?.message).toMatch(/đã hủy/);
  });

  it('báo cáo theo kỳ: tổng chi + cộng theo nhóm ghi chú; bỏ khoản đã hủy', async () => {
    await simA.createExpense(20000, 'Mua đá');
    await simB.createExpense(10000, 'mua đá');
    await simA.createExpense(30000, 'mua ga');
    const v = uuidv7();
    await simA.createExpense(90000, 'ghi nhầm', v);
    await simA.voidExpense(v);
    const today = (await sql(`select private.business_date(now())::text d`))[0].d as string;
    const { data, error } = await owner.rpc('owner_expense_report', { p_from: today, p_to: today });
    expect(error).toBeNull();
    expect(data).toEqual({
      count: 3, total: 60000,
      by_note: [
        { note: 'mua đá', count: 2, total: 30000 },
        { note: 'mua ga', count: 1, total: 30000 },
      ],
    });
    const { data: none } = await owner.rpc('owner_expense_report', { p_from: '2020-01-01', p_to: '2020-01-02' });
    expect(none).toEqual({ count: 0, total: 0, by_note: [] });
  });

  it('tổng kết ngày có tổng chi', async () => {
    await simA.createExpense(20000, 'mua đá');
    await owner.rpc('run_daily_summary', {});
    const [n] = await notices('daily_summary');
    expect(n.payload.expenses).toMatchObject({ count: 1, total: 20000 });
  });
});
