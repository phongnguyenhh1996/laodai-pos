import { describe, expect, it } from 'vitest';
import {
  createOrderPayload,
  normalizeOrderWrite,
  orderAddress,
  parseRejectReason,
  shipFields,
  shipProblem,
  updateOrderPayload,
  type OrderWriteFields,
  type OrderWriteInput,
} from './orderWrite';
import type { OrderItem } from './types';

const item = (id: string, qty = 1, price = 25_000): OrderItem => ({
  id,
  product_id: 'p-xoi-ga',
  name_snap: 'Xôi gà',
  unit_price_snap: price,
  qty,
  toppings_snap: [],
});

const base: OrderWriteInput = { point_id: 'xoi-a', dine_type: 'takeaway', items: [item('l1', 2)] };
const ship: OrderWriteInput = { ...base, dine_type: 'delivery', address: '12 Lê Lợi' };

function ok(input: OrderWriteInput): OrderWriteFields {
  const r = normalizeOrderWrite(input);
  if (!r.ok) throw new Error(`bị từ chối: ${r.reason}`);
  return r.order;
}

const reason = (input: OrderWriteInput) => {
  const r = normalizeOrderWrite(input);
  return r.ok ? null : r.reason;
};

describe('orderWrite: chuẩn hóa như server', () => {
  it('đơn thường: tổng = tiền món; nhãn / bàn trim, rỗng ⇒ null, cắt 40 / 10 ký tự', () => {
    expect(ok(base)).toEqual({
      point_id: 'xoi-a',
      dine_type: 'takeaway',
      label: null,
      table_no: null,
      address: null,
      customer: null,
      ship_mode: 'shop',
      ship_fee: 0,
      ship_payout: 0,
      items: base.items,
      total: 50_000,
    });
    const o = ok({ ...base, label: `  ${'a'.repeat(45)} `, table_no: ' 12345678901 ' });
    expect(o.label).toBe('a'.repeat(40));
    expect(o.table_no).toBe('1234567890');
    expect(ok({ ...base, label: '   ', table_no: '' })).toMatchObject({ label: null, table_no: null });
  });

  it('không phải đơn ship ⇒ bỏ địa chỉ / khách / phí; kiểu shop, trả shipper 0', () => {
    const o = ok({
      ...base,
      address: '12 Lê Lợi',
      customer: { id: 'c-1' },
      ship_fee: 10_000,
      ship_mode: 'external',
      ship_payout: 10_000,
    });
    expect(o).toMatchObject({ address: null, customer: null, ship_fee: 0, ship_mode: 'shop', ship_payout: 0, total: 50_000 });
  });

  it('đơn ship: địa chỉ bắt buộc (trim, cắt 200); phí cộng vào tổng, trả shipper thì không', () => {
    expect(reason({ ...ship, address: '   ' })).toBe('address_required');
    expect(reason({ ...ship, address: null })).toBe('address_required');
    expect(ok({ ...ship, address: `  ${'x'.repeat(250)}` }).address).toBe('x'.repeat(200));
    const o = ok({ ...ship, ship_fee: 5_000, ship_mode: 'external', ship_payout: 10_000 });
    expect(o).toMatchObject({ ship_mode: 'external', ship_fee: 5_000, ship_payout: 10_000, total: 55_000 });
    // Quán ship ⇒ bỏ trả shipper.
    expect(ok({ ...ship, ship_mode: 'shop', ship_payout: 10_000 }).ship_payout).toBe(0);
    // Thiếu kiểu ⇒ quán ship.
    expect(ok({ ...ship, ship_mode: undefined }).ship_mode).toBe('shop');
  });

  it('luật ship: phí 0–50.000, shipper ngoài trả 1.000–50.000, bội 1.000', () => {
    expect(reason({ ...ship, ship_fee: 1_500 })).toBe('bad_ship_fee');
    expect(reason({ ...ship, ship_fee: 51_000 })).toBe('bad_ship_fee');
    expect(reason({ ...ship, ship_fee: -1_000 })).toBe('bad_ship_fee');
    expect(reason({ ...ship, ship_mode: 'xe-om' as never })).toBe('bad_ship_mode');
    expect(reason({ ...ship, ship_mode: 'external' })).toBe('bad_ship_payout');
    expect(reason({ ...ship, ship_mode: 'external', ship_payout: 500 })).toBe('bad_ship_payout');
    expect(reason({ ...ship, ship_mode: 'external', ship_payout: 51_000 })).toBe('bad_ship_payout');
    expect(reason({ ...ship, ship_mode: 'external', ship_payout: 50_000, ship_fee: 50_000 })).toBeNull();
    // Không phải đơn ship ⇒ không kiểm.
    expect(shipProblem({ dine_type: 'dinein', ship_fee: 1_500, ship_mode: 'external' })).toBeNull();
    expect(shipFields({ dine_type: 'delivery' })).toEqual({ ship_mode: 'shop', ship_fee: 0, ship_payout: 0 });
  });

  it('khách: có sẵn ⇒ chỉ id; khách mới cần tên, cắt 60 / 80 / 20; chỉ giữ khi đơn ship', () => {
    expect(ok({ ...ship, customer: { id: 'c-1', name: 'Hoa' } }).customer).toEqual({ id: 'c-1' });
    expect(reason({ ...ship, customer: { id: 'c-2', is_new: true, name: '  ' } })).toBe('customer_required');
    const c = ok({
      ...ship,
      customer: { id: 'c-2', is_new: true, name: ` ${'n'.repeat(70)}`, description: ' ', phone: ` ${'0'.repeat(25)}` },
    }).customer;
    expect(c).toEqual({ id: 'c-2', is_new: true, name: 'n'.repeat(60), description: null, phone: '0'.repeat(20) });
    expect(ok({ ...ship, customer: { id: 'c-2', is_new: true, description: ` ${'d'.repeat(90)}`, name: 'Tú' } }).customer).toMatchObject({
      description: 'd'.repeat(80),
      phone: null,
    });
    // Khách mới không tên nhưng không phải đơn ship ⇒ bỏ khách, không lỗi.
    expect(ok({ ...base, customer: { id: 'c-2', is_new: true } }).customer).toBeNull();
  });

  it('món: không có món ⇒ empty_items; số lượng không phải số nguyên dương ⇒ bad_qty', () => {
    expect(reason({ ...base, items: [] })).toBe('empty_items');
    expect(reason({ ...base, items: [item('l1', 0)] })).toBe('bad_qty');
    expect(reason({ ...base, items: [item('l1', 1.5)] })).toBe('bad_qty');
  });

  it('thứ tự lý do như op_create_order: loại đơn → địa chỉ → ship → khách → món', () => {
    expect(reason({ ...base, dine_type: 'ship' as never, items: [] })).toBe('bad_dine_type');
    expect(reason({ ...ship, address: '', ship_mode: 'external', items: [] })).toBe('address_required');
    expect(reason({ ...ship, ship_mode: 'external', customer: { id: 'c', is_new: true }, items: [] })).toBe('bad_ship_payout');
    expect(reason({ ...ship, customer: { id: 'c', is_new: true }, items: [] })).toBe('customer_required');
  });

  it('orderAddress: chỉ đơn ship', () => {
    expect(orderAddress('delivery', ' 12 Lê Lợi ')).toBe('12 Lê Lợi');
    expect(orderAddress('takeaway', '12 Lê Lợi')).toBeNull();
  });
});

