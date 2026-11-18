// Server giả trong bộ nhớ cho test: làm đúng vai `sync_push` + các truy vấn của tablet (theo từng hồ sơ),
// cấp mã đơn + số thứ tự, từ chối khi đơn / ca không còn mở, và báo thay đổi (live_pulse) cho mọi máy đang nghe.
import { generateOrderCode } from '@/domain/orderCode';
import type { Customer, Order, OrderItem } from '@/domain/types';
import {
  PosNetworkError,
  type CatalogData,
  type ChannelStatus,
  type OpenState,
  type PosBackend,
  type PulseScope,
  type PushResult,
  type TabletShift,
  type WireOp,
} from '@/pos';

type ServerShift = TabletShift & { status: 'open' | 'closed'; close?: Record<string, unknown> };

const clone = <T>(v: T): T => structuredClone(v);

class Reject extends Error {}

export class FakeServer {
  catalog: CatalogData;
  shifts: ServerShift[] = [];
  orders: Order[] = [];
  /** Thao tác server đã nhận (không tính lần gửi lại), theo thứ tự. */
  ops: WireOp[] = [];
  /** Mất mạng: mọi lời gọi ném lỗi mạng. */
  offline = false;
  /** Tải danh mục lỗi (vd. phiên tablet hết hạn). */
  catalogFails = false;
  /** Lời gọi push tiếp theo được server ghi nhưng phản hồi bị mất (ném lỗi mạng sau khi đã ghi). */
  dropNextResponse = false;
  private results = new Map<string, PushResult>();
  private listeners = new Set<{ profileId: string; onPulse: (s: PulseScope) => void }>();

  constructor(catalog: CatalogData) {
    this.catalog = clone(catalog);
  }

  /** Một máy (phiên tablet) của hồ sơ `profileId`. */
  device(profileId = this.catalog.profile.id): PosBackend {
    return {
      push: (op) => this.push(profileId, op),
      loadCatalog: async () => {
        this.net();
        if (this.catalogFails) throw new PosNetworkError('Không tải được danh mục');
        return clone(this.catalog);
      },
      loadOpenState: async () => {
        this.net();
        return this.openState(profileId);
      },
      subscribe: (pid, onPulse, onStatus: (s: ChannelStatus) => void) => {
        const l = { profileId: pid, onPulse };
        this.listeners.add(l);
        queueMicrotask(() => onStatus('live'));
        return () => this.listeners.delete(l);
      },
    };
  }

  openState(profileId = this.catalog.profile.id): OpenState {
    const s = this.shifts.find((x) => x.tablet_profile_id === profileId && x.status === 'open');
    const shift: TabletShift | null = s
      ? {
          id: s.id,
          tablet_profile_id: s.tablet_profile_id,
          staff_id: s.staff_id,
          staff_name: s.staff_name,
          opened_at: s.opened_at,
          open_boxes: s.open_boxes,
          open_plates: s.open_plates,
          open_float: s.open_float,
        }
      : null;
    return clone({ shift, orders: this.openOrders(profileId) });
  }

  openOrders(profileId = this.catalog.profile.id): Order[] {
    return this.orders.filter((o) => o.tablet_profile_id === profileId && (o.status === 'open' || o.status === 'served'));
  }

  order(id: string): Order | undefined {
    return this.orders.find((o) => o.id === id);
  }

  openShift(profileId = this.catalog.profile.id): ServerShift | undefined {
    return this.shifts.find((x) => x.tablet_profile_id === profileId && x.status === 'open');
  }

  /** Báo thay đổi cho mọi máy đang nghe (như trigger live_pulse). */
  pulse(scope: PulseScope, profileId = this.catalog.profile.id): void {
    for (const l of this.listeners) if (scope === 'catalog' || l.profileId === profileId) l.onPulse(scope);
  }

  get kinds(): string[] {
    return this.ops.map((o) => o.kind);
  }

  // ---------------------------------------------------------------- sync_push

  private net(): void {
    if (this.offline) throw new PosNetworkError('Failed to fetch');
  }

