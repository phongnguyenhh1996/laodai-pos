import { v7 as uuidv7 } from 'uuid';
import type { SoldOut } from '@/domain/catalog';
import { canConfirmCash } from '@/domain/cash';
import { businessDate } from '@/domain/time';
import { cleanExpenseNote, validateExpense } from '@/domain/expenses';
import type { CountItem, DeleteReason, DineType, Money, Order, OrderItem, ShiftExpense, ShipDefaults, ShipMode } from '@/domain/types';
import { PosNetworkError } from './backend';
import type { TabletStore } from './store';
import { SHIP_MESSAGES, createOrderPayload, normalizeOrderWrite, updateOrderPayload } from '@/domain/orderWrite';
import type { OrderCustomerInput, OrderWriteFields, OrderWriteInput, RejectReason } from '@/domain/orderWrite';
import type { CloseKey, DebtCustomerPayload, OpKind, OpPayloads, PushResult, TabletShift, WireOp, WireOpOf } from './types';

/** Thứ cần đếm ⇒ khóa số gửi lên khi đóng ca. */
export const CLOSE_KEY = { cash: 'cash_counted', boxes: 'boxes_left', plates: 'plates_left', cans: 'cans_left' } as const satisfies Record<CountItem, CloseKey>;

/**
 * Thao tác của tablet: kiểm tra tại máy (để báo lỗi ngay), rồi ghi thẳng lên server qua `sync_push`.
 * Chỉ coi là xong khi server trả lời; kết quả (đơn / ca) được đưa ngay vào `TabletStore`.
 * Không có hàng đợi offline: mất mạng thì báo lỗi, nhân viên bấm lại khi có mạng.
 */

/** Lỗi nghiệp vụ / mạng để hiện cho nhân viên (thông điệp tiếng Việt). */
export class PosError extends Error {
  constructor(
    message: string,
    /** Lý do từ chối: của server, hoặc kiểm tại máy theo cùng luật (null khi lỗi mạng / lỗi khác). */
    readonly reason: RejectReason | null = null,
  ) {
    super(message);
    this.name = 'PosError';
  }
}

export const OFFLINE_MESSAGE = 'Không lưu được: mất kết nối máy chủ. Kiểm tra mạng rồi bấm lại.';

const REJECT_MESSAGES: Partial<Record<RejectReason, string>> = {
  order_not_open: 'Đơn này đã được thanh toán hoặc xóa (có thể ở máy khác).',
  order_not_found: 'Không tìm thấy đơn (có thể đã bị xóa ở máy khác).',
  already_served: 'Đơn đã ra món.',
  shift_already_open: 'Tablet đã có ca đang mở (có thể vừa mở ở máy khác).',
  shift_not_open: 'Ca đã đóng (có thể ở máy khác).',
  bad_shift: 'Ca không còn mở (có thể đã đóng ở máy khác).',
  price_mismatch: 'Giá món vừa được chủ thay đổi. Kiểm tra lại đơn.',
  total_mismatch: 'Giá món vừa được chủ thay đổi. Kiểm tra lại đơn.',
  product_inactive: 'Có món vừa ngừng bán. Kiểm tra lại đơn.',
  topping_inactive: 'Có topping vừa ngừng bán. Kiểm tra lại đơn.',
  point_not_allowed: 'Điểm bán không còn thuộc tablet này.',
  point_inactive: 'Điểm bán đã ngừng.',
  address_required: 'Đơn ship cần địa chỉ',
  ...SHIP_MESSAGES,
  cash_short: 'Khách đưa chưa đủ tiền',
  customer_required: 'Cần tên khách',
  bad_customer: 'Không tìm thấy khách nợ.',
  bad_staff: 'Nhân viên không còn làm.',
  empty_items: 'Đơn chưa có món',
  bad_qty: 'Số lượng món không hợp lệ.',
  bad_dine_type: 'Loại đơn không hợp lệ.',
  bad_item: 'Món này không còn trong menu của điểm bán.',
  bad_expense_amount: 'Số tiền chi phải lớn hơn 0.',
  bad_expense_note: 'Cần ghi chú (tối đa 80 ký tự).',
  expense_not_voidable: 'Không hủy được khoản này (chủ ghi, hoặc ca đã đóng).',
  expense_exists: 'Khoản chi này đã được ghi.',
};

