import type { SupabaseClient } from '@supabase/supabase-js';
import type { DebtHistory } from '@/domain/debt';
import type { Order, OrderItem } from '@/domain/types';
import { createSupabaseCatalogSource, type CatalogData } from './catalog';
import type { OpenState, PushResult, TabletShift, WireOp } from './types';

/** Phạm vi thay đổi server báo về: ca + đơn của hồ sơ tablet, hoặc danh mục (menu, giá, nhân viên, dư nợ…). */
export type PulseScope = 'open' | 'catalog';

/** Trạng thái kênh Realtime. */
export type ChannelStatus = 'connecting' | 'live' | 'down';

/** Mọi thứ tablet cần từ server. Bản thật dùng Supabase; test dùng bản giả trong bộ nhớ. */
export interface PosBackend {
  /** Gửi một thao tác lên `sync_push`. Lỗi mạng / lỗi tạm thời ⇒ ném `PosNetworkError`. */
  push(op: WireOp): Promise<PushResult>;
  loadCatalog(profileId: string): Promise<CatalogData>;
  loadOpenState(profileId: string): Promise<OpenState>;
  /** Các khoản nợ (ngày + món) và lần trả của một khách — màn Thu nợ. */
  loadDebtHistory(customerId: string): Promise<DebtHistory>;
  /** Nghe thay đổi của hồ sơ tablet + danh mục. Trả hàm hủy đăng ký. */
  subscribe(profileId: string, onPulse: (scope: PulseScope) => void, onStatus: (s: ChannelStatus) => void): () => void;
}

/** Không tới được server (mất mạng, hết phiên, server lỗi): thao tác CHƯA được ghi, gửi lại an toàn. */
export class PosNetworkError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'PosNetworkError';
  }
}

export function parsePushResult(data: unknown): PushResult {
  const d = data as { status?: unknown; reason?: unknown; order?: Order; shift?: TabletShift } | null;
  if (d?.status === 'ok' || d?.status === 'duplicate') {
    return { status: d.status, ...(d.order ? { order: normalizeOrder(d.order) } : {}), ...(d.shift ? { shift: d.shift } : {}) };
  }
  if (d?.status === 'rejected') return { status: 'rejected', reason: typeof d.reason === 'string' ? d.reason : 'unknown' };
  throw new PosNetworkError(`Phản hồi sync_push không hợp lệ: ${JSON.stringify(data)}`);
}

/** Đơn từ server (`order_json`): chỉ giữ các trường của `Order`, dòng đơn đúng thứ tự. */
function normalizeOrder(o: Order): Order {
  return {
    id: o.id,
    device_seq: o.device_seq,
    tablet_profile_id: o.tablet_profile_id,
    point_id: o.point_id,
    code: o.code,
    label: o.label,
    table_no: o.table_no,
    dine_type: o.dine_type,
    address: o.address ?? null,
    status: o.status,
    opened_shift_id: o.opened_shift_id,
    paid_shift_id: o.paid_shift_id,
    created_at: o.created_at,
    served_at: o.served_at,
    paid_at: o.paid_at,
    deleted_at: o.deleted_at,
    delete_reason: o.delete_reason,
    ship_fee: o.ship_fee ?? 0,
    total: o.total,
    payment_method: o.payment_method,
    cash_given: o.cash_given,
    customer_id: o.customer_id,
    owner_edited: o.owner_edited,
    items: (o.items ?? []).map(({ id, product_id, name_snap, unit_price_snap, qty, toppings_snap }) => ({
      id,
      product_id,
      name_snap,
      unit_price_snap,
      qty,
      toppings_snap,
    })),
  };
}

type RawShift = Omit<TabletShift, 'staff_name'> & { staff: { name: string } | null };
type RawItem = OrderItem & { sort: number; removed_at: string | null };
type RawOrder = Omit<Order, 'items'> & { order_items: RawItem[] };

const ORDER_COLUMNS =
  'id,device_seq,tablet_profile_id,point_id,code,label,table_no,dine_type,address,status,opened_shift_id,paid_shift_id,' +
  'created_at,served_at,paid_at,deleted_at,delete_reason,ship_fee,total,payment_method,cash_given,customer_id,owner_edited,' +
  'order_items(id,product_id,name_snap,unit_price_snap,qty,toppings_snap,sort,removed_at)';

/** Ca đang mở + đơn đang mở, đọc bằng phiên `tablet` (RLS chỉ cho thấy đúng những thứ này của chính hồ sơ). */
export async function loadOpenStateFrom(client: SupabaseClient, profileId: string): Promise<OpenState> {
  const [sRes, oRes] = await Promise.all([
    client
      .from('shifts')
      .select('id,tablet_profile_id,staff_id,opened_at,open_boxes,open_plates,open_float,staff(name)')
      .eq('tablet_profile_id', profileId)
      .eq('status', 'open'),
    client.from('orders').select(ORDER_COLUMNS).eq('tablet_profile_id', profileId).in('status', ['open', 'served']),
  ]);
  if (sRes.error) throw new PosNetworkError(`Không đọc được ca đang mở: ${sRes.error.message}`);
  if (oRes.error) throw new PosNetworkError(`Không đọc được đơn đang mở: ${oRes.error.message}`);
  const raw = (sRes.data as unknown as RawShift[] | null)?.[0];
  const shift: TabletShift | null = raw
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
}

let channelSeq = 0;

export function createSupabaseBackend(client: SupabaseClient): PosBackend {
  const catalogSource = createSupabaseCatalogSource(client);
  return {
    async push(op) {
      let res: Awaited<ReturnType<SupabaseClient['rpc']>>;
      try {
        res = await client.rpc('sync_push', { op });
      } catch (e) {
        throw new PosNetworkError(e instanceof Error ? e.message : String(e));
      }
      if (res.error) throw new PosNetworkError(res.error.message, res.error.code ?? null);
      return parsePushResult(res.data);
    },
    loadCatalog: catalogSource,
    loadOpenState: (profileId) => loadOpenStateFrom(client, profileId),
    async loadDebtHistory(customerId) {
      const { data, error } = await client.rpc('customer_debt_history', { p_customer: customerId });
      if (error) throw new PosNetworkError(`Không tải được lịch sử nợ: ${error.message}`, error.code ?? null);
      if (!data) throw new PosNetworkError('Không tải được lịch sử nợ');
      return data as DebtHistory;
    },
    subscribe(profileId, onPulse, onStatus) {
      const openKey = `profile:${profileId}`;
      onStatus('connecting');
      const ch = client
        .channel(`tablet-live-${profileId}-${++channelSeq}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_pulse' }, (msg) => {
          // DELETE gửi `new = {}` ⇒ lấy khóa ở `old`.
          const key = (msg.new as { key?: string } | null)?.key ?? (msg.old as { key?: string } | null)?.key;
          if (key === openKey) onPulse('open');
          else if (key === 'catalog') onPulse('catalog');
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') onStatus('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus('down');
        });
      return () => void client.removeChannel(ch);
    },
  };
}