  private async push(profileId: string, op: WireOp): Promise<PushResult> {
    this.net();
    const prev = this.results.get(op.op_id);
    if (prev) {
      if (prev.status === 'rejected') return prev;
      const o = this.order(op.entity_id);
      return {
        status: 'duplicate',
        ...(o && (o.status === 'open' || o.status === 'served') && op.kind.endsWith('_order') && op.kind !== 'pay_order' && op.kind !== 'delete_order'
          ? { order: clone(o) }
          : {}),
      };
    }
    let res: PushResult;
    let scopes: PulseScope[] = ['open'];
    try {
      const out = this.apply(profileId, op);
      res = { status: 'ok', ...out.data };
      if (out.catalog) scopes = ['open', 'catalog'];
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      res = { status: 'rejected', reason: e.message };
      scopes = [];
    }
    this.results.set(op.op_id, res.status === 'rejected' ? res : { status: 'ok' });
    this.ops.push(clone(op));
    for (const s of scopes) this.pulse(s, profileId);
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      throw new PosNetworkError('Failed to fetch');
    }
    return clone(res);
  }

  private apply(profileId: string, op: WireOp): { data?: { order?: Order; shift?: TabletShift }; catalog?: boolean } {
    const p = op.payload as Record<string, unknown>;
    const now = new Date().toISOString();
    const shift = () => {
      const s = this.openShift(profileId);
      if (!s) throw new Reject('shift_not_open');
      return s;
    };
    const open = (id: unknown) => {
      const o = this.orders.find((x) => x.id === id && x.tablet_profile_id === profileId);
      if (!o) throw new Reject('order_not_found');
      if (o.status !== 'open' && o.status !== 'served') throw new Reject('order_not_open');
      return o;
    };
    const total = (items: OrderItem[]) => items.reduce((s, it) => s + (it.unit_price_snap + it.toppings_snap.reduce((t, x) => t + x.price, 0)) * it.qty, 0);

    switch (op.kind) {
      case 'open_shift': {
        if (this.openShift(profileId)) throw new Reject('shift_already_open');
        const staff = this.catalog.staff.find((s) => s.id === p.staff_id && s.active);
        if (!staff) throw new Reject('bad_staff');
        const prof = this.catalog.profile;
        const s: ServerShift = {
          id: p.shift_id as string,
          tablet_profile_id: profileId,
          staff_id: staff.id,
          staff_name: staff.name,
          opened_at: now,
          open_boxes: prof.default_boxes,
          open_plates: prof.default_plates,
          open_float: prof.default_float,
          status: 'open',
        };
        this.shifts.push(s);
        return { data: { shift: this.openState(profileId).shift! } };
      }
      case 'close_shift': {
        const s = shift();
        if (s.id !== p.shift_id) throw new Reject('bad_shift');
        s.status = 'closed';
        s.close = { boxes_left: p.boxes_left, plates_left: p.plates_left, cash_counted: p.cash_counted, closed_at: now };
        return {};
      }
      case 'create_order': {
        const s = shift();
        const o = p.order as Record<string, unknown>;
        const items = p.items as OrderItem[];
        if (s.id !== o.opened_shift_id) throw new Reject('bad_shift');
        if (!items?.length) throw new Reject('empty_items');
        if (total(items) !== o.total) throw new Reject('total_mismatch');
        if (o.dine_type === 'delivery' && !o.address) throw new Reject('address_required');
        if (this.order(o.id as string)) throw new Reject('order_exists');
        const mine = this.orders.filter((x) => x.tablet_profile_id === profileId);
        const order: Order = {
          id: o.id as string,
          device_seq: mine.reduce((m, x) => Math.max(m, x.device_seq), 0) + 1,
          tablet_profile_id: profileId,
          point_id: o.point_id as string,
          code: generateOrderCode(new Set(mine.map((x) => x.code))),
          label: (o.label as string | null) ?? null,
          table_no: (o.table_no as string | null) ?? null,
          dine_type: o.dine_type as Order['dine_type'],
          address: (o.address as string | null) ?? null,
          status: 'open',
          opened_shift_id: s.id,
          paid_shift_id: null,
          created_at: now,
          served_at: null,
          paid_at: null,
          deleted_at: null,
          delete_reason: null,
          total: o.total as number,
          payment_method: null,
          cash_given: null,
          customer_id: null,
          owner_edited: false,
          items: clone(items),
        };
        this.orders.push(order);
        return { data: { order: clone(order) } };
      }
      case 'update_order': {
        const o = open(p.order_id);
        const items = p.items as OrderItem[];
        if (total(items) !== p.total) throw new Reject('total_mismatch');
        if (p.dine_type === 'delivery' && !p.address) throw new Reject('address_required');
        Object.assign(o, {
          point_id: p.point_id,
          dine_type: p.dine_type,
          address: p.address ?? null,
          label: p.label ?? null,
          table_no: p.table_no ?? null,
          items: clone(items),
          total: p.total,
        });
        return { data: { order: clone(o) } };
      }
      case 'serve_order': {
        const o = open(p.order_id);
        if (o.status !== 'open') throw new Reject('already_served');
        Object.assign(o, { status: 'served', served_at: now });
        return { data: { order: clone(o) } };
      }
      case 'delete_order': {
        const o = open(p.order_id);
        Object.assign(o, { status: 'deleted', deleted_at: now, delete_reason: p.reason });
        return {};
      }
      case 'pay_order': {
        const o = open(p.order_id);
        const s = shift();
        if (p.total !== o.total) throw new Reject('total_mismatch');
        let customer_id: string | null = null;
        if (p.method === 'cash' && (p.cash_given as number) < o.total) throw new Reject('cash_short');
        if (p.method === 'debt') {
          const c = p.customer as Customer & { is_new: boolean };
          if (!this.catalog.customers.some((x) => x.id === c.id)) {
            this.catalog.customers.push({ id: c.id, name: c.name, description: c.description, phone: c.phone, merged_into_id: null });
          }
          customer_id = c.id;
          this.catalog.balances[c.id] = (this.catalog.balances[c.id] ?? 0) + o.total;
        }
        Object.assign(o, {
          status: 'paid',
          paid_at: now,
          paid_shift_id: s.id,
          payment_method: p.method,
          cash_given: p.method === 'cash' ? p.cash_given : null,
          customer_id,
        });
        return { catalog: p.method === 'debt' };
      }
      case 'debt_payment': {
        shift();
        const id = p.customer_id as string;
        if (!this.catalog.customers.some((c) => c.id === id)) throw new Reject('bad_customer');
        this.catalog.balances[id] = (this.catalog.balances[id] ?? 0) - (p.amount as number);
        return { catalog: true };
      }
    }
  }
}
