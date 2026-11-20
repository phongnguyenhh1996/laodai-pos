import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim, item } from '../support/ops';
import { SEED } from '../support/seed-ids';

// In phiếu bếp & bill (SPEC mục 12): lệnh in, khóa nhận lệnh, hết hạn, RLS, báo cáo ca.

const DEV_A1 = 'device-a1-0001';
const DEV_A2 = 'device-a2-0002';
const DEV_B = 'device-b-00003';

let tabA: SupabaseClient;
let tabA2: SupabaseClient;
let tabB: SupabaseClient;
let owner: SupabaseClient;
let sim: TabletSim;

beforeEach(async () => {
  await resetDb();
  tabA = await tabletClient(SEED.tablets.A);
  tabA2 = await tabletClient(SEED.tablets.A);
  tabB = await tabletClient(SEED.tablets.B);
  owner = await ownerClient();
  sim = new TabletSim(tabA, SEED.tablets.A);
  await sim.openShift('Lan');
});

async function paidOrder() {
  const o = await sim.createOrder([item('xoiGa', ['trung'], 2)]);
  await sim.pay(o.id, o.total, 'debt', { customer: { id: SEED.customers.dungGv, name: 'Dũng' } });
  // TabletSim gửi giờ thực hiện lùi 1 giờ; tablet thật dùng giờ server.
  await sql('update orders set paid_at = now() where id = $1', [o.id]);
  return o;
}

describe('mẫu in + công tắc', () => {
  it('công tắc mặc định bật; tablet đọc được mẫu; chỉ chủ sửa mẫu, có nhật ký', async () => {
    const { data: prof } = await tabA
      .from('tablet_profiles')
      .select('auto_print_kitchen,auto_reprint_kitchen_on_edit,auto_print_bill');
    expect(prof).toEqual([{ auto_print_kitchen: true, auto_reprint_kitchen_on_edit: true, auto_print_bill: true }]);

    const { data: tpl } = await tabA.from('print_template').select('template');
    expect(tpl?.[0].template).toMatchObject({ code_size: 'large', bill: { no_bill_free: true }, kitchen: { toppings: true } });

    const denied = await tabA.rpc('owner_set_print_template', { p_template: { shop_name: 'X' } });
    expect(denied.error?.message).toMatch(/forbidden/);
    const bad = await owner.rpc('owner_set_print_template', { p_template: { footer: ['a', 'b', 'c', 'd'] } });
    expect(bad.error?.message).toMatch(/3 dòng/);

    const ok = await owner.rpc('owner_set_print_template', { p_template: { shop_name: 'Xôi Lão Đại', code_size: 'xlarge' } });
    expect(ok.error).toBeNull();
    // Thiếu khóa ⇒ lấy mặc định (mẫu luôn đủ trường).
    expect(ok.data).toMatchObject({ shop_name: 'Xôi Lão Đại', code_size: 'xlarge', bill: { thanks: true } });
    expect(await sql(`select action from audit_log where action = 'print_template_update'`)).toHaveLength(1);
  });
});

