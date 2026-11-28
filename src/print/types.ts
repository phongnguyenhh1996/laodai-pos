import type { DineType, Money } from '@/domain/types';

/** Mẫu in chung cho phiếu bếp + bill (SPEC 12.5). Server luôn trả đủ trường (gộp với mặc định). */
export interface PrintTemplate {
  shop_name: string;
  phone: string;
  address: string;
  /** 0–3 dòng chân trang tự nhập. */
  footer: string[];
  code_size: 'large' | 'xlarge';
  bill: {
    shop_name: boolean;
    point: boolean;
    phone: boolean;
    address: boolean;
    time: boolean;
    dine: boolean;
    label: boolean;
    unit_price: boolean;
    thanks: boolean;
    no_bill_free: boolean;
  };
  kitchen: {
    dine: boolean;
    label: boolean;
    time: boolean;
    toppings: boolean;
  };
}

export const DEFAULT_TEMPLATE: PrintTemplate = {
  shop_name: 'Lão Đại',
  phone: '',
  address: '',
  footer: [],
  code_size: 'large',
  bill: {
    shop_name: true,
    point: true,
    phone: true,
    address: true,
    time: true,
    dine: true,
    label: true,
    unit_price: true,
    thanks: true,
    no_bill_free: true,
  },
  kitchen: { dine: true, label: true, time: true, toppings: true },
};

/** Chỉ giữ các khóa có trong mặc định (mẫu cũ còn `kitchen.queue_no` ⇒ bỏ, lưu lại không mang theo). */
function pickKnown<T extends Record<string, boolean>>(base: T, s: Partial<T> | undefined): T {
  const out = { ...base };
  for (const k of Object.keys(base) as Array<keyof T>) if (typeof s?.[k] === 'boolean') out[k] = s[k] as T[keyof T];
  return out;
}

/** Gộp mẫu từ server với mặc định (thiếu khóa / dữ liệu cũ vẫn in được). */
export function normalizeTemplate(t: Partial<PrintTemplate> | null | undefined): PrintTemplate {
  const s = t ?? {};
  return {
    ...DEFAULT_TEMPLATE,
    ...s,
    footer: Array.isArray(s.footer) ? s.footer.filter((x) => typeof x === 'string').slice(0, 3) : [],
    code_size: s.code_size === 'xlarge' ? 'xlarge' : 'large',
    bill: { ...DEFAULT_TEMPLATE.bill, ...(s.bill ?? {}) },
    kitchen: pickKnown(DEFAULT_TEMPLATE.kitchen, s.kitchen),
  };
}

export interface PrintDocItem {
  name: string;
  qty: number;
  unit_price: Money;
  toppings: Array<{ name: string; price: Money }>;
}

/**
 * Nội dung in của một đơn (server dựng: `private.print_doc`). Cố ý KHÔNG có hình thức thanh toán, tiền khách đưa,
 * khách nợ, tên nhân viên.
 */
export interface PrintDoc {
  order_id: string;
  code: string;
  status: string;
  dine_type: DineType;
  label: string | null;
  table_no: string | null;
  point_name: string;
  created_at: string;
  paid_at: string | null;
  edited_at: string | null;
  /** Phí ship (đã nằm trong `total`); server cũ không gửi ⇒ không in dòng phí. */
  ship_fee?: Money;
  total: Money;
  items: PrintDocItem[];
}

/** Món thêm / bớt khi sửa đơn (phiếu bếp "ĐÃ SỬA"). */
export interface EditLine {
  name: string;
  qty: number;
  toppings: string[];
}

export interface KitchenEdit {
  at: string;
  added: EditLine[];
  removed: EditLine[];
}

export type PrintKind = 'kitchen' | 'bill' | 'test';

export type FontSize = 'small' | 'normal' | 'large' | 'code' | 'code_xl';

export type Line =
  | { type: 'text'; text: string; size: FontSize; align: 'left' | 'center' | 'right'; bold?: boolean; invert?: boolean }
  /** Hai cột: trái tự xuống dòng, phải căn phải (tên món — thành tiền). */
  | { type: 'row'; left: string; right: string; size: FontSize; bold?: boolean }
  | { type: 'rule'; dashed?: boolean }
  | { type: 'gap'; px: number };
