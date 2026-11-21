import { formatVnd } from '@/domain/money';
import { TZ, hhmm } from '@/domain/time';
import { DINE_LABELS } from '@/domain/types';
import type { EditLine, FontSize, KitchenEdit, Line, PrintDoc, PrintDocItem, PrintTemplate } from './types';

/**
 * Phiếu → danh sách dòng (chữ, cỡ, căn lề, kẻ ngang). Hàm thuần, không đụng canvas: `render.ts` vẽ đúng danh sách này.
 *
 * Luôn in, không tắt được: mã đơn, món kèm số lượng, Tổng (bill), "ĐÃ SỬA" kèm giờ sửa (phiếu bếp).
 * Bill KHÔNG BAO GIỜ có hình thức thanh toán, tiền đưa / thối, nợ, nhân viên: `PrintDoc` không chứa các trường đó.
 */

export interface KitchenInput {
  doc: PrintDoc;
  template: PrintTemplate;
  /** Số thứ tự trong hàng đợi (chỉ khi đơn đang có trên hàng đợi của máy in). */
  queueNo?: number | null;
  /** Phiếu in khi sửa đơn: giờ sửa + món thêm / bớt. */
  edit?: KitchenEdit | null;
  tz?: string;
}

export interface BillInput {
  doc: PrintDoc;
  template: PrintTemplate;
  tz?: string;
}

const center = (text: string, size: FontSize, bold = false): Line => ({
  type: 'text',
  text,
  size,
  align: 'center',
  bold,
});

/** "20/11/2026 07:15" theo giờ Việt Nam. */
export function dateTime(at: string, tz = TZ): string {
  const d = new Date(at);
  const dmy = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  return `${dmy} ${hhmm(d, tz)}`;
}

