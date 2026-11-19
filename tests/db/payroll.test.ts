// Nhân viên: CCCD / sinh nhật / lương (bảng riêng chỉ chủ đọc) + sổ lương tính từ ca thật.
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { computePayslip, monthOf, shiftMonth } from '@/domain/payroll';
import { addDayMark, addPayrollEntry, loadPayrollMonth, removeDayMark, updateDayMark, voidPayrollEntry } from '@/owner/payroll/api';
import { loadOwnerCatalog, saveStaffDetails } from '@/owner/settings/api';
import { ownerClient, resetDb, sql, tabletClient } from '../support/db';
import { TabletSim } from '../support/ops';
import { SEED } from '../support/seed-ids';

let owner: SupabaseClient;
let tab: SupabaseClient;
const ym = monthOf(new Date());

beforeAll(async () => {
  await resetDb();
  [owner, tab] = await Promise.all([ownerClient(), tabletClient(SEED.tablets.A)]);
});

describe('thông tin nhân viên', () => {
  it('chủ lưu SĐT / CCCD / sinh nhật / lương ngày; có nhật ký; tablet không đọc / ghi được', async () => {
    await saveStaffDetails(owner, SEED.staff.Lan, { phone: '0901234567', id_number: '079096001234', birthday: '1998-03-12', day_rate: 200000 });
    const cat = await loadOwnerCatalog(owner);
    expect(cat.staffDetails).toEqual([
      { id: SEED.staff.Lan, phone: '0901234567', id_number: '079096001234', birthday: '1998-03-12', day_rate: 200000 },
    ]);
    // sửa lần 2 (upsert)
    await saveStaffDetails(owner, SEED.staff.Lan, { phone: null, id_number: null, birthday: '1998-03-12', day_rate: 250000 });
    const log = await sql<{ action: string }>(`select action from audit_log where entity = 'staff_details' order by at`);
    expect(log.map((r) => r.action)).toEqual(['settings_create', 'settings_update']);

    expect((await tab.from('staff_details').select('*')).data ?? []).toEqual([]);
    const w = await tab.from('staff_details').upsert({ id: SEED.staff.Mai, day_rate: 1 }).select();
    expect(w.error).not.toBeNull();
  });

  it('DB chặn CCCD / SĐT sai định dạng', async () => {
    const r = await owner.from('staff_details').upsert({ id: SEED.staff.Mai, id_number: '123' });
    expect(r.error?.code).toBe('23514');
    const r2 = await owner.from('staff_details').upsert({ id: SEED.staff.Mai, phone: '09x' });
    expect(r2.error?.code).toBe('23514');
  });
});

describe('sổ lương', () => {
  it('ngày công từ ca + thưởng / ứng; hủy dòng ghi nhầm; tablet không ghi được', async () => {
    const sim = new TabletSim(tab, SEED.tablets.A);
    await sim.openShift('Lan');
    await sim.closeShift(0, 0, 0);
    await sim.openShift('Lan'); // ca thứ 2 cùng ngày: vẫn 1 ngày công
    await sim.closeShift(0, 0, 0);
    await addPayrollEntry(owner, { staff_id: SEED.staff.Lan, month: ym, kind: 'days', amount: 1, note: 'Làm không mở ca' });

    await addPayrollEntry(owner, { staff_id: SEED.staff.Lan, month: ym, kind: 'bonus', amount: 50000, note: 'Lễ' });
    await addPayrollEntry(owner, { staff_id: SEED.staff.Lan, month: ym, kind: 'advance', amount: 999000, note: 'nhầm' });
    let m = await loadPayrollMonth(owner, ym, SEED.staff.Lan);
    await voidPayrollEntry(owner, m.entries.find((e) => e.kind === 'advance')!.id);
    await expect(voidPayrollEntry(owner, m.entries.find((e) => e.kind === 'advance')!.id)).rejects.toThrow('đã được hủy');

    m = await loadPayrollMonth(owner, ym, SEED.staff.Lan);
    expect(m.shifts).toHaveLength(2);
    expect(m.shifts[0].tablet_name).toBeTruthy();
    const p = computePayslip(m.details[0] ?? null, m.shifts, m.entries, ym);
    // 1 ngày có ca + 1 ngày chủ cộng = 2 × 250.000
    expect(p).toMatchObject({ shiftDays: 1, days: 2, base: 500000, bonus: 50000, total: 550000, advance: 0, remaining: 550000 });

    // Không sửa được số tiền đã ghi, chỉ hủy
    const edit = await owner.from('payroll_entries').update({ amount: 1 }).eq('id', m.entries[0].id).select();
    expect(edit.error).not.toBeNull();

    const log = await sql<{ action: string }>(`select action from audit_log where entity = 'payroll_entries' order by at, action`);
    expect(log.map((r) => r.action).sort()).toEqual(['payroll_add', 'payroll_add', 'payroll_add', 'payroll_void']);

    const t = await tab.from('payroll_entries').insert({ staff_id: SEED.staff.Lan, month: `${ym}-01`, kind: 'bonus', amount: 1 }).select();
    expect(t.error).not.toBeNull();
    expect((await tab.from('payroll_entries').select('*')).data ?? []).toEqual([]);
  });
});

