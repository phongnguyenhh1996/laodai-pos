import type { SupabaseClient } from '@supabase/supabase-js';
import type { OwnerEditPayload, PaidOrderSnapshot } from '@/domain/ownerEdit';
import type { Combo, Customer, DeleteReason, DineType, Money, OrderItem, OrderStatus, PaymentMethod, Product, ToppingSnap, Topping } from '@/domain/types';

/** Đơn (mục 7, màn chủ số 3): lọc đơn (kể cả đã xóa), sửa đơn đã thanh toán. */

export class OrdersError extends Error {}

export interface OrderFilter {
  /** "YYYY-MM-DD" (giờ VN) hoặc null = mọi ngày. */
  date: string | null;
  pointId: string | null;
  staffId: string | null;
  method: PaymentMethod | null;
  status: OrderStatus | null;
}

export interface OrderListRow {
  id: string;
  code: string;
  label: string | null;
  status: OrderStatus;
  dine_type: DineType;
  point_id: string;
  point_name: string;
  tablet_name: string;
  total: Money;
  payment_method: PaymentMethod | null;
  owner_edited: boolean;
  created_at: string;
  served_at: string | null;
  paid_at: string | null;
  deleted_at: string | null;
  delete_reason: DeleteReason | null;
  at: string;
  opened_by: string;
  paid_by: string | null;
  customer_label: string | null;
  items: Array<{ name_snap: string; qty: number; toppings_snap: ToppingSnap[] }>;
}

export async function listOrders(client: SupabaseClient, f: OrderFilter): Promise<OrderListRow[]> {
  const { data, error } = await client.rpc('owner_orders', {
    p_date: f.date,
    p_point: f.pointId,
    p_staff: f.staffId,
    p_method: f.method,
    p_status: f.status,
  });
  if (error) throw new OrdersError(`Không tải được đơn: ${error.message}`);
  return (data ?? []) as OrderListRow[];
}

// ---------------------------------------------------------------- sửa đơn đã thanh toán

export interface EditableOrder extends PaidOrderSnapshot {
  id: string;
  code: string;
  status: OrderStatus;
  point_name: string;
  menu_id: string;
  tablet_name: string;
  dine_type: DineType;
  /** Giữ nguyên khi sửa; đã nằm trong `total`. */
  ship_fee: Money;
  paid_shift_id: string | null;
  opened_shift_id: string;
  /** Các ca liên quan đã đóng ⇒ sẽ được tính lại đối soát. */
  closed_shift_ids: string[];
}

export interface EditCatalog {
  products: Product[];
  toppings: Topping[];
  combos: Combo[];
  customers: Customer[];
}

export async function loadEditableOrder(client: SupabaseClient, orderId: string): Promise<EditableOrder | null> {
  const { data, error } = await client
    .from('orders')
    .select(
      'id,code,status,total,payment_method,customer_id,dine_type,ship_fee,paid_shift_id,opened_shift_id,' +
        'points(name,menu_id),tablet_profiles(name),order_items(id,product_id,name_snap,unit_price_snap,qty,toppings_snap,sort,removed_at)',
    )
    .eq('id', orderId);
  if (error) throw new OrdersError(`Không tải được đơn: ${error.message}`);
  type Raw = {
    id: string;
    code: string;
    status: OrderStatus;
    total: Money;
    payment_method: PaymentMethod | null;
    customer_id: string | null;
    dine_type: DineType;
    ship_fee: Money | null;
    paid_shift_id: string | null;
    opened_shift_id: string;
    points: { name: string; menu_id: string } | null;
    tablet_profiles: { name: string } | null;
    order_items: Array<OrderItem & { sort: number; removed_at: string | null }>;
  };
  const r = (data as unknown as Raw[] | null)?.[0];
  if (!r) return null;
  const shiftIds = [...new Set([r.opened_shift_id, r.paid_shift_id].filter((x): x is string => !!x))];
  const { data: shifts, error: sErr } = await client.from('shifts').select('id,status').in('id', shiftIds);
  if (sErr) throw new OrdersError(`Không tải được ca: ${sErr.message}`);
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    total: r.total,
    payment_method: r.payment_method ?? 'cash',
    customer_id: r.customer_id,
    dine_type: r.dine_type,
    ship_fee: r.ship_fee ?? 0,
    paid_shift_id: r.paid_shift_id,
    opened_shift_id: r.opened_shift_id,
    point_name: r.points?.name ?? '',
    menu_id: r.points?.menu_id ?? '',
    tablet_name: r.tablet_profiles?.name ?? '',
    closed_shift_ids: ((shifts ?? []) as Array<{ id: string; status: string }>).filter((s) => s.status === 'closed').map((s) => s.id),
    items: r.order_items
      .filter((i) => !i.removed_at)
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map(({ id, product_id, name_snap, unit_price_snap, qty, toppings_snap }) => ({ id, product_id, name_snap, unit_price_snap, qty, toppings_snap })),
  };
}

export async function loadEditCatalog(client: SupabaseClient, menuId: string): Promise<EditCatalog> {
  const [p, t, c, cu] = await Promise.all([
    client.from('products').select('id,menu_id,name,price,sort,active,boxes_takeaway,boxes_dinein,plates_dinein').eq('menu_id', menuId),
    client.from('toppings').select('id,menu_id,name,price,extra_box_takeaway,sort,active').eq('menu_id', menuId),
    client.from('combos').select('id,menu_id,name,product_id,topping_ids,sort,active').eq('menu_id', menuId),
    client.from('customers').select('id,name,description,phone,address,merged_into_id'),
  ]);
  for (const r of [p, t, c, cu]) if (r.error) throw new OrdersError(`Không tải được danh mục: ${r.error.message}`);
  return {
    products: (p.data ?? []) as Product[],
    toppings: (t.data ?? []) as Topping[],
    combos: (c.data ?? []) as Combo[],
    customers: (cu.data ?? []) as Customer[],
  };
}

/** Gửi phần đã đổi; server ghi nhật ký trước / sau, tính lại ca đã đóng, báo Telegram. */
export async function saveOwnerEdit(client: SupabaseClient, orderId: string, payload: OwnerEditPayload): Promise<void> {
  const { error } = await client.rpc('owner_edit_order', {
    p_order: orderId,
    p_items: payload.p_items,
    p_payment_method: payload.p_payment_method,
    p_customer_id: payload.p_customer_id,
  });
  if (error) throw new OrdersError(`Không lưu được: ${error.message}`);
}
