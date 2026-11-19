import type { SupabaseClient } from '@supabase/supabase-js';
import { monthFirstDay, monthRange, shiftMonth, type DayMark, type DayMarkKind, type PayrollEntry, type PayrollKind, type StaffDetails, type WorkShift } from '@/domain/payroll';
import type { Staff } from '@/domain/types';
import { STAFF_DETAILS_COLUMNS } from '../settings/api';

/** Lương (màn chủ): công từ các ca trong tháng + sổ lương (thưởng / trừ / ứng / trả). Chỉ chủ đọc / ghi được. */

export class PayrollError extends Error {}

export interface PayrollShift extends WorkShift {
  tablet_name: string;
}

export interface PayrollMonth {
  month: string; // YYYY-MM
  staff: Staff[];
  details: StaffDetails[];
  shifts: PayrollShift[];
  entries: PayrollEntry[];
  marks: DayMark[];
}

const ENTRY_COLUMNS = 'id,staff_id,month,kind,amount,note,at,voided_at';
const DAY_MARK_COLUMNS = 'id,staff_id,day,kind,reason';

function fail(what: string, error: { message: string }): never {
  throw new PayrollError(`Không tải được ${what}: ${error.message}`);
}

/** Toàn bộ dữ liệu lương của tháng `ym` (dữ liệu nhỏ: vài nhân viên, vài trăm ca). Lọc một nhân viên bằng `staffId`. */
export async function loadPayrollMonth(client: SupabaseClient, ym: string, staffId?: string): Promise<PayrollMonth> {
  const { from, to } = monthRange(ym);
  let shiftQ = client
    .from('shifts')
    .select('id,staff_id,opened_at,closed_at,tablet_profiles(name)')
    .gte('opened_at', from)
    .lt('opened_at', to)
    .order('opened_at');
  let entryQ = client.from('payroll_entries').select(ENTRY_COLUMNS).eq('month', monthFirstDay(ym)).order('at');
  let markQ = client
    .from('staff_day_marks')
    .select(DAY_MARK_COLUMNS)
    .gte('day', monthFirstDay(ym))
    .lt('day', monthFirstDay(shiftMonth(ym, 1)))
    .order('day');
  if (staffId) {
    shiftQ = shiftQ.eq('staff_id', staffId);
    entryQ = entryQ.eq('staff_id', staffId);
    markQ = markQ.eq('staff_id', staffId);
  }
  const [staff, details, shifts, entries, marks] = await Promise.all([
    client.from('staff').select('id,name,active,sort').order('sort').order('name'),
    client.from('staff_details').select(STAFF_DETAILS_COLUMNS),
    shiftQ,
    entryQ,
    markQ,
  ]);
  if (staff.error) fail('nhân viên', staff.error);
  if (details.error) fail('thông tin lương', details.error);
  if (shifts.error) fail('ca', shifts.error);
  if (entries.error) fail('sổ lương', entries.error);
  if (marks.error) fail('đánh dấu ngày', marks.error);
  type RawShift = WorkShift & { tablet_profiles: { name: string } | null };
  return {
    month: ym,
    staff: staff.data as Staff[],
    details: details.data as StaffDetails[],
    shifts: (shifts.data as unknown as RawShift[]).map(({ tablet_profiles, ...s }) => ({ ...s, tablet_name: tablet_profiles?.name ?? '?' })),
    entries: entries.data as PayrollEntry[],
    marks: marks.data as DayMark[],
  };
}

export async function addPayrollEntry(
  client: SupabaseClient,
  e: { staff_id: string; month: string; kind: PayrollKind; amount: number; note: string },
): Promise<void> {
  const { error } = await client
    .from('payroll_entries')
    .insert({ staff_id: e.staff_id, month: monthFirstDay(e.month), kind: e.kind, amount: e.amount, note: e.note.trim() || null });
  if (error) throw new PayrollError(`Không ghi được: ${error.message}`);
}

/** Hủy một dòng sổ lương ghi nhầm (không xóa, vẫn hiện gạch ngang + có nhật ký). */
export async function voidPayrollEntry(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client
    .from('payroll_entries')
    .update({ voided_at: new Date().toISOString() })
    .eq('id', id)
    .is('voided_at', null)
    .select('id');
  if (error) throw new PayrollError(`Không hủy được: ${error.message}`);
  if (!data?.length) throw new PayrollError('Dòng này đã được hủy trước đó');
}

/** Đánh dấu một ngày: nghỉ hoặc có làm (làm mà không mở ca); lý do / ghi chú không bắt buộc. */
export async function addDayMark(client: SupabaseClient, staffId: string, day: string, kind: DayMarkKind, reason: string | null): Promise<void> {
  const { error } = await client.from('staff_day_marks').insert({ staff_id: staffId, day, kind, reason });
  if (error) throw new PayrollError(error.code === '23505' ? 'Ngày này đã được đánh dấu rồi' : `Không đánh dấu được: ${error.message}`);
}

/** Đổi loại (nghỉ ↔ có làm) và / hoặc lý do. */
export async function updateDayMark(client: SupabaseClient, id: string, patch: { kind: DayMarkKind; reason: string | null }): Promise<void> {
  const { data, error } = await client.from('staff_day_marks').update(patch).eq('id', id).select('id');
  if (error) throw new PayrollError(`Không lưu được: ${error.message}`);
  if (!data?.length) throw new PayrollError('Đánh dấu này đã bị bỏ');
}

/** Bỏ đánh dấu nhầm. */
export async function removeDayMark(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from('staff_day_marks').delete().eq('id', id).select('id');
  if (error) throw new PayrollError(`Không bỏ được: ${error.message}`);
  if (!data?.length) throw new PayrollError('Đánh dấu này đã bị bỏ');
}
