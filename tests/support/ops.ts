// Dựng op đồng bộ giống outbox của tablet (src/sync) để test RPC sync_push.
import type { SupabaseClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';
import { SEED } from './seed-ids';

export interface Op {
  op_id: string;
  kind: string;
  entity_id: string;
  performed_at: string;
  payload: Record<string, unknown>;
}

let clock = Date.now() - 60 * 60_000;
export const tick = (ms = 1000) => new Date((clock += ms)).toISOString();

export function op(kind: string, entity_id: string, payload: Record<string, unknown>, performed_at = tick()): Op {
  return { op_id: uuidv7(), kind, entity_id, performed_at, payload };
}

export async function push(c: SupabaseClient, o: Op) {
  const { data, error } = await c.rpc('sync_push', { op: o });
  if (error) throw error;
  return data as { status: 'ok' | 'duplicate' | 'rejected'; reason?: string };
}

export interface TestItem {
  id: string;
  product_id: string;
  name_snap: string;
  unit_price_snap: number;
  qty: number;
  toppings_snap: Array<{ id: string; name: string; price: number; extra_box: boolean }>;
}

export const item = (
  product: keyof typeof SEED.products,
  toppings: Array<keyof typeof SEED.toppings> = [],
  qty = 1,
  id = uuidv7(),
): TestItem => ({
  id,
  product_id: SEED.products[product],
  name_snap: product,
  unit_price_snap: SEED.prices[product],
  qty,
  toppings_snap: toppings.map((t) => ({ id: SEED.toppings[t], name: t, price: SEED.prices[t], extra_box: false })),
});

export const lineTotal = (it: TestItem) =>
  (it.unit_price_snap + it.toppings_snap.reduce((s, t) => s + t.price, 0)) * it.qty;

const CODE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const randomCode = () => Array.from({ length: 3 }, () => CODE[Math.floor(Math.random() * CODE.length)]).join('');

/** Bộ thao tác của một tablet với ca hiện tại + device_seq riêng. */
export class TabletSim {
  shiftId: string | null = null;
  seq = 0;
  constructor(public c: SupabaseClient, public profileId: string) {}

  async openShift(staff: keyof typeof SEED.staff = 'Lan') {
    const id = uuidv7();
    const r = await push(this.c, op('open_shift', id, { shift_id: id, staff_id: SEED.staff[staff], opened_at: tick() }));
    if (r.status === 'ok') this.shiftId = id;
    return r;
  }

  createOrderOp(items: TestItem[], extra: Record<string, unknown> = {}) {
    const id = uuidv7();
    const total = items.reduce((s, it) => s + lineTotal(it), 0);
    const order = {
      id, device_seq: ++this.seq, tablet_profile_id: this.profileId,
      point_id: this.profileId === SEED.tablets.B ? SEED.points.xoiB : SEED.points.xoiA,
      code: randomCode(), label: null, table_no: null, dine_type: 'takeaway', status: 'open',
      opened_shift_id: this.shiftId, total, ...extra,
    };
    return { id, total, op: op('create_order', id, { order, items }) };
  }

  async createOrder(items: TestItem[], extra: Record<string, unknown> = {}) {
    const o = this.createOrderOp(items, extra);
    const r = await push(this.c, o.op);
    return { ...o, result: r };
  }

  serve(orderId: string) {
    return push(this.c, op('serve_order', orderId, { order_id: orderId, served_at: tick() }));
  }

  pay(orderId: string, total: number, method: 'cash' | 'transfer' | 'debt' = 'cash', extra: Record<string, unknown> = {}) {
    return push(this.c, op('pay_order', orderId, {
      order_id: orderId, paid_shift_id: this.shiftId, paid_at: tick(), method,
      cash_given: method === 'cash' ? total : null, total, customer: null, ...extra,
    }));
  }

  del(orderId: string, reason = 'customer_left') {
    return push(this.c, op('delete_order', orderId, { order_id: orderId, reason }));
  }

  update(orderId: string, items: TestItem[], extra: Record<string, unknown> = {}) {
    const total = items.reduce((s, it) => s + lineTotal(it), 0);
    return push(this.c, op('update_order', orderId, {
      order_id: orderId, point_id: this.profileId === SEED.tablets.B ? SEED.points.xoiB : SEED.points.xoiA,
      dine_type: 'takeaway', label: null, table_no: null, items, total, ...extra,
    }));
  }

  closeShift(boxes_left: number, plates_left: number, cash_counted: number) {
    const id = this.shiftId!;
    return push(this.c, op('close_shift', id, { shift_id: id, boxes_left, plates_left, cash_counted }));
  }

  debtPayment(customer_id: string, amount: number, method: 'cash' | 'transfer' = 'cash') {
    const id = uuidv7();
    return push(this.c, op('debt_payment', id, { id, customer_id, amount, method, shift_id: this.shiftId }));
  }
}
