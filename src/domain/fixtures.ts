// Dữ liệu menu mẫu dùng trong unit test domain (trùng ý với supabase/seed.sql).
import type { Combo, Order, Product, Topping } from './types';

export const XOI_MENU = 'menu-xoi';
export const COM_MENU = 'menu-com';

export const product = (p: Partial<Product> & Pick<Product, 'id'>): Product => ({
  menu_id: XOI_MENU,
  name: p.id,
  price: 15000,
  sort: 0,
  active: true,
  boxes_takeaway: 1,
  boxes_dinein: 1,
  plates_dinein: 0,
  cans: 0,
  ...p,
});

export const topping = (t: Partial<Topping> & Pick<Topping, 'id'>): Topping => ({
  menu_id: XOI_MENU,
  name: t.id,
  price: 5000,
  extra_box_takeaway: false,
  sort: 0,
  active: true,
  ...t,
});

export const XOI_GA = product({ id: 'xoi-ga', name: 'Xôi gà', price: 25000, sort: 1 });
export const XOI_XEO = product({ id: 'xoi-xeo', name: 'Xôi xéo', price: 15000, sort: 2 });
export const XOI_CU = product({ id: 'xoi-cu', name: 'Xôi cũ', price: 10000, sort: 3, active: false });
export const COM_GA = product({
  id: 'com-ga', menu_id: COM_MENU, name: 'Cơm gà', price: 35000, boxes_takeaway: 1, boxes_dinein: 0, plates_dinein: 1,
});

export const TRUNG = topping({ id: 'trung', name: 'Trứng', price: 6000, sort: 1 });
export const CHA = topping({ id: 'cha', name: 'Chả', price: 8000, sort: 2 });
export const PATE_CU = topping({ id: 'pate', name: 'Pate', active: false });
export const CANH = topping({ id: 'canh', menu_id: COM_MENU, name: 'Canh', price: 5000, extra_box_takeaway: true, sort: 1 });
export const DUA = topping({ id: 'dua', menu_id: COM_MENU, name: 'Dưa', price: 3000, extra_box_takeaway: true, sort: 2 });
export const DUI = topping({ id: 'dui', menu_id: COM_MENU, name: 'Thêm đùi', price: 15000, sort: 3 });

export const PRODUCTS = [XOI_GA, XOI_XEO, XOI_CU, COM_GA];
export const TOPPINGS = [TRUNG, CHA, PATE_CU, CANH, DUA, DUI];

export const COMBO_XOI_FULL: Combo = {
  id: 'combo-xoi-full', menu_id: XOI_MENU, name: 'Xôi gà full', product_id: 'xoi-ga', topping_ids: ['trung', 'cha'], sort: 1, active: true,
};
export const COMBO_PATE: Combo = {
  id: 'combo-pate', menu_id: XOI_MENU, name: 'Xôi pate', product_id: 'xoi-xeo', topping_ids: ['pate'], sort: 2, active: true,
};
export const COMBOS = [COMBO_XOI_FULL, COMBO_PATE];

let seq = 0;
export function order(o: Partial<Order> = {}): Order {
  seq++;
  return {
    id: `o${seq}`,
    device_seq: seq,
    tablet_profile_id: 'tab-a',
    point_id: 'xoi-a',
    code: 'ABC',
    label: null,
    table_no: null,
    dine_type: 'takeaway',
    address: null,
    ship_fee: 0,
    ship_mode: 'shop',
    ship_payout: 0,
    status: 'open',
    opened_shift_id: 's1',
    paid_shift_id: null,
    created_at: '2026-11-17T23:00:00.000Z',
    served_at: null,
    paid_at: null,
    deleted_at: null,
    delete_reason: null,
    total: 0,
    payment_method: null,
    cash_given: null,
    customer_id: null,
    owner_edited: false,
    items: [],
    ...o,
  };
}
