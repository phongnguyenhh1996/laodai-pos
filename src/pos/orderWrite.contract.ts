// Hợp đồng ghi đơn: cùng một danh sách ca chạy trên mọi adapter `PosBackend` —
// FakeServer (`orderWrite.contract.test.ts`, `npm test`) và Supabase thật (`tests/db/order-write-contract.test.ts`, `npm run test:db`).
// Ca nào chỉ pass ở một bên ⇒ bản giả đã lệch SQL.
import { expect } from 'vitest';
import type { CreateOrderFields, OrderCustomerPayload, RejectReason, UpdateOrderPayload } from '@/domain/orderWrite';
import type { DineType, Money, Order, OrderItem, ShipMode } from '@/domain/types';
import type { PosBackend } from './backend';
import { CLOSE_KEY } from './ops';
import type { PushResult, TabletShift, WireOp } from './types';

/** Một món / topping của danh mục dùng trong ca. */
export interface ContractEntry {
  id: string;
  price: Money;
}

/** Thế giới của một ca: máy của quầy đã có ca mở, danh mục biết trước. Mỗi ca hợp đồng một thế giới mới. */
export interface OrderWriteWorld {
  backend: PosBackend;
  profileId: string;
  shift: TabletShift;
  /** Điểm bán của quầy (menu M), điểm của quầy menu khác, điểm không thuộc quầy. */
  points: { main: string; otherMenu: string; forbidden: string };
  /** Món / topping thuộc menu M (đang bán), và thuộc menu khác. */
  product: ContractEntry;
  topping: ContractEntry;
  otherMenuProduct: ContractEntry;
  otherMenuTopping: ContractEntry;
  /** Khách có sẵn trong danh sách. */
  customer: string;
  /** Chủ tắt bán món / topping / điểm bán. */
  deactivate(kind: 'product' | 'topping' | 'point', id: string): Promise<void>;
}

export interface OrderWriteCase {
  name: string;
  run(w: OrderWriteWorld): Promise<void>;
}

const uuid = () => crypto.randomUUID();

const line = (w: OrderWriteWorld, over: Partial<OrderItem> & { toppings?: ContractEntry[] } = {}): OrderItem => {
  const { toppings = [], ...rest } = over;
  return {
    id: uuid(),
    product_id: w.product.id,
    name_snap: 'món',
    unit_price_snap: w.product.price,
    qty: 1,
    toppings_snap: toppings.map((t) => ({ id: t.id, name: 'topping', price: t.price, extra_box: false })),
    ...rest,
  };
};

const itemsTotal = (items: readonly OrderItem[]) =>
  items.reduce((s, it) => s + (it.unit_price_snap + it.toppings_snap.reduce((t, x) => t + x.price, 0)) * it.qty, 0);

/** Phần đơn gửi lên; cố tình gửi sai thì ép kiểu ở ca đó. */
type OrderOver = Partial<Omit<CreateOrderFields, 'dine_type' | 'ship_mode'>> & { dine_type?: DineType | string; ship_mode?: ShipMode | string };

interface CreateArgs {
  order?: OrderOver;
  customer?: OrderCustomerPayload | null;
  items?: OrderItem[];
}

/** Op `create_order` đúng luật (mang về, một món) trừ phần ghi đè. `total` mặc định = món + phí ship (nếu là đơn ship). */
function createOp(w: OrderWriteWorld, a: CreateArgs = {}): WireOp {
  const items = a.items ?? [line(w)];
  const o = a.order ?? {};
  const dine_type = o.dine_type ?? 'takeaway';
  const ship_fee = o.ship_fee ?? 0;
  const order = {
    id: uuid(),
    point_id: w.points.main,
    label: null,
    table_no: null,
    address: null,
    opened_shift_id: w.shift.id,
    ship_mode: 'shop',
    ship_payout: 0,
    total: itemsTotal(items) + (dine_type === 'delivery' ? ship_fee : 0),
    ...o,
    dine_type,
    ship_fee,
  } as CreateOrderFields;
  return { op_id: uuid(), kind: 'create_order', entity_id: order.id, payload: { order, customer: a.customer ?? null, items } };
}

type UpdateOver = Partial<Omit<UpdateOrderPayload, 'order_id' | 'dine_type'>> & { dine_type?: DineType | string };

function updateOp(w: OrderWriteWorld, orderId: string, u: UpdateOver = {}): WireOp {
  const items = u.items ?? [line(w)];
  const dine_type = u.dine_type ?? 'takeaway';
  const ship_fee = u.ship_fee ?? 0;
  const payload = {
    order_id: orderId,
    point_id: w.points.main,
    address: null,
    customer: null,
    label: null,
    table_no: null,
    ship_mode: 'shop',
    ship_payout: 0,
    total: itemsTotal(items) + (dine_type === 'delivery' ? ship_fee : 0),
    ...u,
    dine_type,
    ship_fee,
    items,
  } as UpdateOrderPayload;
  return { op_id: uuid(), kind: 'update_order', entity_id: orderId, payload };
}

