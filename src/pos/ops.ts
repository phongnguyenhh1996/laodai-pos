import { v7 as uuidv7 } from 'uuid';
import { canConfirmCash } from '@/domain/cash';
import { assertQty, orderTotal } from '@/domain/pricing';
import type { DeleteReason, DineType, Money, Order, OrderItem } from '@/domain/types';
import { PosNetworkError } from './backend';
import type { TabletStore } from './store';
import type { OpKind, PushResult, TabletShift, WireOp } from './types';

/**
 * Thao tác của tablet: kiểm tra tại máy (để báo lỗi ngay), rồi ghi thẳng lên server qua `sync_push`.
 * Chỉ coi là xong khi server trả lời; kết quả (đơn / ca) được đưa ngay vào `TabletStore`.
 * Không có hàng đợi offline: mất mạng thì báo lỗi, nhân viên bấm lại khi có mạng.
 */

/** Lỗi nghiệp vụ / mạng để hiện cho nhân viên (thông điệp tiếng Việt). */
export class PosError extends Error {
  constructor(
    message: string,
    /** Lý do server từ chối (null khi lỗi tại máy / lỗi mạng). */
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'PosError';
  }
}

export const OFFLINE_MESSAGE = 'Không lưu được: mất kết nối máy chủ. Kiểm tra mạng rồi bấm lại.';

const REJECT_MESSAGES: Record<string, string> = {
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
  cash_short: 'Khách đưa chưa đủ tiền',
  customer_required: 'Cần tên khách ghi nợ',
  bad_customer: 'Không tìm thấy khách nợ.',
  bad_staff: 'Nhân viên không còn làm.',
  empty_items: 'Đơn chưa có món',
};

export function rejectMessage(reason: string): string {
  return REJECT_MESSAGES[reason] ?? `Máy chủ từ chối thao tác (${reason}).`;
}

const OPEN_STATUSES = new Set(['open', 'served']);

function validateItems(items: OrderItem[]): void {
  if (items.length === 0) throw new PosError('Đơn chưa có món');
  for (const it of items) assertQty(it.qty);
}

/** Đơn ship bắt buộc có địa chỉ (server cũng từ chối); loại khác thì không giữ địa chỉ. */
function orderAddress(dine_type: DineType, address: string | null | undefined): string | null {
  if (dine_type !== 'delivery') return null;
  const a = address?.trim().slice(0, 200) || null;
  if (!a) throw new PosError('Đơn ship cần địa chỉ');
  return a;
}

export interface OrderDraft {
  /** Id đơn do màn đơn giữ cố định: bấm lại sau lỗi mạng không tạo đơn thứ hai. */
  id?: string;
  point_id: string;
  dine_type: DineType;
  label?: string | null;
  table_no?: string | null;
  address?: string | null;
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

  constructor(
    private store: TabletStore,
    opts: PosOptions = {},
  ) {
    this.retryDelaysMs = opts.retryDelaysMs ?? [400, 1500];
    this.sleep = opts.sleep ?? realSleep;
  }

  /** Quên các thao tác còn chờ bấm lại (đổi máy / trong test). */
  reset(): void {
    this.unsure.clear();
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
  private async send(kind: OpKind, intent: string, build: () => Omit<WireOp, 'op_id' | 'kind'>): Promise<Ok> {
    const key = `${kind}:${intent}`;
    const fresh = build();
    const body = JSON.stringify(fresh.payload);
    const prev = this.unsure.get(key);
    const op: WireOp = prev && prev.body === body ? prev.op : { op_id: uuidv7(), kind, ...fresh };

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

  /** Đếm mù: chỉ ghi số nhân viên đếm. Không trả về số kỳ vọng / chênh lệch. */
  async closeShift(input: { boxes_left: number; plates_left: number; cash_counted: Money }): Promise<void> {
    for (const [k, v] of Object.entries(input)) {
      if (!Number.isInteger(v) || v < 0) throw new PosError(`Số không hợp lệ: ${k}`);
    }
    const shift = this.shift();
    await this.send('close_shift', shift.id, () => ({ entity_id: shift.id, payload: { shift_id: shift.id, ...input } }));
    this.store.setShift(null);
  }

  // ---------------------------------------------------------------- đơn

  /** Tạo đơn: server cấp mã đơn + số thứ tự (không trùng giữa các máy cùng hồ sơ). */
  async createOrder(draft: OrderDraft): Promise<Order> {
    validateItems(draft.items);
    const address = orderAddress(draft.dine_type, draft.address);
    const shift = this.shift();
    const id = draft.id ?? uuidv7();
    const order = {
      id,
      point_id: draft.point_id,
      label: draft.label?.trim() || null,
      table_no: draft.table_no?.trim() || null,
      dine_type: draft.dine_type,
      address,
      opened_shift_id: shift.id,
      total: orderTotal(draft.items),
    };
    const res = await this.send('create_order', id, () => ({ entity_id: id, payload: { order, items: draft.items } }));
    return this.applied(res, id);
  }

  async updateOrder(
    orderId: string,
    changes: Partial<Pick<OrderDraft, 'point_id' | 'dine_type' | 'label' | 'table_no' | 'address' | 'items'>>,
  ): Promise<Order> {
    if (changes.items) validateItems(changes.items);
    this.shift();
    const before = this.openOrder(orderId);
    const after: Order = {
      ...before,
      ...changes,
      label: changes.label !== undefined ? changes.label?.trim() || null : before.label,
      table_no: changes.table_no !== undefined ? changes.table_no?.trim() || null : before.table_no,
    };
    after.address = orderAddress(after.dine_type, changes.address !== undefined ? changes.address : before.address);
    after.total = orderTotal(after.items);
    const res = await this.send('update_order', orderId, () => ({
      entity_id: orderId,
      payload: {
        order_id: orderId,
        point_id: after.point_id,
        dine_type: after.dine_type,
        address: after.address,
        label: after.label,
        table_no: after.table_no,
        items: after.items,
        total: after.total,
      },
    }));
    return this.applied(res, orderId);
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
  }

  /** Thanh toán: tiền tính vào ca đang mở lúc thu. Sau đó đơn biến mất khỏi hàng đợi (trên mọi máy). */
  async payOrder(orderId: string, payment: PaymentInput): Promise<void> {
    const shift = this.shift();
    const o = this.openOrder(orderId);
    let cash_given: Money | null = null;
    let customer: Record<string, unknown> | null = null;

    if (payment.method === 'cash') {
      if (!canConfirmCash(o.total, payment.cash_given)) throw new PosError('Khách đưa chưa đủ tiền');
      cash_given = payment.cash_given;
    } else if (payment.method === 'debt') {
      const name = payment.customer.name.trim();
      if (!name) throw new PosError('Cần tên khách ghi nợ');
      const prev = this.unsure.get(`pay_order:${orderId}`)?.op.payload.customer as { id?: string; is_new?: boolean } | null | undefined;
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

  // ---------------------------------------------------------------- nội bộ

  /** Server trả đơn vừa ghi ⇒ đưa vào hàng đợi ngay. (Không có ⇒ tải lại rồi tìm.) */
  private async applied(res: Ok, orderId: string): Promise<Order> {
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
