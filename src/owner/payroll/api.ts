import type { SupabaseClient } from '@supabase/supabase-js';
import { monthFirstDay, monthRange, type PayrollEntry, type PayrollKind, type StaffDetails, type WorkShift } from '@/domain/payroll';
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
}

const ENTRY_COLUMNS = 'id,staff_id,month,kind,amount,note,at,voided_at';

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
  if (staffId) {
    shiftQ = shiftQ.eq('staff_id', staffId);
    entryQ = entryQ.eq('staff_id', staffId);
  }
  const [staff, details, shifts, entries] = await Promise.all([
    client.from('staff').select('id,name,active,sort').order('sort').order('name'),
    client.from('staff_details').select(STAFF_DETAILS_COLUMNS),
    shiftQ,
    entryQ,
  ]);
  if (staff.error) fail('nhân viên', staff.error);
  if (details.error) fail('thông tin lương', details.error);
  if (shifts.error) fail('ca', shifts.error);
  if (entries.error) fail('sổ lương', entries.error);
  type RawShift = WorkShift & { tablet_profiles: { name: string } | null };
  return {
    month: ym,
    staff: staff.data as Staff[],
    details: details.data as StaffDetails[],
    shifts: (shifts.data as unknown as RawShift[]).map(({ tablet_profiles, ...s }) => ({ ...s, tablet_name: tablet_profiles?.name ?? '?' })),
    entries: entries.data as PayrollEntry[],
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
