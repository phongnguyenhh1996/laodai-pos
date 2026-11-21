import type { SupabaseClient } from '@supabase/supabase-js';
import { actionsForFilter, type AuditEntry } from '@/domain/audit';
import type { OrderItem } from '@/domain/types';
import type { ShiftOrderRow } from '../shifts/api';

/** Nhật ký (mục 6, màn chủ số 6) + chi tiết một đơn (đích link "🔗" của tin Telegram). */

export class LogError extends Error {}

export interface LogFilter {
  /** Nhóm (ACTION_GROUPS.id) hoặc tên action. */
  type?: string | null;
  staffId?: string | null;
  /** Ngày kinh doanh "YYYY-MM-DD" (giờ Việt Nam). */
  date?: string | null;
  entityId?: string | null;
}

export interface LogNames {
  staff: Map<string, string>;
  tablets: Map<string, string>;
  customers: Map<string, string>;
}

export const PAGE_SIZE = 50;

/** Khoảng [00:00, 24:00) của ngày theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
export function vnDayRange(date: string): { from: string; to: string } {
  const start = new Date(`${date}T00:00:00+07:00`);
  return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() };
}

/** Trang kế tiếp: các dòng cũ hơn dòng cuối đã hiện (khóa (at, id), không bỏ sót dòng trùng giờ). */
export async function loadLog(client: SupabaseClient, f: LogFilter, after?: Pick<AuditEntry, 'at' | 'id'>): Promise<AuditEntry[]> {
  let q = client
    .from('audit_log')
    .select('id,at,synced_at,actor_kind,staff_id,tablet_profile_id,shift_id,action,entity,entity_id,before,after,reason')
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  const actions = actionsForFilter(f.type);
  if (actions) q = q.in('action', actions);
  if (f.staffId) q = q.eq('staff_id', f.staffId);
  if (f.entityId) q = q.eq('entity_id', f.entityId);
  if (f.date) {
    const r = vnDayRange(f.date);
    q = q.gte('at', r.from).lt('at', r.to);
  }
  if (after) q = q.or(`at.lt."${after.at}",and(at.eq."${after.at}",id.lt.${after.id})`);
  const { data, error } = await q;
  if (error) throw new LogError(`Không tải được nhật ký: ${error.message}`);
  return (data ?? []) as AuditEntry[];
}

export async function loadLogNames(client: SupabaseClient): Promise<LogNames> {
  const [s, t, c] = await Promise.all([
    client.from('staff').select('id,name'),
    client.from('tablet_profiles').select('id,name'),
    client.from('customers').select('id,name,description'),
  ]);
  for (const r of [s, t, c]) if (r.error) throw new LogError(`Không tải được danh sách: ${r.error.message}`);
  const map = (rows: unknown) => new Map(((rows ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
  return {
    staff: map(s.data),
    tablets: map(t.data),
    customers: new Map(
      ((c.data ?? []) as Array<{ id: string; name: string; description: string | null }>).map((x) => [x.id, x.description ? `${x.name} (${x.description})` : x.name]),
    ),
  };
}

export interface OrderDetail extends Omit<ShiftOrderRow, 'items'> {
  point_name: string;
  tablet_name: string;
  tablet_profile_id: string;
  customer_label: string | null;
  cash_given: number | null;
  address: string | null;
  /** Đã nằm trong `total`. */
  ship_fee: number;
  items: Array<Pick<OrderItem, 'name_snap' | 'qty' | 'unit_price_snap' | 'toppings_snap'>>;
}

export async function loadOrderDetail(client: SupabaseClient, orderId: string): Promise<OrderDetail | null> {
  const { data, error } = await client
    .from('orders')
    .select(
      'id,code,label,dine_type,address,ship_fee,status,total,payment_method,cash_given,created_at,served_at,paid_at,deleted_at,delete_reason,' +
        'owner_edited,opened_shift_id,paid_shift_id,tablet_profile_id,points(name),tablet_profiles(name),customers(name,description),' +
        'opened:shifts!orders_opened_shift_id_fkey(staff(name)),paid:shifts!orders_paid_shift_id_fkey(staff(name)),' +
        'order_items(name_snap,qty,unit_price_snap,toppings_snap,sort,removed_at)',
    )
    .eq('id', orderId);
  if (error) throw new LogError(`Không tải được đơn: ${error.message}`);
  type Raw = Omit<OrderDetail, 'point_name' | 'tablet_name' | 'customer_label' | 'items' | 'opened_by' | 'paid_by'> & {
    points: { name: string } | null;
    tablet_profiles: { name: string } | null;
    customers: { name: string; description: string | null } | null;
    opened: { staff: { name: string } | null } | null;
    paid: { staff: { name: string } | null } | null;
    order_items: Array<OrderDetail['items'][number] & { sort: number; removed_at: string | null }>;
  };
  const r = (data as unknown as Raw[] | null)?.[0];
  if (!r) return null;
  const { points, tablet_profiles, customers, opened, paid, order_items, ...o } = r;
  return {
    ...o,
    point_name: points?.name ?? '',
    tablet_name: tablet_profiles?.name ?? '',
    customer_label: customers ? (customers.description ? `${customers.name} (${customers.description})` : customers.name) : null,
    opened_by: opened?.staff?.name ?? '?',
    paid_by: o.paid_shift_id ? (paid?.staff?.name ?? '?') : null,
    items: order_items
      .filter((i) => !i.removed_at)
      .sort((a, b) => a.sort - b.sort)
      .map(({ name_snap, qty, unit_price_snap, toppings_snap }) => ({ name_snap, qty, unit_price_snap, toppings_snap })),
  };
}

/** Các lần in của một đơn (phiếu bếp + bill), mới nhất trước. */
export interface OrderPrintRow {
  id: string;
  kind: 'kitchen' | 'bill' | 'test';
  source: 'auto' | 'staff' | 'owner';
  status: 'pending' | 'claimed' | 'printed' | 'failed' | 'expired';
  created_at: string;
  error: string | null;
  tablet_profiles: { name: string } | null;
}

export async function loadOrderPrints(client: SupabaseClient, orderId: string): Promise<OrderPrintRow[]> {
  const { data, error } = await client
    .from('print_jobs')
    .select('id,kind,source,status,created_at,error,tablet_profiles(name)')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw new LogError(`Không tải được lịch sử in: ${error.message}`);
  return (data ?? []) as unknown as OrderPrintRow[];
}