export function rejectMessage(reason: RejectReason): string {
  return REJECT_MESSAGES[reason] ?? `Máy chủ từ chối thao tác (${reason}).`;
}

/** Dựng thao tác mới (op_id mới) cho một `kind`. */
function wireOp<K extends OpKind>(kind: K, entity_id: string, payload: OpPayloads[K]): WireOp {
  const op: WireOpOf<K> = { op_id: uuidv7(), kind, entity_id, payload };
  // `WireOpOf<K>` với K cụ thể luôn là một nhánh của `WireOp`; TS không tự thu hẹp được K tổng quát.
  return op as WireOp;
}

const OPEN_STATUSES = new Set(['open', 'served']);

/** Kiểm tại máy (cùng luật server, `domain/orderWrite.ts`): lỗi ⇒ cùng câu như khi server từ chối. */
function normalized(input: OrderWriteInput): OrderWriteFields {
  const r = normalizeOrderWrite(input);
  if (!r.ok) throw new PosError(rejectMessage(r.reason), r.reason);
  return r.order;
}

/** Khách đơn ship: id có sẵn, hoặc khách mới (`is_new`, server tạo cùng lúc lưu đơn). */
export type OrderCustomer = OrderCustomerInput;

export interface OrderDraft {
  /** Id đơn do màn đơn giữ cố định: bấm lại sau lỗi mạng không tạo đơn thứ hai. */
  id?: string;
  point_id: string;
  dine_type: DineType;
  label?: string | null;
  table_no?: string | null;
  /** Chỉ đơn ship (bắt buộc); loại khác bị bỏ khi gửi. */
  address?: string | null;
  /** Chỉ đơn ship; loại khác bị bỏ khi gửi. */
  customer?: OrderCustomer | null;
  /** Phí ship / phụ thu (chỉ đơn ship), cộng vào tổng. */
  ship_fee?: Money;
  /** Kiểu ship (chỉ đơn ship); thiếu ⇒ quán ship. */
  ship_mode?: ShipMode;
  /** Tiền trả shipper ngoài (bắt buộc khi `external`); KHÔNG cộng vào tổng. */
  ship_payout?: Money;
  items: OrderItem[];
}

export type PaymentInput =
  | { method: 'cash'; cash_given: Money }
  | { method: 'transfer' }
  | {
      method: 'debt';
      customer: { id?: string; name: string; description?: string | null; phone?: string | null };
    };

type Ok = Extract<PushResult, { status: 'ok' | 'duplicate' }>;

/** Thao tác đã được server ghi (để in phiếu bếp / bill — SPEC mục 12). Lỗi trong người nghe không ảnh hưởng thao tác. */
export type PosEvent =
  | { type: 'order_created'; order: Order }
  | { type: 'order_updated'; before: Order; after: Order }
  | { type: 'order_paid'; order: Order }
  | { type: 'order_deleted'; order: Order };

export interface PosOptions {
  /** Chờ trước mỗi lần gửi lại khi lỗi mạng (cùng op_id ⇒ server không ghi hai lần). */
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Pos {
  /** Có thể đổi (vd. test đặt [0, 0] để không phải chờ). */
  retryDelaysMs: number[];
  sleep: (ms: number) => Promise<void>;
  /**
   * Thao tác gửi lỗi mạng (có thể server đã ghi mà mất phản hồi). Bấm lại đúng thao tác đó ⇒ dùng lại op_id
   * (và id khoản thu / ca) để server trả "đã nhận" thay vì ghi lần hai.
   */
  private unsure = new Map<string, { op: WireOp; body: string }>();
  private listeners = new Set<(e: PosEvent) => void>();
  /** Mặc định đơn ship lần đọc gần nhất (theo ca): dùng ngay khi mở đơn mới, và khi mất mạng. */
  private shipCache: { shiftId: string; orderId: string | null; value: ShipDefaults | null } | null = null;

  constructor(
    private store: TabletStore,
    opts: PosOptions = {},
  ) {
    this.retryDelaysMs = opts.retryDelaysMs ?? [400, 1500];
    this.sleep = opts.sleep ?? realSleep;
  }

  /** Nghe các thao tác vừa ghi xong. Trả hàm hủy. */
  onEvent(fn: (e: PosEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: PosEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.warn('Lỗi khi xử lý sự kiện bán hàng', err);
      }
    }
  }

