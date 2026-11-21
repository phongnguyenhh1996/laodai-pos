import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReconcileResult } from '@/domain/reconcile';
import type { AdjustmentKind, CountItem, DeleteReason, DineType, Money, OrderStatus, PaymentMethod, ToppingSnap } from '@/domain/types';

/** Ca (mục 7, màn chủ số 2): danh sách ca → đối soát, đơn của ca, bổ sung hộp / dĩa / tiền giữa ca. */

export class ShiftsError extends Error {}

export interface ShiftRow {
  id: string;
  tablet_profile_id: string;
  staff_id: string;
  staff_name: string;
  tablet_name: string;
  opened_at: string;
  closed_at: string | null;
  status: 'open' | 'closed';
  open_boxes: number;
  open_plates: number;
  open_cans: number;
  open_float: Money;
  /** Các thứ ca này đếm khi đóng ca (chụp từ quầy lúc mở ca). */
  count_items: CountItem[];
  close_boxes_left: number | null;
  close_plates_left: number | null;
  close_cans_left: number | null;
  close_cash_counted: Money | null;
  recalculated_at: string | null;
}

export interface AdjustmentRow {
  id: string;
  kind: AdjustmentKind;
  qty: number;
  note: string | null;
  at: string;
}

export interface ShiftOrderRow {
  id: string;
  code: string;
  label: string | null;
  dine_type: DineType;
  status: OrderStatus;
  total: Money;
  payment_method: PaymentMethod | null;
  created_at: string;
  served_at: string | null;
  paid_at: string | null;
  deleted_at: string | null;
  delete_reason: DeleteReason | null;
  owner_edited: boolean;
  opened_shift_id: string;
  paid_shift_id: string | null;
  items: Array<{ name_snap: string; qty: number; toppings_snap: ToppingSnap[] }>;
  point_name: string;
  /** Người mở đơn (nhân viên của ca mở) và người thu tiền (nhân viên của ca thu). */
  opened_by: string;
  paid_by: string | null;
}

export interface ShiftDetail {
  shift: ShiftRow;
  reconcile: ReconcileResult;
  adjustments: AdjustmentRow[];
  orders: ShiftOrderRow[];
  /** Số lần nhân viên sửa đơn đang mở trong ca (từ nhật ký). */
  edits: number;
  /** Đơn thu trong ca mà không có bill nào in thành công (SPEC 12.7). */
  billIssues: Array<{ order_id: string; code: string; status: 'failed' | 'none' }>;
}

const SHIFT_COLUMNS =
  'id,tablet_profile_id,staff_id,opened_at,closed_at,status,open_boxes,open_plates,open_cans,open_float,count_items,' +
  'close_boxes_left,close_plates_left,close_cans_left,close_cash_counted,recalculated_at,staff(name),tablet_profiles(name)';

type RawShift = Omit<ShiftRow, 'staff_name' | 'tablet_name'> & { staff: { name: string } | null; tablet_profiles: { name: string } | null };

const toShift = ({ staff, tablet_profiles, ...s }: RawShift): ShiftRow => ({
  ...s,
  staff_name: staff?.name ?? '?',
  tablet_name: tablet_profiles?.name ?? '?',
});

function fail(what: string, error: { message: string }): never {
  throw new ShiftsError(`Không tải được ${what}: ${error.message}`);
}

/** Ca gần nhất trước (ca đang mở luôn ở trên). */
export async function listShifts(client: SupabaseClient, limit = 50): Promise<ShiftRow[]> {
  const { data, error } = await client.from('shifts').select(SHIFT_COLUMNS).order('opened_at', { ascending: false }).limit(limit);
  if (error) fail('danh sách ca', error);
  const rows = ((data ?? []) as unknown as RawShift[]).map(toShift);
  return [...rows.filter((s) => s.status === 'open'), ...rows.filter((s) => s.status !== 'open')];
}

type RawOrder = Omit<ShiftOrderRow, 'items' | 'opened_by' | 'paid_by' | 'point_name'> & {
  points: { name: string } | null;
  order_items: Array<{ name_snap: string; qty: number; toppings_snap: ToppingSnap[]; removed_at: string | null }>;
};