const push = (w: OrderWriteWorld, op: WireOp): Promise<PushResult> => w.backend.push(op);

async function expectReject(w: OrderWriteWorld, op: WireOp, reason: RejectReason, note?: string): Promise<void> {
  expect(await push(w, op), note).toEqual({ status: 'rejected', reason });
}

/** Ghi được, trả đơn server lưu. */
async function accepted(w: OrderWriteWorld, op: WireOp): Promise<Order> {
  const r = await push(w, op);
  expect(r).toMatchObject({ status: 'ok' });
  const order = r.status === 'ok' ? r.order : undefined;
  expect(order).toBeDefined();
  return order!;
}

/** Tạo một đơn mang về đúng luật, trả đơn server lưu. */
const created = (w: OrderWriteWorld, a: CreateArgs = {}) => accepted(w, createOp(w, a));

const SHIP = { dine_type: 'delivery', address: '12 Lê Lợi' } as const;
const EXT = { ...SHIP, ship_mode: 'external', ship_fee: 5000, ship_payout: 10_000 } as const;

export const ORDER_WRITE_CASES: OrderWriteCase[] = [
  // ------------------------------------------------------------ chuẩn hóa
  {
    name: 'chuẩn hóa: cắt nhãn 40 / bàn 10 sau khi trim; rỗng ⇒ null; giờ tạo + mã đơn do server cấp',
    async run(w) {
      const label = `  ${'a'.repeat(45)}  `;
      const o = await created(w, { order: { label, table_no: ' 123456789012 ' } });
      expect(o).toMatchObject({ label: 'a'.repeat(40), table_no: '1234567890', status: 'open', opened_shift_id: w.shift.id });
      const blank = await created(w, { order: { label: '   ', table_no: '' } });
      expect(blank).toMatchObject({ label: null, table_no: null });
      expect(blank.code).not.toBe(o.code);
      expect(blank.device_seq).toBe(o.device_seq + 1);
    },
  },
  {
    name: 'chuẩn hóa: không phải đơn ship ⇒ bỏ địa chỉ, khách, phí, kiểu ⇒ shop / 0',
    async run(w) {
      const items = [line(w)];
      const o = await created(w, {
        order: { dine_type: 'takeaway', address: '12 Lê Lợi', ship_mode: 'external', ship_fee: 5000, ship_payout: 10_000, total: itemsTotal(items) },
        customer: { id: w.customer },
        items,
      });
      expect(o).toMatchObject({ dine_type: 'takeaway', address: null, customer_id: null, ship_mode: 'shop', ship_fee: 0, ship_payout: 0, total: itemsTotal(items) });
    },
  },
  {
    name: 'chuẩn hóa: đơn ship trim địa chỉ; quán ship gửi kèm tiền trả shipper ⇒ lưu 0; thiếu kiểu ⇒ quán ship',
    async run(w) {
      const shop = await created(w, { order: { ...SHIP, address: '  9 Pasteur ', ship_mode: 'shop', ship_fee: 10_000, ship_payout: 10_000 } });
      expect(shop).toMatchObject({ address: '9 Pasteur', ship_mode: 'shop', ship_fee: 10_000, ship_payout: 0 });
      const old = await created(w, { order: { ...SHIP, ship_mode: '' } });
      expect(old).toMatchObject({ ship_mode: 'shop', ship_payout: 0 });
    },
  },
  {
    name: 'shipper ngoài: lưu kiểu + tiền trả shipper, tổng không cộng tiền trả shipper; phụ thu 0 vẫn được',
    async run(w) {
      const items = [line(w)];
      const o = await created(w, { order: { ...EXT }, items });
      expect(o).toMatchObject({ ship_mode: 'external', ship_fee: 5000, ship_payout: 10_000, total: itemsTotal(items) + 5000 });
      const free = await created(w, { order: { ...EXT, ship_fee: 0 } });
      expect(free).toMatchObject({ ship_mode: 'external', ship_fee: 0, ship_payout: 10_000 });
    },
  },
  {
    name: 'khách mới đi cùng đơn ship: tạo khách (trim), lưu địa chỉ; khách có sẵn ⇒ cập nhật địa chỉ gần nhất',
    async run(w) {
      const id = uuid();
      const o = await created(w, {
        order: { ...SHIP, address: '5 Hai Bà Trưng' },
        customer: { id, is_new: true, name: ' Anh Tú ', description: ' ', phone: ' 0912 345 678 ' },
      });
      expect(o.customer_id).toBe(id);
      const cat = await w.backend.loadCatalog(w.profileId);
      expect(cat.customers.find((c) => c.id === id)).toMatchObject({ name: 'Anh Tú', description: null, phone: '0912 345 678', address: '5 Hai Bà Trưng' });

      const u = await accepted(w, updateOp(w, o.id, { ...SHIP, address: '9 Pasteur', customer: { id: w.customer } }));
      expect(u.customer_id).toBe(w.customer);
      const cat2 = await w.backend.loadCatalog(w.profileId);
      expect(cat2.customers.find((c) => c.id === w.customer)?.address).toBe('9 Pasteur');
    },
  },
  {
    name: 'sửa đơn: dòng giữ nguyên đổi số lượng; dòng bỏ ra khỏi đơn; chuyển sang mang về ⇒ bỏ địa chỉ / khách / ship',
    async run(w) {
      const a = line(w);
      const b = line(w, { toppings: [w.topping] });
      const o = await created(w, { order: { ...EXT }, customer: { id: w.customer }, items: [a, b] });
      const kept = { ...a, qty: 3 };
      const u = await accepted(w, updateOp(w, o.id, { items: [kept] }));
      expect(u.items.map((x) => [x.id, x.qty])).toEqual([[a.id, 3]]);
      expect(u).toMatchObject({ dine_type: 'takeaway', address: null, customer_id: null, ship_mode: 'shop', ship_fee: 0, ship_payout: 0, total: itemsTotal([kept]) });
      // Dòng đã bỏ không quay lại được với cùng id.
      await expectReject(w, updateOp(w, o.id, { items: [kept, b] }), 'item_id_conflict');
    },
  },

  // ------------------------------------------------------------ ca / đơn / điểm bán
  {
    name: 'bad_shift: ca không phải của quầy',
    run: (w) => expectReject(w, createOp(w, { order: { opened_shift_id: uuid() } }), 'bad_shift'),
  },
  {
    name: 'order_exists: id đơn đã có (op khác)',
    async run(w) {
      const op = createOp(w);
      await accepted(w, op);
      await expectReject(w, { ...op, op_id: uuid() }, 'order_exists');
    },
  },
  {
    name: 'shift_not_open: ca đã đóng',
    async run(w) {
      const counts = Object.fromEntries(w.shift.count_items.map((k) => [CLOSE_KEY[k], 0]));
      expect(await push(w, { op_id: uuid(), kind: 'close_shift', entity_id: w.shift.id, payload: { shift_id: w.shift.id, ...counts } })).toMatchObject({ status: 'ok' });
      await expectReject(w, createOp(w), 'shift_not_open');
    },
  },
  {
    name: 'order_not_found / order_not_open: sửa đơn không có / đã xóa',
    async run(w) {
      await expectReject(w, updateOp(w, uuid()), 'order_not_found');
      const o = await created(w);
      const del: WireOp = { op_id: uuid(), kind: 'delete_order', entity_id: o.id, payload: { order_id: o.id, reason: 'mistake', status_before: 'open' } };
      expect(await push(w, del)).toMatchObject({ status: 'ok' });
      await expectReject(w, updateOp(w, o.id), 'order_not_open');
    },
  },
  {
    name: 'point_not_allowed: điểm bán không thuộc quầy (tạo và sửa)',
    async run(w) {
      await expectReject(w, createOp(w, { order: { point_id: w.points.forbidden } }), 'point_not_allowed');
      const o = await created(w);
      await expectReject(w, updateOp(w, o.id, { point_id: w.points.forbidden }), 'point_not_allowed');
    },
  },
  {
    name: 'point_inactive: tạo đơn ở điểm bán đã tắt',
    async run(w) {
      await w.deactivate('point', w.points.main);
      await expectReject(w, createOp(w), 'point_inactive');
    },
  },

  // ------------------------------------------------------------ loại đơn / địa chỉ / ship / khách
  {
    name: 'bad_dine_type',
    run: (w) => expectReject(w, createOp(w, { order: { dine_type: 'ship' } }), 'bad_dine_type'),
  },
  {
    name: 'address_required: đơn ship không có địa chỉ (chỉ khoảng trắng)',
    async run(w) {
      await expectReject(w, createOp(w, { order: { ...SHIP, address: '   ' } }), 'address_required');
      const o = await created(w);
      await expectReject(w, updateOp(w, o.id, { ...SHIP, address: null }), 'address_required');
    },
  },
  {
    name: 'bad_ship_fee: phí lẻ / quá 50.000; phí âm cả khi không phải đơn ship',
    async run(w) {
      for (const fee of [7500, 60_000, -5000]) await expectReject(w, createOp(w, { order: { ...SHIP, ship_fee: fee } }), 'bad_ship_fee', String(fee));
      await expectReject(w, createOp(w, { order: { dine_type: 'takeaway', ship_fee: -5000 } }), 'bad_ship_fee', 'mang về');
    },
  },
  {
    name: 'bad_ship_mode',
    run: (w) => expectReject(w, createOp(w, { order: { ...EXT, ship_mode: 'grab' } }), 'bad_ship_mode'),
  },
  {
    name: 'bad_ship_payout: shipper ngoài thiếu / sai tiền trả shipper (tạo và sửa)',
    async run(w) {
      for (const payout of [0, 7500, 60_000, -5000]) {
        await expectReject(w, createOp(w, { order: { ...EXT, ship_payout: payout } }), 'bad_ship_payout', String(payout));
      }
      const o = await created(w, { order: { ...EXT } });
      await expectReject(w, updateOp(w, o.id, { ...EXT, ship_payout: 0 }), 'bad_ship_payout');
    },
  },
  {
    name: 'customer_required: khách mới không có tên; khách không có trong danh sách mà không gửi tên',
    async run(w) {
      await expectReject(w, createOp(w, { order: { ...SHIP }, customer: { id: uuid(), is_new: true, name: '  ', description: null, phone: null } }), 'customer_required');
      await expectReject(w, createOp(w, { order: { ...SHIP }, customer: { id: uuid() } }), 'customer_required');
    },
  },

  // ------------------------------------------------------------ dòng đơn (`write_items`)
  {
    name: 'empty_items',
    run: (w) => expectReject(w, createOp(w, { items: [] }), 'empty_items'),
  },
  {
    name: 'bad_qty: số lượng 0',
    run: (w) => expectReject(w, createOp(w, { items: [line(w, { qty: 0 })] }), 'bad_qty'),
  },
  {
    name: 'duplicate_item: hai dòng cùng id',
    async run(w) {
      const a = line(w);
      await expectReject(w, createOp(w, { items: [a, { ...a }] }), 'duplicate_item');
    },
  },
  {
    name: 'item_id_conflict: id dòng thuộc đơn khác',
    async run(w) {
      const a = line(w);
      await created(w, { items: [a] });
      await expectReject(w, createOp(w, { items: [{ ...a }] }), 'item_id_conflict');
    },
  },
  {
    name: 'bad_product: món của menu khác',
    run: (w) => expectReject(w, createOp(w, { items: [line(w, { product_id: w.otherMenuProduct.id, unit_price_snap: w.otherMenuProduct.price })] }), 'bad_product'),
  },
  {
    name: 'bad_topping: topping của menu khác',
    run: (w) => expectReject(w, createOp(w, { items: [line(w, { toppings: [w.otherMenuTopping] })] }), 'bad_topping'),
  },
  {
    name: 'price_mismatch: giá món / topping khác giá hiện hành; dòng giữ nguyên mà đổi giá đã chụp',
    async run(w) {
      await expectReject(w, createOp(w, { items: [line(w, { unit_price_snap: w.product.price + 1000 })] }), 'price_mismatch', 'món');
      await expectReject(w, createOp(w, { items: [line(w, { toppings: [{ ...w.topping, price: 1 }] })] }), 'price_mismatch', 'topping');
      const a = line(w);
      const o = await created(w, { items: [a] });
      await expectReject(w, updateOp(w, o.id, { items: [{ ...a, unit_price_snap: a.unit_price_snap + 1000 }] }), 'price_mismatch', 'dòng cũ');
    },
  },
  {
    name: 'product_inactive / topping_inactive: dòng mới có món / topping đã ngừng bán; dòng giữ nguyên vẫn nhận',
    async run(w) {
      const a = line(w, { toppings: [w.topping] });
      const o = await created(w, { items: [a] });
      await w.deactivate('topping', w.topping.id);
      await expectReject(w, createOp(w, { items: [line(w, { toppings: [w.topping] })] }), 'topping_inactive');
      await w.deactivate('product', w.product.id);
      await expectReject(w, createOp(w), 'product_inactive');
      await accepted(w, updateOp(w, o.id, { items: [{ ...a, qty: 2 }] }));
    },
  },
  {
    name: 'total_mismatch: tổng lệch; tổng có cộng tiền trả shipper',
    async run(w) {
      const items = [line(w)];
      await expectReject(w, createOp(w, { items, order: { total: itemsTotal(items) + 1000 } }), 'total_mismatch');
      await expectReject(w, createOp(w, { items, order: { ...EXT, total: itemsTotal(items) + 5000 + 10_000 } }), 'total_mismatch', 'cộng payout');
      const o = await created(w, { order: { ...SHIP, ship_fee: 10_000 } });
      await expectReject(w, updateOp(w, o.id, { ...SHIP, ship_fee: 15_000, total: itemsTotal(items) + 10_000 }), 'total_mismatch', 'sửa thiếu phí');
    },
  },
];