  /** Quên các thao tác còn chờ bấm lại (đổi máy / trong test). */
  reset(): void {
    this.unsure.clear();
    this.shipCache = null;
  }

  /** Mặc định đơn ship đã biết của ca đang mở (không gọi server). */
  cachedShipDefaults(): ShipDefaults | null {
    const s = this.store.getSnapshot().open?.shift;
    return s && this.shipCache?.shiftId === s.id ? this.shipCache.value : null;
  }

  /**
   * Mặc định cho đơn ship mới = đơn ship gần nhất của ca, đọc từ server (mọi máy cùng quầy thấy giống nhau;
   * tablet không đọc được đơn đã thanh toán nên phải hỏi RPC). Lỗi mạng ⇒ dùng bản đã biết.
   */
  async shipDefaults(): Promise<ShipDefaults | null> {
    const s = this.store.getSnapshot().open?.shift;
    if (!s) return null;
    try {
      const value = await this.store.api.loadShipDefaults(s.id);
      this.shipCache = { shiftId: s.id, orderId: null, value };
      return value;
    } catch {
      return this.cachedShipDefaults();
    }
  }

  /**
   * Vừa lưu đơn ship ⇒ cập nhật mặc định ngay (không chờ server): đơn mới tạo là đơn ship gần nhất của ca;
   * sửa thì chỉ tính khi đó chính là đơn ship gần nhất máy này biết. Lần mở đơn mới sau vẫn hỏi lại server.
   */
  private rememberShip(o: Order, created: boolean): void {
    if (o.dine_type !== 'delivery') return;
    if (!created && (this.shipCache?.shiftId !== o.opened_shift_id || this.shipCache.orderId !== o.id)) return;
    const value = { ship_mode: o.ship_mode, ship_fee: o.ship_fee, ship_payout: o.ship_payout };
    this.shipCache = { shiftId: o.opened_shift_id, orderId: o.id, value };
  }

  // ---------------------------------------------------------------- đọc

  private shift(): TabletShift {
    const s = this.store.getSnapshot().open?.shift;
    if (!s) throw new PosError('Chưa mở ca');
    return s;
  }

  private openOrder(orderId: string): Order {
    const o = this.store.getSnapshot().open?.orders.find((x) => x.id === orderId);
    if (!o || !OPEN_STATUSES.has(o.status)) throw new PosError('Đơn không còn mở');
    return o;
  }

  // ---------------------------------------------------------------- gửi