export async function loadShiftDetail(client: SupabaseClient, shiftId: string): Promise<ShiftDetail | null> {
  const [shiftRes, recRes, adjRes, ordRes, editRes, printRes] = await Promise.all([
    client.from('shifts').select(SHIFT_COLUMNS).eq('id', shiftId),
    client.rpc('reconcile_shift', { p_shift: shiftId }),
    client.from('shift_adjustments').select('id,kind,qty,note,at').eq('shift_id', shiftId).order('at'),
    client
      .from('orders')
      .select(
        'id,code,label,dine_type,status,total,payment_method,created_at,served_at,paid_at,deleted_at,delete_reason,' +
          'owner_edited,opened_shift_id,paid_shift_id,points(name),order_items(name_snap,qty,toppings_snap,removed_at)',
      )
      .or(`opened_shift_id.eq.${shiftId},paid_shift_id.eq.${shiftId}`)
      .order('created_at'),
    client.from('audit_log').select('id', { count: 'exact', head: true }).eq('shift_id', shiftId).eq('action', 'order_update'),
    client.rpc('owner_shift_print_issues', { p_shift: shiftId }),
  ]);
  if (shiftRes.error) fail('ca', shiftRes.error);
  const raw = (shiftRes.data as unknown as RawShift[] | null)?.[0];
  if (!raw) return null;
  if (recRes.error) fail('đối soát', recRes.error);
  if (adjRes.error) fail('bổ sung giữa ca', adjRes.error);
  if (ordRes.error) fail('đơn của ca', ordRes.error);
  if (editRes.error) fail('nhật ký', editRes.error);

  const shift = toShift(raw);
  const orders = (ordRes.data ?? []) as unknown as RawOrder[];

  // Tên nhân viên của các ca liên quan (đơn mở ở ca trước, thu ở ca này và ngược lại).
  const otherIds = [...new Set(orders.flatMap((o) => [o.opened_shift_id, o.paid_shift_id]))].filter(
    (id): id is string => !!id && id !== shift.id,
  );
  const staffOf = new Map<string, string>([[shift.id, shift.staff_name]]);
  if (otherIds.length) {
    const { data, error } = await client.from('shifts').select('id,staff(name)').in('id', otherIds);
    if (error) fail('ca liên quan', error);
    for (const s of (data ?? []) as unknown as Array<{ id: string; staff: { name: string } | null }>) staffOf.set(s.id, s.staff?.name ?? '?');
  }

  return {
    shift,
    reconcile: recRes.data as ReconcileResult,
    adjustments: (adjRes.data ?? []) as AdjustmentRow[],
    edits: editRes.count ?? 0,
    // Server chưa có tính năng in (chưa chạy migration) ⇒ coi như không có dòng này.
    billIssues: printRes.error ? [] : ((printRes.data ?? []) as ShiftDetail['billIssues']),
    orders: orders.map(({ order_items, points, ...o }) => ({
      ...o,
      point_name: points?.name ?? '',
      items: order_items.filter((i) => !i.removed_at).map(({ name_snap, qty, toppings_snap }) => ({ name_snap, qty, toppings_snap })),
      opened_by: staffOf.get(o.opened_shift_id) ?? '?',
      paid_by: o.paid_shift_id ? (staffOf.get(o.paid_shift_id) ?? '?') : null,
    })),
  };
}

/** Chủ bổ sung giữa ca (vd. +50 hộp, +200.000 tiền lẻ). Ghi `shift_adjustments` + nhật ký. */
export async function addAdjustment(
  client: SupabaseClient,
  shiftId: string,
  kind: AdjustmentKind,
  qty: number,
  note: string | null,
): Promise<void> {
  if (!Number.isInteger(qty) || qty <= 0) throw new ShiftsError('Số bổ sung phải là số nguyên dương');
  const { error } = await client.rpc('owner_adjust_shift', { p_shift: shiftId, p_kind: kind, p_qty: qty, p_note: note?.trim() || null });
  if (error) throw new ShiftsError(`Không lưu được: ${error.message}`);
}

/** Thẻ ca trên màn Ca (Figma R20 / T25): ca + đối soát (doanh thu, lệch tiền) + tên điểm bán của quầy. */
export interface ShiftCard extends ShiftRow {
  reconcile: ReconcileResult;
  point_names: string;
}

/**
 * Các ca mở trong khoảng ngày (giờ VN) + mọi ca đang mở, mới nhất trước (ca đang mở luôn ở trên).
 * Đối soát lấy từ `owner_report` (một lần gọi); ca đang mở mà mở trước khoảng ngày thì gọi `reconcile_shift` riêng.
 */
export async function loadShiftBoard(client: SupabaseClient, from: string, to: string): Promise<ShiftCard[]> {
  const [repRes, openRes, tabRes, ptRes] = await Promise.all([
    client.rpc('owner_report', { p_from: from, p_to: to }),
    client.from('shifts').select(SHIFT_COLUMNS).eq('status', 'open'),
    client.from('tablet_profiles').select('id,point_ids'),
    client.from('points').select('id,name'),
  ]);
  if (repRes.error) fail('ca', repRes.error);
  if (openRes.error) fail('ca đang mở', openRes.error);
  const byShift = ((repRes.data as { by_shift?: Array<{ shift_id: string; reconcile: ReconcileResult }> } | null)?.by_shift ?? []) as Array<{
    shift_id: string;
    reconcile: ReconcileResult;
  }>;
  const rec = new Map(byShift.map((s) => [s.shift_id, s.reconcile]));
  const ids = byShift.map((s) => s.shift_id);
  const inRange = ids.length ? await client.from('shifts').select(SHIFT_COLUMNS).in('id', ids) : { data: [], error: null };
  if (inRange.error) fail('ca', inRange.error);

  const rows = new Map<string, ShiftRow>();
  for (const r of [...((inRange.data ?? []) as unknown as RawShift[]), ...((openRes.data ?? []) as unknown as RawShift[])]) rows.set(r.id, toShift(r));
  await Promise.all(
    [...rows.keys()]
      .filter((id) => !rec.has(id))
      .map(async (id) => {
        const { data, error } = await client.rpc('reconcile_shift', { p_shift: id });
        if (error) fail('đối soát', error);
        rec.set(id, data as ReconcileResult);
      }),
  );

  const pointName = new Map(((ptRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  const tabletPoints = new Map(
    ((tabRes.data ?? []) as Array<{ id: string; point_ids: string[] }>).map((t) => [t.id, t.point_ids.map((p) => pointName.get(p)).filter(Boolean).join(', ')]),
  );
  const list = [...rows.values()]
    .map((s) => ({ ...s, reconcile: rec.get(s.id)!, point_names: tabletPoints.get(s.tablet_profile_id) ?? '' }))
    .sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  return [...list.filter((s) => s.status === 'open'), ...list.filter((s) => s.status !== 'open')];
}