describe('in tại chỗ', () => {
  it('tablet tạo lệnh phiếu bếp ⇒ nhận luôn, nội dung không có thanh toán / nhân viên; báo kết quả ⇒ nhật ký', async () => {
    const o = await sim.createOrder([item('xoiGa', ['trung'], 2)], { label: 'Áo đỏ' });
    const r = await tabA.rpc('print_job_create', { p_kind: 'kitchen', p_order: o.id, p_device: DEV_A1, p_source: 'auto' });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({
      status: 'claimed',
      job: { kind: 'kitchen', source: 'auto', status: 'claimed', device_id: DEV_A1, order_code: o.result.order!.code },
      doc: { code: o.result.order!.code, label: 'Áo đỏ', point_name: 'Xôi A', items: [{ name: 'Xôi gà', qty: 2, toppings: [{ name: 'Trứng' }] }] },
      template: { code_size: 'large' },
    });
    const doc = JSON.stringify(r.data.doc);
    for (const k of ['payment_method', 'cash_given', 'customer', 'staff']) expect(doc).not.toContain(k);

    const fin = await tabA.rpc('print_job_finish', { p_job: r.data.job.id, p_device: DEV_A1, p_ok: false, p_error: 'Hết giấy' });
    expect(fin.data).toMatchObject({ status: 'failed', error: 'Hết giấy' });
    // Báo lại lần nữa / máy khác báo ⇒ bị từ chối.
    expect((await tabA.rpc('print_job_finish', { p_job: r.data.job.id, p_device: DEV_A1, p_ok: true })).error).not.toBeNull();
    const log = await sql(`select action, reason, tablet_profile_id from audit_log where entity = 'print_job'`);
    expect(log).toEqual([{ action: 'print_failed', reason: 'Hết giấy', tablet_profile_id: SEED.tablets.A }]);
    // Không báo Telegram.
    expect(await sql(`select 1 from notifications where kind like 'print%'`)).toHaveLength(0);
  });

  it('sửa đơn ⇒ phiếu bếp có giờ sửa + phiên bản; đơn đã xóa / quầy khác ⇒ không in', async () => {
    const o = await sim.createOrder([item('xoiGa')]);
    const [it] = await sql<{ id: string }>('select id from order_items where order_id = $1', [o.id]);
    await sim.update(o.id, [{ ...item('xoiGa', [], 2), id: it.id }]);
    const r = await tabA.rpc('print_job_create', {
      p_kind: 'kitchen', p_order: o.id, p_device: DEV_A1, p_source: 'auto',
      p_detail: { edit: { added: [{ name: 'xoiGa', qty: 1 }], removed: [] } },
    });
    expect(r.data.job).toMatchObject({ order_rev: 1, detail: { edit: { added: [{ qty: 1 }] } } });
    expect(r.data.doc.edited_at).toBeTruthy();

    const other = await tabB.rpc('print_job_create', { p_kind: 'kitchen', p_order: o.id, p_device: DEV_B });
    expect(other.error?.message).toMatch(/forbidden/);

    await sim.del(o.id);
    const gone = await tabA.rpc('print_job_create', { p_kind: 'kitchen', p_order: o.id, p_device: DEV_A1 });
    expect(gone.error?.message).toMatch(/xóa/);
  });

  it('bill: tablet chỉ tự in một lần ngay sau thanh toán, không in lại được; tablet không in thử', async () => {
    const o = await paidOrder();
    const first = await tabA.rpc('print_job_create', { p_kind: 'bill', p_order: o.id, p_device: DEV_A1 });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: 'claimed', job: { source: 'auto' }, doc: { status: 'paid', total: o.total } });
    expect(JSON.stringify(first.data.doc)).not.toMatch(/debt|Dũng/);

    const again = await tabA.rpc('print_job_create', { p_kind: 'bill', p_order: o.id, p_device: DEV_A1 });
    expect(again.error?.message).toMatch(/Chỉ chủ/);
    const open = await sim.createOrder([item('xoiGa')]);
    const unpaid = await tabA.rpc('print_job_create', { p_kind: 'bill', p_order: open.id, p_device: DEV_A1 });
    expect(unpaid.error?.message).toMatch(/Chỉ chủ/);
    // Bill thanh toán quá 10 phút ⇒ không tự in được nữa.
    const old = await paidOrder();
    await sql(`update orders set paid_at = now() - interval '11 minutes' where id = $1`, [old.id]);
    expect((await tabA.rpc('print_job_create', { p_kind: 'bill', p_order: old.id, p_device: DEV_A1 })).error?.message).toMatch(/Chỉ chủ/);

    expect((await tabA.rpc('print_job_create', { p_kind: 'test', p_device: DEV_A1 })).error?.message).toMatch(/forbidden/);
    // Thiếu mã thiết bị ⇒ từ chối (tablet không tạo được lệnh pending).
    expect((await tabA.rpc('print_job_create', { p_kind: 'kitchen', p_order: open.id })).error?.message).toMatch(/thiết bị/);
  });
});