describe('orderWrite: payload', () => {
  it('create_order: phần đơn + khách + món; update_order: gửi lại toàn bộ đơn', () => {
    const o = ok({ ...ship, label: 'Cô Hoa', customer: { id: 'c-1' }, ship_fee: 10_000 });
    expect(createOrderPayload(o, { id: 'o-1', opened_shift_id: 's-1' })).toEqual({
      order: {
        id: 'o-1',
        point_id: 'xoi-a',
        label: 'Cô Hoa',
        table_no: null,
        dine_type: 'delivery',
        address: '12 Lê Lợi',
        opened_shift_id: 's-1',
        ship_fee: 10_000,
        ship_mode: 'shop',
        ship_payout: 0,
        total: 60_000,
      },
      customer: { id: 'c-1' },
      items: o.items,
    });
    expect(updateOrderPayload('o-1', o)).toEqual({ order_id: 'o-1', ...o });
  });

  it('parseRejectReason: chuỗi rỗng / không phải chuỗi ⇒ unknown; mã lạ giữ nguyên', () => {
    expect(parseRejectReason('bad_ship_fee')).toBe('bad_ship_fee');
    expect(parseRejectReason('ma_moi')).toBe('ma_moi');
    expect(parseRejectReason('')).toBe('unknown');
    expect(parseRejectReason(null)).toBe('unknown');
  });
});
