import type { SupabaseClient } from '@supabase/supabase-js';
import { monthFirstDay, monthRange, shiftMonth, type DayOff, type PayrollEntry, type PayrollKind, type StaffDetails, type WorkShift } from '@/domain/payroll';
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
  daysOff: DayOff[];
}

const ENTRY_COLUMNS = 'id,staff_id,month,kind,amount,note,at,voided_at';
const DAY_OFF_COLUMNS = 'id,staff_id,day,reason';

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
  let offQ = client
    .from('staff_days_off')
    .select(DAY_OFF_COLUMNS)
    .gte('day', monthFirstDay(ym))
    .lt('day', monthFirstDay(shiftMonth(ym, 1)))
    .order('day');
  if (staffId) {
    shiftQ = shiftQ.eq('staff_id', staffId);
    entryQ = entryQ.eq('staff_id', staffId);
    offQ = offQ.eq('staff_id', staffId);
  }
  const [staff, details, shifts, entries, daysOff] = await Promise.all([
    client.from('staff').select('id,name,active,sort').order('sort').order('name'),
    client.from('staff_details').select(STAFF_DETAILS_COLUMNS),
    shiftQ,
    entryQ,
    offQ,
  ]);
  if (staff.error) fail('nhân viên', staff.error);
  if (details.error) fail('thông tin lương', details.error);
  if (shifts.error) fail('ca', shifts.error);
  if (entries.error) fail('sổ lương', entries.error);
  if (daysOff.error) fail('ngày nghỉ', daysOff.error);
  type RawShift = WorkShift & { tablet_profiles: { name: string } | null };
  return {
    month: ym,
    staff: staff.data as Staff[],
    details: details.data as StaffDetails[],
    shifts: (shifts.data as unknown as RawShift[]).map(({ tablet_profiles, ...s }) => ({ ...s, tablet_name: tablet_profiles?.name ?? '?' })),
    entries: entries.data as PayrollEntry[],
    daysOff: daysOff.data as DayOff[],
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

/** Đánh ngày nghỉ (lý do không bắt buộc). */
export async function addDayOff(client: SupabaseClient, staffId: string, day: string, reason: string | null): Promise<void> {
  const { error } = await client.from('staff_days_off').insert({ staff_id: staffId, day, reason });
  if (error) throw new PayrollError(error.code === '23505' ? 'Ngày này đã đánh nghỉ rồi' : `Không đánh được ngày nghỉ: ${error.message}`);
}

export async function updateDayOffReason(client: SupabaseClient, id: string, reason: string | null): Promise<void> {
  const { data, error } = await client.from('staff_days_off').update({ reason }).eq('id', id).select('id');
  if (error) throw new PayrollError(`Không lưu được lý do: ${error.message}`);
  if (!data?.length) throw new PayrollError('Ngày nghỉ này đã bị bỏ');
}

/** Bỏ ngày nghỉ đánh nhầm. */
export async function removeDayOff(client: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await client.from('staff_days_off').delete().eq('id', id).select('id');
  if (error) throw new PayrollError(`Không bỏ được ngày nghỉ: ${error.message}`);
  if (!data?.length) throw new PayrollError('Ngày nghỉ này đã bị bỏ');
}