  /** `intent`: khóa của thao tác theo ý người bấm (để nhận ra lần bấm lại sau lỗi mạng). */
  private async send<K extends OpKind>(kind: K, intent: string, build: () => { entity_id: string; payload: OpPayloads[K] }): Promise<Ok> {
    const key = `${kind}:${intent}`;
    const fresh = build();
    const body = JSON.stringify(fresh.payload);
    const prev = this.unsure.get(key);
    const op = prev && prev.body === body ? prev.op : wireOp(kind, fresh.entity_id, fresh.payload);

    let res: PushResult | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      if (attempt > 0) await this.sleep(this.retryDelaysMs[attempt - 1]);
      try {
        res = await this.store.api.push(op);
        break;
      } catch (e) {
        if (!(e instanceof PosNetworkError)) throw e;
        lastErr = e;
      }
    }
    if (!res) {
      this.unsure.set(key, { op, body });
      this.store.reportError(lastErr);
      void this.store.refreshOpen();
      throw new PosError(OFFLINE_MESSAGE);
    }
    this.unsure.delete(key);
    this.store.reportOk();
    if (res.status === 'rejected') {
      // Máy khác vừa đổi (thanh toán, xóa, đóng ca…) hoặc chủ vừa đổi giá ⇒ lấy lại dữ liệu mới nhất.
      void this.store.refresh();
      throw new PosError(rejectMessage(res.reason), res.reason);
    }
    return res;
  }

  /** Chỉ dùng lại id cũ khi lần trước mất phản hồi và đúng thao tác đó được bấm lại. */
  private reuseId(kind: OpKind, intent: string): string {
    return this.unsure.get(`${kind}:${intent}`)?.op.entity_id ?? uuidv7();
  }

  // ---------------------------------------------------------------- ca

  async openShift(input: { staff_id: string }): Promise<TabletShift> {
    if (this.store.getSnapshot().open?.shift) throw new PosError('Tablet đang có ca mở');
    const intent = input.staff_id;
    const id = this.reuseId('open_shift', intent);
    const res = await this.send('open_shift', intent, () => ({
      entity_id: id,
      payload: { shift_id: id, staff_id: input.staff_id },
    }));
    if (!res.shift) {
      await this.store.refreshOpen();
      const s = this.store.getSnapshot().open?.shift;
      if (!s) throw new PosError('Không mở được ca, thử lại.');
      return s;
    }
    this.store.setShift(res.shift);
    return res.shift;
  }

  /**
   * Đếm mù: chỉ ghi số nhân viên đếm. Không trả về số kỳ vọng / chênh lệch.
   * Chỉ gửi (và bắt buộc) các thứ ca này đếm (`shift.count_items`).
   */
  async closeShift(counts: { boxes_left?: number; plates_left?: number; cans_left?: number; cash_counted?: Money }): Promise<void> {
    const shift = this.shift();
    const input: Partial<Record<CloseKey, number>> = {};
    for (const item of shift.count_items) {
      const k = CLOSE_KEY[item];
      const v = counts[k];
      if (v === undefined || !Number.isInteger(v) || v < 0) throw new PosError(`Số không hợp lệ: ${k}`);
      input[k] = v;
    }
    await this.send('close_shift', shift.id, () => ({ entity_id: shift.id, payload: { shift_id: shift.id, ...input } }));
    this.store.setShift(null);
  }

  // ---------------------------------------------------------------- đơn

  /** Tạo đơn: server cấp mã đơn + số thứ tự (không trùng giữa các máy cùng hồ sơ). */
  async createOrder(draft: OrderDraft): Promise<Order> {
    const fields = normalized(draft);
    const shift = this.shift();
    const id = draft.id ?? uuidv7();
    const payload = createOrderPayload(fields, { id, opened_shift_id: shift.id });
    const res = await this.send('create_order', id, () => ({ entity_id: id, payload }));
    const created = await this.applied(res, id, !!fields.customer?.is_new);
    this.rememberShip(created, true);
    this.emit({ type: 'order_created', order: created });
    return created;
  }

  /** Sửa đơn đang mở: gửi lại toàn bộ đơn (phần không đổi lấy từ đơn đang có). */
  async updateOrder(
    orderId: string,
    changes: Partial<Pick<OrderDraft, 'point_id' | 'dine_type' | 'label' | 'table_no' | 'address' | 'customer' | 'ship_fee' | 'ship_mode' | 'ship_payout' | 'items'>>,
  ): Promise<Order> {
    this.shift();
    const before = this.openOrder(orderId);
    // Không đổi khách ⇒ gửi lại khách đang có (server ghi đúng khách trong payload, bỏ khách nếu không phải đơn ship).
    const keep = (k: keyof typeof changes) => changes[k] === undefined;
    const fields = normalized({
      point_id: changes.point_id ?? before.point_id,
      dine_type: changes.dine_type ?? before.dine_type,
      label: keep('label') ? before.label : changes.label,
      table_no: keep('table_no') ? before.table_no : changes.table_no,
      address: keep('address') ? before.address : changes.address,
      customer: keep('customer') ? (before.customer_id ? { id: before.customer_id } : null) : changes.customer,
      ship_fee: keep('ship_fee') ? before.ship_fee : changes.ship_fee,
      ship_mode: keep('ship_mode') ? before.ship_mode : changes.ship_mode,
      ship_payout: keep('ship_payout') ? before.ship_payout : changes.ship_payout,
      items: changes.items ?? before.items,
    });
    const payload = updateOrderPayload(orderId, fields);
    const res = await this.send('update_order', orderId, () => ({ entity_id: orderId, payload }));
    const updated = await this.applied(res, orderId, !!fields.customer?.is_new);
    this.rememberShip(updated, false);
    this.emit({ type: 'order_updated', before, after: updated });
    return updated;
  }

  async serveOrder(orderId: string): Promise<Order> {
    this.shift();
    const o = this.openOrder(orderId);
    if (o.status !== 'open') throw new PosError('Đơn đã ra món');
    try {
      const res = await this.send('serve_order', orderId, () => ({ entity_id: orderId, payload: { order_id: orderId } }));
      return this.applied(res, orderId);
    } catch (e) {
      // Máy khác vừa bấm "Đã ra món" cho đơn này: kết quả như nhau, không phải lỗi.
      if (e instanceof PosError && e.reason === 'already_served') {
        await this.store.refreshOpen();
        return this.store.getSnapshot().open?.orders.find((x) => x.id === orderId) ?? { ...o, status: 'served' };
      }
      throw e;
    }
  }

  async deleteOrder(orderId: string, reason: DeleteReason): Promise<void> {
    this.shift();
    const o = this.openOrder(orderId);
    await this.send('delete_order', orderId, () => ({
      entity_id: orderId,
      payload: { order_id: orderId, reason, status_before: o.status },
    }));
    this.store.removeOrder(orderId);
    this.emit({ type: 'order_deleted', order: o });
  }

  /** Thanh toán: tiền tính vào ca đang mở lúc thu. Sau đó đơn biến mất khỏi hàng đợi (trên mọi máy). */
  async payOrder(orderId: string, payment: PaymentInput): Promise<void> {
    const shift = this.shift();
    const o = this.openOrder(orderId);
    let cash_given: Money | null = null;
    let customer: DebtCustomerPayload | null = null;

    if (payment.method === 'cash') {
      if (!canConfirmCash(o.total, payment.cash_given)) throw new PosError('Khách đưa chưa đủ tiền');
      cash_given = payment.cash_given;
    } else if (payment.method === 'debt') {
      const name = payment.customer.name.trim();
      if (!name) throw new PosError('Cần tên khách ghi nợ');
      const prevOp = this.unsure.get(`pay_order:${orderId}`)?.op;
      const prev = prevOp?.kind === 'pay_order' ? prevOp.payload.customer : null;
      const newId = !payment.customer.id && prev?.is_new ? prev.id : undefined;
      customer = {
        id: payment.customer.id ?? newId ?? uuidv7(),
        is_new: !payment.customer.id,
        name,
        description: payment.customer.description?.trim() || null,
        phone: payment.customer.phone?.trim() || null,
      };
    }

    await this.send('pay_order', orderId, () => ({
      entity_id: orderId,
      payload: { order_id: orderId, paid_shift_id: shift.id, method: payment.method, cash_given, total: o.total, customer },
    }));
    this.store.removeOrder(orderId);
    this.emit({ type: 'order_paid', order: o });
    // Ghi nợ ⇒ dư nợ (và khách mới) có ngay trong sổ nợ.
    if (customer) await this.store.refreshCatalog();
  }

  // ---------------------------------------------------------------- thu nợ

  async recordDebtPayment(input: { customer_id: string; amount: Money; method: 'cash' | 'transfer' }): Promise<string> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new PosError('Số tiền không hợp lệ');
    const shift = this.shift();
    const intent = `${input.customer_id}:${input.amount}:${input.method}`;
    const id = this.reuseId('debt_payment', intent);
    await this.send('debt_payment', intent, () => ({ entity_id: id, payload: { id, ...input, shift_id: shift.id } }));
    await this.store.refreshCatalog();
    return id;
  }

  // ---------------------------------------------------------------- hết món

  /**
   * Báo một món / topping hết (hoặc bán lại) trong ngày ở một điểm bán. Mọi máy thấy ngay qua Realtime;
   * sang ngày mới thì tự bán lại. Cần ca đang mở (nhật ký ghi tên nhân viên).
   */
  async setSoldOut(input: { point_id: string; item_kind: 'product' | 'topping'; item_id: string; sold_out: boolean }): Promise<void> {
    const shift = this.shift();
    const intent = `${input.point_id}:${input.item_kind}:${input.item_id}:${input.sold_out}`;
    await this.send('set_sold_out', intent, () => ({ entity_id: input.item_id, payload: { ...input, shift_id: shift.id } }));
    const tz = this.store.getSnapshot().catalog?.config.timezone;
    const day = businessDate(new Date(), tz);
    const same = (r: SoldOut) => r.point_id === input.point_id && r.item_kind === input.item_kind && r.item_id === input.item_id;
    this.store.patchCatalog((c) => {
      const rest = (c.sold_out ?? []).filter((r) => !same(r));
      const { point_id, item_kind, item_id } = input;
      return { ...c, sold_out: input.sold_out ? [...rest, { point_id, item_kind, item_id, day, at: new Date().toISOString() }] : rest };
    });
    void this.store.refreshCatalog();
  }

  // ---------------------------------------------------------------- khoản chi

  /** Ghi khoản chi (tiền mặt lấy từ két) vào ca đang mở. Bấm lại sau lỗi mạng ⇒ cùng id, không ghi hai lần. */
  async createExpense(input: { amount: Money | null; note: string }): Promise<ShiftExpense> {
    const problem = validateExpense(input.amount, input.note);
    if (problem) throw new PosError(rejectMessage(problem), problem);
    const shift = this.shift();
    const note = cleanExpenseNote(input.note);
    const intent = `${shift.id}:${input.amount}:${note}`;
    const id = this.reuseId('create_expense', intent);
    const res = await this.send('create_expense', intent, () => ({ entity_id: id, payload: { id, shift_id: shift.id, amount: input.amount, note } }));
    return this.expenseApplied(res, id);
  }

  /** Hủy khoản chính nhân viên ghi của ca đang mở (server kiểm lại). */
  async voidExpense(expenseId: string): Promise<ShiftExpense> {
    const res = await this.send('void_expense', expenseId, () => ({ entity_id: expenseId, payload: { expense_id: expenseId } }));
    return this.expenseApplied(res, expenseId);
  }

  /** Ghi chú gần đây (mọi quầy, 30 ngày). Lỗi mạng ⇒ danh sách rỗng (vẫn gõ tay được). */
  async recentExpenseNotes(): Promise<string[]> {
    try {
      return await this.store.api.loadRecentExpenseNotes();
    } catch {
      return [];
    }
  }

  private async expenseApplied(res: Ok, id: string): Promise<ShiftExpense> {
    if (res.expense) {
      this.store.applyExpense(res.expense);
      return res.expense;
    }
    await this.store.refreshOpen();
    const e = this.store.getSnapshot().open?.expenses?.find((x) => x.id === id);
    if (!e) throw new PosError('Ca đã đóng (có thể ở máy khác).');
    return e;
  }

  // ---------------------------------------------------------------- nội bộ

  /** Server trả đơn vừa ghi ⇒ đưa vào hàng đợi ngay. (Không có ⇒ tải lại rồi tìm.) Có khách mới ⇒ tải lại danh sách khách. */
  private async applied(res: Ok, orderId: string, newCustomer = false): Promise<Order> {
    if (newCustomer) await this.store.refreshCatalog();
    if (res.order) {
      this.store.applyOrder(res.order);
      return res.order;
    }
    await this.store.refreshOpen();
    const o = this.store.getSnapshot().open?.orders.find((x) => x.id === orderId);
    if (!o) throw new PosError('Đơn không còn mở');
    return o;
  }
}