function labelText(doc: PrintDoc): string | null {
  const parts = [doc.table_no ? `Bàn ${doc.table_no}` : null, doc.label].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function editLine(sign: string, l: EditLine): string {
  return `${sign} ${l.qty} x ${l.name}${l.toppings.length ? ` (${l.toppings.join(', ')})` : ''}`;
}

const codeSize = (t: PrintTemplate): FontSize => (t.code_size === 'xlarge' ? 'code_xl' : 'code');

export function layoutKitchen({ doc, template, queueNo, edit, tz = TZ }: KitchenInput): Line[] {
  const k = template.kitchen;
  const out: Line[] = [];
  if (k.queue_no && queueNo) out.push(center(`Số ${queueNo}`, 'large', true));
  out.push(center(doc.code, codeSize(template), true));
  const editedAt = edit?.at ?? doc.edited_at;
  if (editedAt) out.push({ type: 'text', text: `ĐÃ SỬA ${hhmm(editedAt, tz)}`, size: 'large', align: 'center', bold: true, invert: true });
  if (k.dine) out.push(center(DINE_LABELS[doc.dine_type].toUpperCase(), 'large', true));
  const label = labelText(doc);
  if (k.label && label) out.push(center(label, 'large'));
  if (k.time) out.push(center(`Giờ tạo ${hhmm(doc.created_at, tz)}`, 'normal'));
  out.push({ type: 'rule' });
  for (const it of doc.items) {
    out.push({ type: 'text', text: `${it.qty} x ${it.name}`, size: 'large', align: 'left', bold: true });
    if (k.toppings && it.toppings.length) {
      out.push({ type: 'text', text: `   + ${it.toppings.map((t) => t.name).join(', ')}`, size: 'normal', align: 'left' });
    }
  }
  if (edit && (edit.added.length || edit.removed.length)) {
    out.push({ type: 'rule', dashed: true });
    if (edit.added.length) {
      out.push({ type: 'text', text: 'THÊM', size: 'normal', align: 'left', bold: true });
      for (const l of edit.added) out.push({ type: 'text', text: editLine('+', l), size: 'normal', align: 'left' });
    }
    if (edit.removed.length) {
      out.push({ type: 'text', text: 'BỚT', size: 'normal', align: 'left', bold: true });
      for (const l of edit.removed) out.push({ type: 'text', text: editLine('−', l), size: 'normal', align: 'left' });
    }
  }
  out.push({ type: 'rule' });
  return out;
}

export function itemUnitPrice(it: PrintDocItem): number {
  return it.unit_price + it.toppings.reduce((s, t) => s + t.price, 0);
}

export function layoutBill({ doc, template, tz = TZ }: BillInput): Line[] {
  const b = template.bill;
  const out: Line[] = [];
  if (b.shop_name && template.shop_name.trim()) out.push(center(template.shop_name.trim(), 'large', true));
  if (b.point) out.push(center(doc.point_name, 'normal'));
  if (b.phone && template.phone.trim()) out.push(center(`ĐT: ${template.phone.trim()}`, 'normal'));
  if (b.address && template.address.trim()) out.push(center(template.address.trim(), 'small'));
  if (out.length) out.push({ type: 'rule' });
  out.push(center(doc.code, codeSize(template), true));
  if (b.time) out.push(center(dateTime(doc.paid_at ?? doc.created_at, tz), 'normal'));
  const label = labelText(doc);
  const meta = [b.dine ? DINE_LABELS[doc.dine_type] : null, b.label ? label : null].filter(Boolean).join(' · ');
  if (meta) out.push(center(meta, 'normal'));
  out.push({ type: 'rule', dashed: true });
  for (const it of doc.items) {
    const unit = itemUnitPrice(it);
    out.push({ type: 'row', left: `${it.qty} x ${it.name}`, right: formatVnd(unit * it.qty), size: 'normal' });
    if (it.toppings.length) {
      out.push({ type: 'text', text: `   + ${it.toppings.map((t) => t.name).join(', ')}`, size: 'small', align: 'left' });
    }
    if (b.unit_price && it.qty > 1) {
      out.push({ type: 'text', text: `   ${formatVnd(unit)} / phần`, size: 'small', align: 'left' });
    }
  }
  if (doc.ship_fee) out.push({ type: 'row', left: 'Phí ship', right: formatVnd(doc.ship_fee), size: 'normal' });
  out.push({ type: 'rule' });
  out.push({ type: 'row', left: 'TỔNG', right: formatVnd(doc.total), size: 'large', bold: true });
  out.push({ type: 'rule' });
  if (b.thanks) out.push(center('Cảm ơn quý khách!', 'normal'));
  for (const f of template.footer) if (f.trim()) out.push(center(f.trim(), 'small'));
  if (b.no_bill_free) out.push(center('Không có bill = miễn phí', 'normal', true));
  return out;
}

/** Đơn mẫu cho xem trước / in thử (không phải đơn thật). */
export function sampleDoc(now = new Date()): PrintDoc {
  const at = now.toISOString();
  return {
    order_id: '00000000-0000-0000-0000-000000000000',
    code: 'A30',
    status: 'paid',
    dine_type: 'takeaway',
    label: 'Áo đỏ',
    table_no: null,
    point_name: 'Xôi A',
    created_at: at,
    paid_at: at,
    edited_at: null,
    total: 77000,
    items: [
      { name: 'Xôi gà', qty: 2, unit_price: 25000, toppings: [{ name: 'Trứng', price: 6000 }] },
      { name: 'Xôi xéo', qty: 1, unit_price: 15000, toppings: [] },
    ],
  };
}

/** In thử: phiếu bếp + bill của đơn mẫu, mỗi phiếu có dòng "IN THỬ". */
export function layoutTest(template: PrintTemplate, tz = TZ, now = new Date()): Line[] {
  const doc = sampleDoc(now);
  const mark = center('— IN THỬ —', 'normal', true);
  return [mark, ...layoutKitchen({ doc, template, queueNo: 3, tz }), { type: 'gap', px: 48 }, mark, ...layoutBill({ doc, template, tz })];
}

/** Chữ thuần của phiếu (nhật ký, test, đọc màn hình). */
export function linesToText(lines: Line[]): string {
  return lines
    .map((l) => {
      if (l.type === 'text') return l.text;
      if (l.type === 'row') return `${l.left} | ${l.right}`;
      if (l.type === 'rule') return l.dashed ? '- - -' : '---';
      return '';
    })
    .join('\n');
}