describe('in từ xa', () => {
  it('chủ gửi in lại bill tới quầy bán (mặc định); hai máy cùng quầy nhận ⇒ chỉ một máy được', async () => {
    const o = await paidOrder();
    const req = await owner.rpc('print_job_create', { p_kind: 'bill', p_order: o.id });
    expect(req.data).toMatchObject({ status: 'pending', job: { tablet_profile_id: SEED.tablets.A, source: 'owner' } });
    const jobId = req.data.job.id as string;

    // Tablet thấy lệnh của quầy mình, quầy khác không thấy và không nhận được.
    expect((await tabA.from('print_jobs').select('id').eq('status', 'pending')).data).toEqual([{ id: jobId }]);
    expect((await tabB.from('print_jobs').select('id')).data).toEqual([]);
    expect((await tabB.rpc('print_job_claim', { p_job: jobId, p_device: DEV_B })).error?.message).toMatch(/forbidden/);

    const [a, b] = await Promise.all([
      tabA.rpc('print_job_claim', { p_job: jobId, p_device: DEV_A1 }),
      tabA2.rpc('print_job_claim', { p_job: jobId, p_device: DEV_A2 }),
    ]);
    const statuses = [a.data.status, b.data.status].sort();
    expect(statuses).toEqual(['claimed', 'taken']);
    const winner = a.data.status === 'claimed' ? a.data : b.data;
    // Tablet không đọc được đơn đã thanh toán, nhưng nhận được nội dung bill qua lệnh in.
    expect((await tabA.from('orders').select('id').eq('id', o.id)).data).toEqual([]);
    expect(winner.doc).toMatchObject({ code: o.result.order!.code, total: o.total });

    const dev = winner.job.device_id as string;
    await (dev === DEV_A1 ? tabA : tabA2).rpc('print_job_finish', { p_job: jobId, p_device: dev, p_ok: true });
    expect(await sql('select status from print_jobs where id = $1', [jobId])).toEqual([{ status: 'printed' }]);
    expect((await sql(`select action from audit_log where entity = 'print_job' order by at`)).map((r) => r.action)).toEqual([
      'print_request',
      'print_printed',
    ]);
  });

  it('chủ đổi quầy, in thử; không ai nhận sau 2 phút ⇒ hết hạn, không in muộn', async () => {
    const t = await owner.rpc('print_job_create', { p_kind: 'test', p_profile: SEED.tablets.B });
    expect(t.data.job).toMatchObject({ kind: 'test', tablet_profile_id: SEED.tablets.B });
    await sql(`update print_jobs set created_at = now() - interval '121 seconds' where id = $1`, [t.data.job.id]);
    const exp = await tabB.rpc('print_job_claim', { p_job: t.data.job.id, p_device: DEV_B });
    expect(exp.error).toBeNull();
    expect(exp.data).toEqual({ status: 'expired' });
    expect(await sql('select status from print_jobs where id = $1', [t.data.job.id])).toEqual([{ status: 'expired' }]);

    // Dọn định kỳ (pg_cron) cũng đổi sang hết hạn.
    const t2 = await owner.rpc('print_job_create', { p_kind: 'test', p_profile: SEED.tablets.A });
    await sql(`update print_jobs set created_at = now() - interval '3 minutes' where id = $1`, [t2.data.job.id]);
    expect((await sql('select private.expire_print_jobs() n'))[0].n).toBe(1);
    expect(await sql('select status from print_jobs where id = $1', [t2.data.job.id])).toEqual([{ status: 'expired' }]);
    expect((await sql(`select count(*)::int n from audit_log where action = 'print_expired'`))[0].n).toBe(2);

    // Bill của đơn chưa thanh toán: chủ cũng không in được.
    const open = await sim.createOrder([item('xoiGa')]);
    expect((await owner.rpc('print_job_create', { p_kind: 'bill', p_order: open.id })).error?.message).toMatch(/chưa thanh toán/);
    // Không có lệnh xóa cứng.
    await expect(sql('delete from print_jobs')).rejects.toThrow(/xóa cứng/);
  });
});

describe('báo cáo ca', () => {
  it('đếm đơn thanh toán trong ca mà không có bill nào in thành công', async () => {
    const printed = await paidOrder();
    const failed = await paidOrder();
    const none = await paidOrder();
    const p = await tabA.rpc('print_job_create', { p_kind: 'bill', p_order: printed.id, p_device: DEV_A1 });
    await tabA.rpc('print_job_finish', { p_job: p.data.job.id, p_device: DEV_A1, p_ok: true });
    const f = await tabA.rpc('print_job_create', { p_kind: 'bill', p_order: failed.id, p_device: DEV_A1 });
    await tabA.rpc('print_job_finish', { p_job: f.data.job.id, p_device: DEV_A1, p_ok: false, p_error: 'Mất kết nối' });

    const r = await owner.rpc('owner_shift_print_issues', { p_shift: sim.shiftId });
    expect(r.data.map((x: { code: string; status: string }) => [x.code, x.status])).toEqual([
      [failed.result.order!.code, 'failed'],
      [none.result.order!.code, 'none'],
    ]);
    expect((await tabA.rpc('owner_shift_print_issues', { p_shift: sim.shiftId })).error?.message).toMatch(/forbidden/);

    // Chủ in lại thành công ⇒ không còn trong danh sách.
    const re = await owner.rpc('print_job_create', { p_kind: 'bill', p_order: failed.id });
    const c = await tabA.rpc('print_job_claim', { p_job: re.data.job.id, p_device: DEV_A1 });
    await tabA.rpc('print_job_finish', { p_job: c.data.job.id, p_device: DEV_A1, p_ok: true });
    expect((await owner.rpc('owner_shift_print_issues', { p_shift: sim.shiftId })).data).toHaveLength(1);
  });
});