describe('đánh dấu ngày (nghỉ / có làm)', () => {
  it('chủ đánh / sửa / bỏ; không trùng ngày; có nhật ký; tablet không đọc / ghi được', async () => {
    const day = `${ym}-02`;
    await addDayMark(owner, SEED.staff.Mai, day, 'off', null);
    await expect(addDayMark(owner, SEED.staff.Mai, day, 'work', 'lần 2')).rejects.toThrow('đã được đánh dấu');
    let m = await loadPayrollMonth(owner, ym, SEED.staff.Mai);
    expect(m.marks).toEqual([{ id: expect.any(String), staff_id: SEED.staff.Mai, day, kind: 'off', reason: null }]);

    await updateDayMark(owner, m.marks[0].id, { kind: 'off', reason: 'Ốm' });
    await updateDayMark(owner, m.marks[0].id, { kind: 'work', reason: 'Phụ dọn kho' });
    m = await loadPayrollMonth(owner, ym, SEED.staff.Mai);
    expect(m.marks[0]).toMatchObject({ kind: 'work', reason: 'Phụ dọn kho' });
    // Tháng khác không lẫn vào
    expect((await loadPayrollMonth(owner, shiftMonth(ym, -1), SEED.staff.Mai)).marks).toEqual([]);

    expect((await tab.from('staff_day_marks').select('*')).data ?? []).toEqual([]);
    const t = await tab.from('staff_day_marks').insert({ staff_id: SEED.staff.Mai, day: `${ym}-03`, kind: 'work' }).select();
    expect(t.error).not.toBeNull();
    const td = await tab.from('staff_day_marks').delete().eq('id', m.marks[0].id).select();
    expect(td.data ?? []).toEqual([]);

    // DB chặn lý do rỗng (UI gửi null) và loại lạ
    const empty = await owner.from('staff_day_marks').insert({ staff_id: SEED.staff.Mai, day: `${ym}-04`, kind: 'off', reason: '' });
    expect(empty.error?.code).toBe('23514');
    const bad = await owner.from('staff_day_marks').insert({ staff_id: SEED.staff.Mai, day: `${ym}-04`, kind: 'half' });
    expect(bad.error?.code).toBe('23514');

    await removeDayMark(owner, m.marks[0].id);
    await expect(removeDayMark(owner, m.marks[0].id)).rejects.toThrow('đã bị bỏ');
    expect((await loadPayrollMonth(owner, ym, SEED.staff.Mai)).marks).toEqual([]);

    const log = await sql<{ action: string }>(`select action from audit_log where entity = 'staff_day_marks' order by at, action`);
    expect(log.map((r) => r.action)).toEqual(['day_off_add', 'day_off_update', 'day_work_update', 'day_work_remove']);
  });

  it('"có làm" ở ngày không có ca được tính ngày công', async () => {
    await saveStaffDetails(owner, SEED.staff.Hung, { phone: null, id_number: null, birthday: null, day_rate: 100000 });
    await addDayMark(owner, SEED.staff.Hung, `${ym}-01`, 'work', null);
    await addDayMark(owner, SEED.staff.Hung, `${ym}-02`, 'off', 'Ốm');
    const m = await loadPayrollMonth(owner, ym, SEED.staff.Hung);
    const p = computePayslip(m.details.find((d) => d.id === SEED.staff.Hung) ?? null, m.shifts, m.entries, ym, m.marks);
    expect(p).toMatchObject({ markedDays: 1, days: 1, base: 100000 });
  });
});
