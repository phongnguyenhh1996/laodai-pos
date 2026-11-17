import type { SupabaseClient } from '@supabase/supabase-js';
import { businessDate } from '@/domain/time';
import type { Order, OrderItem } from '@/domain/types';
import { META, getMeta, type Activation, type LaodaiDB, type LocalShift } from './db';

/**
 * Kích hoạt lại tablet (máy mới / dữ liệu trên máy bị xóa) khi server còn ca đang mở của hồ sơ này:
 * lấy lại ca đó và các đơn đang mở về máy. Không có bước này thì tablet không đóng được ca cũ
 * (mở ca mới bị server từ chối vì mỗi tablet chỉ một ca mở) và đơn đang mở bị bỏ quên.
 * Chỉ thêm cái máy chưa có: không ghi đè dữ liệu chưa đồng bộ trên máy.
 */

export interface ServerOpenState {
  shift: LocalShift | null;
  orders: Order[];
}

export type RestoreSource = (profileId: string) => Promise<ServerOpenState>;

export class RestoreError extends Error {}

export async function restoreOpenState(db: LaodaiDB, source: RestoreSource): Promise<{ shift: boolean; orders: number }> {
  const act = await getMeta<Activation>(db, META.activation);
  if (!act) throw new RestoreError('Tablet chưa được kích hoạt');
  const server = await source(act.tablet_profile_id);
  return db.transaction('rw', db.meta, db.orders, db.usedCodes, async () => {
    let shift = false;
    if (server.shift && server.shift.tablet_profile_id === act.tablet_profile_id && !(await getMeta<LocalShift>(db, META.shift))) {
      await db.meta.put({ key: META.shift, value: server.shift });
      shift = true;
    }
    let orders = 0;
    for (const o of server.orders) {
      if (o.tablet_profile_id !== act.tablet_profile_id || (o.status !== 'open' && o.status !== 'served')) continue;
      if (await db.orders.get(o.id)) continue;
      await db.orders.add(o);
      // Mã đơn đã dùng trong ngày: đơn mới không được trùng.
      await db.usedCodes.put({ date: businessDate(o.created_at), code: o.code });
      orders++;
    }
    return { shift, orders };
  });
}

type RawShift = Omit<LocalShift, 'staff_name'> & { staff: { name: string } | null };
type RawItem = OrderItem & { sort: number; removed_at: string | null };
type RawOrder = Omit<Order, 'items'> & { order_items: RawItem[] };

const ORDER_COLUMNS =
  'id,device_seq,tablet_profile_id,point_id,code,label,table_no,dine_type,status,opened_shift_id,paid_shift_id,' +
  'created_at,served_at,paid_at,deleted_at,delete_reason,total,payment_method,cash_given,customer_id,owner_edited,' +
  'order_items(id,product_id,name_snap,unit_price_snap,qty,toppings_snap,sort,removed_at)';

/** Nguồn thật: đọc bằng phiên `tablet` (RLS chỉ cho thấy ca đang mở và đơn đang mở của chính hồ sơ này). */
export function createSupabaseRestoreSource(client: SupabaseClient): RestoreSource {
  return async (profileId) => {
    const [sRes, oRes] = await Promise.all([
      client
        .from('shifts')
        .select('id,tablet_profile_id,staff_id,opened_at,open_boxes,open_plates,open_float,staff(name)')
        .eq('tablet_profile_id', profileId)
        .eq('status', 'open'),
      client.from('orders').select(ORDER_COLUMNS).eq('tablet_profile_id', profileId).in('status', ['open', 'served']),
    ]);
    if (sRes.error) throw new RestoreError(`Không đọc được ca đang mở: ${sRes.error.message}`);
    if (oRes.error) throw new RestoreError(`Không đọc được đơn đang mở: ${oRes.error.message}`);
    const raw = (sRes.data as unknown as RawShift[] | null)?.[0];
    const shift: LocalShift | null = raw
      ? {
          id: raw.id,
          tablet_profile_id: raw.tablet_profile_id,
          staff_id: raw.staff_id,
          staff_name: raw.staff?.name ?? '?',
          opened_at: raw.opened_at,
          open_boxes: raw.open_boxes,
          open_plates: raw.open_plates,
          open_float: raw.open_float,
        }
      : null;
    const orders = ((oRes.data ?? []) as unknown as RawOrder[]).map(({ order_items, ...o }) => ({
      ...o,
      items: order_items
        .filter((i) => !i.removed_at)
        .sort((a, b) => a.sort - b.sort)
        .map(({ id, product_id, name_snap, unit_price_snap, qty, toppings_snap }) => ({ id, product_id, name_snap, unit_price_snap, qty, toppings_snap })),
    }));
    return { shift, orders };
  };
}
