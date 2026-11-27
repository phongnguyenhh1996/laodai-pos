// Server giả trong bộ nhớ cho test: làm đúng vai `sync_push` + các truy vấn của tablet (theo từng hồ sơ),
// cấp mã đơn + số thứ tự, từ chối khi đơn / ca không còn mở, và báo thay đổi (live_pulse) cho mọi máy đang nghe.
import type { SoldOut } from '@/domain/catalog';
import { generateOrderCode } from '@/domain/orderCode';
import type { RejectReason } from '@/domain/orderWrite';
import { CLOSE_KEY } from '@/pos/ops';
import { businessDate } from '@/domain/time';
import { cleanExpenseNote, normalizeExpenseNote, validateExpense } from '@/domain/expenses';
import type { Customer, Order, OrderItem, ShiftExpense, ShipDefaults, ShipMode } from '@/domain/types';
import {
  PosNetworkError,
  type CatalogData,
  type ChannelStatus,
  type OpenState,
  type PosBackend,
  type PulseScope,
  type PushResult,
  type TabletShift,
  type OpKind,
  type WireOp,
} from '@/pos';

type ServerShift = TabletShift & { status: 'open' | 'closed'; close?: Record<string, unknown> };

const clone = <T>(v: T): T => structuredClone(v);

class Reject extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}

export class FakeServer {
  catalog: CatalogData;
  shifts: ServerShift[] = [];
  orders: Order[] = [];
  /** Khoản chi (như bảng `shift_expenses`). */
  expenses: ShiftExpense[] = [];
  debtPayments: Array<{ id: string; customer_id: string; amount: number; method: 'cash' | 'transfer'; at: string }> = [];
  /** Thao tác server đã nhận (không tính lần gửi lại), theo thứ tự. */
  ops: WireOp[] = [];

