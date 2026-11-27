// Server giả trong bộ nhớ cho test: làm đúng vai `sync_push` + các truy vấn của tablet (theo từng hồ sơ),
// cấp mã đơn + số thứ tự, từ chối khi đơn / ca không còn mở, và báo thay đổi (live_pulse) cho mọi máy đang nghe.
import type { SoldOut } from '@/domain/catalog';
import { generateOrderCode } from '@/domain/orderCode';
import { normalizeOrderWrite, type OrderCustomerPayload, type OrderWriteInput, type RejectReason } from '@/domain/orderWrite';
import { CLOSE_KEY } from '@/pos/ops';
import { businessDate } from '@/domain/time';
import { cleanExpenseNote, normalizeExpenseNote, validateExpense } from '@/domain/expenses';
import type { Customer, Order, OrderItem, ShiftExpense, ShipDefaults, ToppingSnap } from '@/domain/types';
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
  /** Dòng đơn đã ghi (như bảng `order_items`, kể cả dòng đã bỏ khỏi đơn). */
  private itemRows = new Map<string, { order_id: string; item: OrderItem; removed: boolean }>();
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

  // ---------------------------------------------------------------- ghi đơn (như SQL)

  /** Menu của điểm bán; điểm không thuộc quầy ⇒ `point_not_allowed`. Điểm không tồn tại ⇒ không có menu (mọi món `bad_product`). */
  private pointMenu(profileId: string, pointId: string): string | undefined {
    const prof = this.catalog.profile;
    if (prof.id !== profileId || !prof.point_ids.includes(pointId)) throw new Reject('point_not_allowed');
    return this.catalog.points.find((x) => x.id === pointId)?.menu_id;
  }

  /**
   * Phần chung của `op_create_order` / `op_update_order` sau khi kiểm ca / đơn / điểm bán:
   * chuẩn hóa bằng `normalizeOrderWrite` (luật chung với máy), rồi phần chỉ server biết — khách có sẵn hay không,
   * giá / món / topping theo danh mục (`write_items`), tổng. Chỉ ghi (khách, dòng) khi mọi bước đều qua.
   * Khác SQL khi một op sai nhiều chỗ cùng lúc: lỗi món của máy (`empty_items`, `bad_qty`) có thể báo trước lỗi khách.
   */
  private writeOrder(orderId: string, menuId: string | undefined, input: OrderWriteInput, sentTotal: number) {
    const n = normalizeOrderWrite(input);
    if (!n.ok) throw new Reject(n.reason);
    const customer = this.orderCustomer(n.order.customer);
    const lines = this.writeItems(orderId, menuId, n.order.items);
    if (lines.total + n.order.ship_fee !== sentTotal) throw new Reject('total_mismatch');

    if (customer) {
      const found = this.catalog.customers.find((c) => c.id === customer.id);
      if (found) found.address = n.order.address;
      else this.catalog.customers.push({ ...customer, address: n.order.address, merged_into_id: null });
    }
    for (const [id, row] of this.itemRows) if (row.order_id === orderId && !lines.items.some((it) => it.id === id)) row.removed = true;
    for (const it of lines.items) this.itemRows.set(it.id, { order_id: orderId, item: clone(it), removed: false });
    return { order: n.order, customer_id: customer?.id ?? null, items: clone(lines.items) };
  }

  /** Như `private.order_customer`: khách gốc (theo `merged_into_id`), hoặc khách mới cần tên. Chưa ghi gì. */
  private orderCustomer(c: OrderCustomerPayload | null): Omit<Customer, 'address' | 'merged_into_id'> | null {
    if (!c) return null;
    let found = this.catalog.customers.find((x) => x.id === c.id);
    while (found?.merged_into_id) {
      const root: string = found.merged_into_id;
      found = this.catalog.customers.find((x) => x.id === root);
    }
    if (found) return { id: found.id, name: found.name, description: found.description, phone: found.phone };
    if (!c.is_new) throw new Reject('customer_required');
    return { id: c.id, name: c.name, description: c.description, phone: c.phone };
  }

  /**
   * Như `private.write_items`: dòng giữ nguyên (cùng id, cùng món, cùng topping) phải đúng giá đã chụp;
   * dòng mới phải đúng giá hiện hành của danh mục (bản giả không có lịch sử giá) và món / topping còn bán.
   * Tên / topping chụp từ danh mục. Trả dòng sẽ ghi + tổng tính lại; chưa ghi gì.
   */
  private writeItems(orderId: string, menuId: string | undefined, items: readonly OrderItem[]): { items: OrderItem[]; total: number } {
    const seen = new Set<string>();
    const out: OrderItem[] = [];
    let total = 0;
    for (const it of items) {
      if (seen.has(it.id)) throw new Reject('duplicate_item');
      const prod = this.catalog.products.find((x) => x.id === it.product_id);
      if (!prod || prod.menu_id !== menuId) throw new Reject('bad_product');
      const old = this.itemRows.get(it.id);
      if (old && old.order_id !== orderId) throw new Reject('item_id_conflict');
      const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id).sort().join();
      const keep = old && !old.removed && old.item.product_id === prod.id && ids(old.item.toppings_snap) === ids(it.toppings_snap) ? old.item : null;
      if (keep) {
        if (it.unit_price_snap !== keep.unit_price_snap) throw new Reject('price_mismatch');
      } else {
        if (old) throw new Reject('item_id_conflict');
        if (!prod.active) throw new Reject('product_inactive');
        if (it.unit_price_snap !== prod.price) throw new Reject('price_mismatch');
      }
      const toppings: ToppingSnap[] = it.toppings_snap.map((tp) => {
        const top = this.catalog.toppings.find((x) => x.id === tp.id);
        if (!top || top.menu_id !== menuId) throw new Reject('bad_topping');
        if (keep) {
          if (tp.price !== keep.toppings_snap.find((x) => x.id === tp.id)?.price) throw new Reject('price_mismatch');
        } else {
          if (!top.active) throw new Reject('topping_inactive');
          if (tp.price !== top.price) throw new Reject('price_mismatch');
        }
        return { id: top.id, name: top.name, price: tp.price, extra_box: top.extra_box_takeaway };
      });
      out.push(
        keep
          ? { ...clone(keep), qty: it.qty }
          : { id: it.id, product_id: prod.id, name_snap: prod.name, unit_price_snap: it.unit_price_snap, qty: it.qty, toppings_snap: toppings },
      );
      total += (it.unit_price_snap + toppings.reduce((t, x) => t + x.price, 0)) * it.qty;
      seen.add(it.id);
    }
    return { items: out, total };
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
        const { order: o, customer, items } = op.payload;
        const s = this.shifts.find((x) => x.id === o.opened_shift_id && x.tablet_profile_id === profileId);
        if (!s) throw new Reject('bad_shift');
        if (this.order(o.id)) throw new Reject('order_exists');
        if (s.status !== 'open') throw new Reject('shift_not_open');
        const menu = this.pointMenu(profileId, o.point_id);
        if (!this.catalog.points.some((x) => x.id === o.point_id && x.active)) throw new Reject('point_inactive');
        const w = this.writeOrder(o.id, menu, { ...o, customer, items }, o.total);
        const mine = this.orders.filter((x) => x.tablet_profile_id === profileId);
        const { customer: _c, ...fields } = w.order;
        const order: Order = {
          ...fields,
          id: o.id,
          device_seq: mine.reduce((m, x) => Math.max(m, x.device_seq), 0) + 1,
          tablet_profile_id: profileId,
          code: generateOrderCode(new Set(mine.map((x) => x.code))),
          status: 'open',
          opened_shift_id: s.id,
          paid_shift_id: null,
          created_at: now,
          served_at: null,
          paid_at: null,
          deleted_at: null,
          delete_reason: null,
          total: o.total,
          payment_method: null,
          cash_given: null,
          customer_id: w.customer_id,
          owner_edited: false,
          items: w.items,
        };
        this.orders.push(order);
        return { data: { order: clone(order) }, catalog: !!w.customer_id };
      }
      case 'update_order': {
        const u = op.payload;
        const o = open(u.order_id);
        // Như `op_update_order`: điểm bán phải thuộc quầy, nhưng không kiểm điểm còn mở bán.
        const menu = this.pointMenu(profileId, u.point_id);
        const w = this.writeOrder(o.id, menu, u, u.total);
        const { customer: _c, ...fields } = w.order;
        Object.assign(o, { ...fields, customer_id: w.customer_id, items: w.items, total: u.total });
        return { data: { order: clone(o) }, catalog: !!w.customer_id };
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