  /** Thao tác `kind` gửi gần nhất (để test đọc payload có kiểu). Chưa có ⇒ ném. */
  lastOp<K extends OpKind>(kind: K): Extract<WireOp, { kind: K }> {
    const op = this.ops.filter((x): x is Extract<WireOp, { kind: K }> => x.kind === kind).at(-1);
    if (!op) throw new Error(`Chưa có thao tác ${kind}`);
    return op;
  }
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
      loadDebtHistory: async (customerId) => {
        this.net();
        return clone({
          orders: this.orders
            .filter((o) => o.status === 'paid' && o.payment_method === 'debt' && o.customer_id === customerId)
            .map((o) => ({
              id: o.id,
              code: o.code,
              paid_at: o.paid_at!,
              total: o.total,
              items: o.items.map((i) => ({ name: i.name_snap, qty: i.qty, toppings: i.toppings_snap.map((t) => t.name) })),
            })),
          payments: this.debtPayments
            .filter((p) => p.customer_id === customerId)
            .map(({ id, at, amount, method }) => ({ id, at, amount, method })),
        });
      },
      loadShipDefaults: async (shiftId) => {
        this.net();
        return this.shipDefaults(profileId, shiftId);
      },
      loadRecentExpenseNotes: async () => {
        this.net();
        return this.recentExpenseNotes();
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
          open_cans: s.open_cans,
          open_float: s.open_float,
          count_items: [...s.count_items],
        }
      : null;
    return clone({ shift, orders: this.openOrders(profileId), expenses: s ? this.expenses.filter((e) => e.shift_id === s.id) : [] });
  }

  /** Như RPC `recent_expense_notes`: ≤ 8 nhóm ghi chú chưa hủy, xếp theo số lần rồi lần gần nhất; bản viết gần nhất. */
  recentExpenseNotes(): string[] {
    const groups = new Map<string, { note: string; n: number; last: string }>();
    for (const e of this.expenses) {
      if (e.voided_at) continue;
      const k = normalizeExpenseNote(e.note);
      const g = groups.get(k) ?? { note: e.note, n: 0, last: '' };
      g.n += 1;
      if (e.at >= g.last) Object.assign(g, { note: e.note, last: e.at });
      groups.set(k, g);
    }
    return [...groups.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, 8).map((g) => g.note);
  }

  /** Chủ ghi khoản chi (như `owner_create_expense`) — để test thấy nhãn "Chủ ghi". */
  ownerExpense(amount: number, note: string, profileId = this.catalog.profile.id): ShiftExpense {
    const s = this.openShift(profileId)!;
    const e: ShiftExpense = { id: crypto.randomUUID(), shift_id: s.id, amount, note, actor_kind: 'owner', staff_id: null, at: new Date().toISOString(), voided_at: null, void_actor_kind: null };
    this.expenses.push(e);
    this.pulse('open', profileId);
    return clone(e);
  }

  /** Như RPC `shift_ship_defaults`: đơn ship gần nhất của ca (kể cả đã thanh toán, trừ đã xóa); quầy khác bị chặn. */
  shipDefaults(profileId: string, shiftId: string): ShipDefaults | null {
    const s = this.shifts.find((x) => x.id === shiftId);
    if (!s || s.tablet_profile_id !== profileId) throw new PosNetworkError('forbidden', '42501');
    const last = this.orders
      .filter((o) => o.opened_shift_id === shiftId && o.dine_type === 'delivery' && o.status !== 'deleted')
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.device_seq - a.device_seq)[0];
    return last ? { ship_mode: last.ship_mode, ship_fee: last.ship_fee, ship_payout: last.ship_payout } : null;
  }

  openOrders(profileId = this.catalog.profile.id): Order[] {
    return this.orders.filter((o) => o.tablet_profile_id === profileId && (o.status === 'open' || o.status === 'served'));
  }

  /** Khách của đơn ship (như `private.order_customer`): tạo khách mới nếu chưa có, lưu địa chỉ giao gần nhất. */
  private shipCustomer(dine_type: string, address: string | null, raw: unknown): string | null {
    if (dine_type !== 'delivery' || !address || !raw) return null;
    const c = raw as { id: string; name?: string; description?: string | null; phone?: string | null };
    const found = this.catalog.customers.find((x) => x.id === c.id);
    if (found) {
      found.address = address;
      return found.id;
    }
    if (!c.name?.trim()) throw new Reject('customer_required');
    this.catalog.customers.push({
      id: c.id,
      name: c.name.trim(),
      description: c.description ?? null,
      phone: c.phone ?? null,
      address,
      merged_into_id: null,
    });
    return c.id;
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
      const e = op.kind.endsWith('_expense') ? this.expenses.find((x) => x.id === op.entity_id) : undefined;
      if (e) return { status: 'duplicate', expense: clone(e) };
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
      res = { status: 'rejected', reason: e.reason };
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

  private apply(profileId: string, op: WireOp): { data?: { order?: Order; shift?: TabletShift; expense?: ShiftExpense }; catalog?: boolean } {
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
    /** Như `private.order_ship_fee`. */
    const shipFee = (x: Record<string, unknown>) => {
      const v = (x.ship_fee as number | undefined) ?? 0;
      if (!Number.isInteger(v) || v < 0) throw new Reject('bad_ship_fee');
      if (x.dine_type !== 'delivery') return 0;
      if (v > 50_000 || v % 1000 !== 0) throw new Reject('bad_ship_fee');
      return v;
    };
    /** Như `private.order_ship_mode` / `private.order_ship_payout`. */
    const ship = (x: Record<string, unknown>): { ship_mode: ShipMode; ship_payout: number } => {
      if (x.dine_type !== 'delivery') return { ship_mode: 'shop', ship_payout: 0 };
      const mode = (x.ship_mode as string | undefined) || 'shop';
      if (mode !== 'shop' && mode !== 'external') throw new Reject('bad_ship_mode');
      if (mode === 'shop') return { ship_mode: 'shop', ship_payout: 0 };
      const v = x.ship_payout;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1000 || v > 50_000 || v % 1000 !== 0) throw new Reject('bad_ship_payout');
      return { ship_mode: 'external', ship_payout: v };
    };

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
          open_cans: prof.default_cans,
          open_float: prof.default_float,
          count_items: [...prof.count_items],
          status: 'open',
        };
        this.shifts.push(s);
        return { data: { shift: this.openState(profileId).shift! } };
      }
      case 'close_shift': {
        const s = shift();
        if (s.id !== p.shift_id) throw new Reject('bad_shift');
        s.status = 'closed';
        // Như `private.op_close_shift`: chỉ giữ (và đòi) số của các thứ ca này đếm.
        s.close = { closed_at: now };
        for (const item of s.count_items) {
          const k = CLOSE_KEY[item];
          const v = p[k];
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Reject(`bad_${k}`);
          s.close[k] = v;
        }
        return {};
      }
      case 'create_order': {
        const s = shift();
        const o = p.order as Record<string, unknown>;
        const items = p.items as OrderItem[];
        if (s.id !== o.opened_shift_id) throw new Reject('bad_shift');
        if (!items?.length) throw new Reject('empty_items');
        const ship_fee = shipFee(o);
        const sm = ship(o);
        if (total(items) + ship_fee !== o.total) throw new Reject('total_mismatch');
        if (o.dine_type === 'delivery' && !o.address) throw new Reject('address_required');
        if (this.order(o.id as string)) throw new Reject('order_exists');
        const customer_id = this.shipCustomer(o.dine_type as string, (o.address as string | null) ?? null, p.customer);
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
          ship_fee,
          ...sm,
          total: o.total as number,
          payment_method: null,
          cash_given: null,
          customer_id,
          owner_edited: false,
          items: clone(items),
        };
        this.orders.push(order);
        return { data: { order: clone(order) }, catalog: !!customer_id };
      }
      case 'update_order': {
        const o = open(p.order_id);
        const items = p.items as OrderItem[];
        const ship_fee = shipFee(p);
        const sm = ship(p);
        if (total(items) + ship_fee !== p.total) throw new Reject('total_mismatch');
        if (p.dine_type === 'delivery' && !p.address) throw new Reject('address_required');
        const customer_id = this.shipCustomer(p.dine_type as string, p.address as string | null, p.customer);
        Object.assign(o, {
          point_id: p.point_id,
          dine_type: p.dine_type,
          address: p.address ?? null,
          customer_id,
          label: p.label ?? null,
          table_no: p.table_no ?? null,
          items: clone(items),
          ship_fee,
          ...sm,
          total: p.total,
        });
        return { data: { order: clone(o) }, catalog: !!customer_id };
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
        let customer_id: string | null = o.customer_id;
        if (p.method === 'cash' && (p.cash_given as number) < o.total) throw new Reject('cash_short');
        if (p.method === 'debt') {
          const c = p.customer as Customer & { is_new: boolean };
          if (!this.catalog.customers.some((x) => x.id === c.id)) {
            this.catalog.customers.push({ id: c.id, name: c.name, description: c.description, phone: c.phone, address: o.address, merged_into_id: null });
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
        this.debtPayments.push({ id: p.id as string, customer_id: id, amount: p.amount as number, method: p.method as 'cash' | 'transfer', at: new Date().toISOString() });
        return { catalog: true };
      }
      case 'create_expense': {
        const s = shift();
        if (s.id !== p.shift_id) throw new Reject('shift_not_open');
        const amount = typeof p.amount === 'number' ? p.amount : null;
        const problem = validateExpense(amount, typeof p.note === 'string' ? p.note : '');
        if (problem) throw new Reject(problem);
        if (this.expenses.some((e) => e.id === p.id)) throw new Reject('expense_exists');
        const e: ShiftExpense = {
          id: p.id as string, shift_id: s.id, amount: amount!, note: cleanExpenseNote(p.note as string), actor_kind: 'staff',
          staff_id: s.staff_id, at: now, voided_at: null, void_actor_kind: null,
        };
        this.expenses.push(e);
        return { data: { expense: clone(e) } };
      }
      case 'void_expense': {
        const e = this.expenses.find((x) => x.id === p.expense_id);
        const s = e && this.shifts.find((x) => x.id === e.shift_id);
        if (!e || !s || s.tablet_profile_id !== profileId || s.status !== 'open' || e.actor_kind !== 'staff') throw new Reject('expense_not_voidable');
        if (!e.voided_at) Object.assign(e, { voided_at: now, void_actor_kind: 'staff' });
        return { data: { expense: clone(e) } };
      }
      case 'set_sold_out': {
        shift();
        const point = p.point_id as string;
        if (!this.catalog.profile.point_ids.includes(point)) throw new Reject('point_not_allowed');
        const kind = p.item_kind as 'product' | 'topping';
        const day = businessDate(new Date(), this.catalog.config.timezone);
        const same = (r: SoldOut) => r.point_id === point && r.item_kind === kind && r.item_id === p.item_id && r.day === day;
        const rest = (this.catalog.sold_out ?? []).filter((r) => !same(r));
        this.catalog.sold_out = p.sold_out ? [...rest, { point_id: point, item_kind: kind, item_id: p.item_id as string, day, at: now }] : rest;
        return { catalog: true };
      }
    }
  }
}
