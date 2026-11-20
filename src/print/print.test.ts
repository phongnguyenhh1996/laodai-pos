import { describe, expect, it } from 'vitest';
import type { OrderItem } from '@/domain/types';
import { diffItems } from './diff';
import { chunkBytes, escposRaster, toBase64 } from './escpos';
import { layoutBill, layoutKitchen, layoutTest, linesToText, sampleDoc } from './layout';
import { PAPER_WIDTH, drawPlan, planTicket, toMonochrome, wrapText, type CanvasLike, type Ctx2D } from './render';
import { DEFAULT_TEMPLATE, normalizeTemplate, type PrintDoc, type PrintTemplate } from './types';

const TZ = 'Asia/Ho_Chi_Minh';
// 07:15 giờ VN
const AT = '2026-11-20T00:15:00Z';

const doc = (over: Partial<PrintDoc> = {}): PrintDoc => ({
  ...sampleDoc(new Date(AT)),
  code: 'F15',
  table_no: '5',
  label: 'Áo đỏ',
  ...over,
});

const tpl = (over: Partial<PrintTemplate> = {}): PrintTemplate => normalizeTemplate({ ...DEFAULT_TEMPLATE, ...over });
const off = <K extends 'bill' | 'kitchen'>(k: K, keys: Array<keyof PrintTemplate[K]>): PrintTemplate => {
  const t = tpl();
  for (const key of keys) (t[k] as Record<string, boolean>)[key as string] = false;
  return t;
};

const it_ = (name: string, qty: number, toppings: string[] = [], id = name + toppings.join()): OrderItem => ({
  id,
  product_id: 'p',
  name_snap: name,
  unit_price_snap: 10000,
  qty,
  toppings_snap: toppings.map((t) => ({ id: t, name: t, price: 1000, extra_box: false })),
});

describe('phiếu bếp', () => {
  it('đủ dòng: số thứ tự, mã đơn to, loại, nhãn + bàn, giờ tạo, món + topping; không có giá', () => {
    const lines = layoutKitchen({ doc: doc(), template: tpl(), queueNo: 3, tz: TZ });
    expect(linesToText(lines)).toMatchInlineSnapshot(`
      "Số 3
      F15
      MANG VỀ
      Bàn 5 · Áo đỏ
      Giờ tạo 07:15
      ---
      2 x Xôi gà
         + Trứng
      1 x Xôi xéo
      ---"
    `);
    expect(lines.find((l) => l.type === 'text' && l.text === 'F15')).toMatchObject({ size: 'code', bold: true });
    expect(linesToText(lines)).not.toMatch(/\d{1,3}\.\d{3}/);
  });

  it('tắt từng dòng ⇒ không xuất hiện; mã đơn + món luôn in; mã rất to', () => {
    const t = { ...off('kitchen', ['queue_no', 'dine', 'label', 'time', 'toppings']), code_size: 'xlarge' as const };
    const lines = layoutKitchen({ doc: doc(), template: t, queueNo: 3, tz: TZ });
    expect(linesToText(lines)).toBe('F15\n---\n2 x Xôi gà\n1 x Xôi xéo\n---');
    expect(lines[0]).toMatchObject({ size: 'code_xl' });
  });

  it('ĐÃ SỬA kèm giờ sửa + món thêm / bớt; tắt mọi dòng vẫn in ĐÃ SỬA', () => {
    const edit = { at: '2026-11-20T00:22:00Z', added: [{ name: 'Xôi gà', qty: 1, toppings: ['Trứng'] }], removed: [{ name: 'Xôi pate', qty: 2, toppings: [] }] };
    const text = linesToText(layoutKitchen({ doc: doc(), template: off('kitchen', ['queue_no', 'dine', 'label', 'time']), edit, tz: TZ }));
    expect(text).toContain('ĐÃ SỬA 07:22');
    expect(text).toContain('THÊM\n+ 1 x Xôi gà (Trứng)');
    expect(text).toContain('BỚT\n− 2 x Xôi pate');
    // In lại tay đơn đã sửa: vẫn có ĐÃ SỬA (giờ sửa gần nhất), không có danh sách thêm / bớt.
    const re = linesToText(layoutKitchen({ doc: doc({ edited_at: '2026-11-20T00:30:00Z' }), template: tpl(), tz: TZ }));
    expect(re).toContain('ĐÃ SỬA 07:30');
    expect(re).not.toContain('THÊM');
  });
});

describe('bill', () => {
  it('đủ dòng theo mẫu; Tổng luôn in', () => {
    const t = tpl({ shop_name: 'Xôi Lão Đại', phone: '0909 000 111', address: '12 Lê Lợi', footer: ['Wifi: laodai', ''] });
    expect(linesToText(layoutBill({ doc: doc(), template: t, tz: TZ }))).toMatchInlineSnapshot(`
      "Xôi Lão Đại
      Xôi A
      ĐT: 0909 000 111
      12 Lê Lợi
      ---
      F15
      20/11/2026 07:15
      Mang về · Bàn 5 · Áo đỏ
      - - -
      2 x Xôi gà | 62.000
         + Trứng
         31.000 / phần
      1 x Xôi xéo | 15.000
      ---
      TỔNG | 77.000
      ---
      Cảm ơn quý khách!
      Wifi: laodai
      Không có bill = miễn phí"
    `);
  });

  it('tắt hết dòng tùy chọn ⇒ chỉ còn mã đơn, món, Tổng', () => {
    const t = off('bill', ['shop_name', 'point', 'phone', 'address', 'time', 'dine', 'label', 'unit_price', 'thanks', 'no_bill_free']);
    expect(linesToText(layoutBill({ doc: doc(), template: t, tz: TZ }))).toBe(
      'F15\n- - -\n2 x Xôi gà | 62.000\n   + Trứng\n1 x Xôi xéo | 15.000\n---\nTỔNG | 77.000\n---',
    );
  });

  it('không bao giờ in hình thức thanh toán / tiền đưa / nợ / nhân viên, kể cả khi dữ liệu lọt vào', () => {
    const leaky = { ...doc(), payment_method: 'debt', cash_given: 500000, customer: 'Dũng', staff_name: 'Lan' } as unknown as PrintDoc;
    const text = linesToText(layoutBill({ doc: leaky, template: tpl(), tz: TZ }));
    expect(text).not.toMatch(/nợ|Nợ|debt|Dũng|Lan|500\.000|Tiền mặt|Chuyển khoản|thối|đưa/);
  });

  it('in thử: phiếu bếp + bill của đơn mẫu, có dòng IN THỬ', () => {
    const text = linesToText(layoutTest(tpl(), TZ, new Date(AT)));
    expect(text.match(/— IN THỬ —/g)).toHaveLength(2);
    expect(text).toContain('TỔNG | 77.000');
  });

  it('mẫu từ server thiếu khóa ⇒ lấy mặc định', () => {
    const t = normalizeTemplate({ shop_name: 'X', bill: { thanks: false } as PrintTemplate['bill'], footer: ['a', 'b', 'c', 'd'], code_size: 'bad' as 'large' });
    expect(t).toMatchObject({ shop_name: 'X', code_size: 'large', footer: ['a', 'b', 'c'], bill: { thanks: false, no_bill_free: true } });
    expect(normalizeTemplate(null)).toEqual(DEFAULT_TEMPLATE);
  });
});

describe('diff món khi sửa đơn', () => {
  it('thêm, bớt, đổi số lượng, đổi topping', () => {
    const before = [it_('Xôi gà', 2, ['Trứng']), it_('Xôi xéo', 1), it_('Xôi pate', 1)];
    const after = [it_('Xôi gà', 3, ['Trứng']), it_('Xôi xéo', 1, ['Chả']), it_('Xôi thập cẩm', 1)];
    expect(diffItems(before, after)).toEqual({
      added: [
        { name: 'Xôi gà', qty: 1, toppings: ['Trứng'] },
        { name: 'Xôi xéo', qty: 1, toppings: ['Chả'] },
        { name: 'Xôi thập cẩm', qty: 1, toppings: [] },
      ],
      removed: [
        { name: 'Xôi xéo', qty: 1, toppings: [] },
        { name: 'Xôi pate', qty: 1, toppings: [] },
      ],
    });
  });

  it('cùng món tách 2 dòng = gộp; thứ tự topping không quan trọng; không đổi ⇒ rỗng', () => {
    const before = [it_('Xôi gà', 1, ['Trứng', 'Chả'], 'a'), it_('Xôi gà', 1, ['Chả', 'Trứng'], 'b')];
    const after = [it_('Xôi gà', 2, ['Chả', 'Trứng'], 'c')];
    expect(diffItems(before, after)).toEqual({ added: [], removed: [] });
  });
});

// Đo giả: mỗi ký tự rộng bằng nửa cỡ chữ.
const fakeMeasure = (t: string, font: string) => t.length * (Number(/(\d+)px/.exec(font)![1]) / 2);

describe('vẽ phiếu', () => {
  it('xuống dòng theo từ, giữ thụt đầu dòng, cắt từ quá dài', () => {
    const f = '500 20px x'; // 10 px / ký tự
    expect(wrapText('aaa bbb ccc', 75, f, fakeMeasure)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('   + Trứng, Chả', 1000, f, fakeMeasure)).toEqual(['   + Trứng, Chả']);
    expect(wrapText('abcdefghij', 40, f, fakeMeasure)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('', 40, f, fakeMeasure)).toEqual(['']);
  });

  it('bố trí: rộng 384, chiều cao tăng theo số dòng; cột phải giữ nguyên khi tên món dài', () => {
    const lines = layoutBill({ doc: doc(), template: tpl(), tz: TZ });
    const plan = planTicket(lines, fakeMeasure);
    expect(plan.width).toBe(PAPER_WIDTH);
    const longer = planTicket([...lines, { type: 'text', text: 'x', size: 'large', align: 'left' }], fakeMeasure);
    expect(longer.height).toBe(plan.height + 40);
    const row = planTicket([{ type: 'row', left: 'Xôi gà '.repeat(10), right: '62.000', size: 'normal' }], fakeMeasure);
    const texts = row.ops.filter((o) => o.op === 'text');
    expect(texts.filter((o) => o.op === 'text' && o.text === '62.000')).toHaveLength(1);
    expect(texts.length).toBeGreaterThan(2);
  });

  it('canvas giả: vẽ nền trắng rồi chữ; ảnh 1-bit đúng bit, bit cao trước', () => {
    const calls: string[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect: (x: number, y: number, w: number, h: number) => calls.push(`rect ${x},${y},${w},${h}`),
      fillText: (t: string) => calls.push(`text ${t}`),
      measureText: (t: string) => ({ width: t.length }),
      getImageData: () => ({ data: new Uint8ClampedArray(), width: 0, height: 0 }),
    } as unknown as Ctx2D;
    const canvas: CanvasLike = { width: 0, height: 0, getContext: () => ctx };
    drawPlan(planTicket([{ type: 'text', text: 'F15', size: 'code', align: 'center' }], fakeMeasure), canvas);
    expect(canvas.width).toBe(384);
    expect(calls[0]).toBe(`rect 0,0,384,${canvas.height}`);
    expect(calls).toContain('text F15');

    // 10×2: hàng 0 có điểm đen ở x=0 và x=9; hàng 1 trong suốt (= trắng).
    const data = new Uint8ClampedArray(10 * 2 * 4).fill(255);
    for (const x of [0, 9]) data.set([0, 0, 0, 255], x * 4);
    for (let x = 0; x < 10; x++) data[(10 + x) * 4 + 3] = 0;
    const mono = toMonochrome({ data, width: 10, height: 2 });
    expect(mono.width).toBe(16);
    expect(Array.from(mono.bits)).toEqual([0b1000_0000, 0b0100_0000, 0, 0]);
  });
});

describe('ESC/POS', () => {
  it('ảnh 16×3 cố định ⇒ đúng bytes (khởi tạo, GS v 0 theo dải, đẩy giấy, cắt)', () => {
    const img = { width: 16, height: 3, bits: Uint8Array.from([0xff, 0x00, 0x0f, 0xf0, 0x01, 0x80]) };
    expect(Array.from(escposRaster(img, { bandRows: 2, feedLines: 3, cut: true }))).toEqual([
      0x1b, 0x40,
      0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0,
      0x1d, 0x76, 0x30, 0x00, 2, 0, 1, 0, 0x01, 0x80,
      0x1b, 0x64, 3,
      0x1d, 0x56, 0x42, 0x00,
    ]);
    expect(() => escposRaster({ width: 10, height: 1, bits: new Uint8Array(2) })).toThrow(/chia hết/);
  });

  it('chia gói + base64', () => {
    const b = Uint8Array.from({ length: 1100 }, (_, i) => i & 0xff);
    expect(chunkBytes(b, 512).map((c) => c.length)).toEqual([512, 512, 76]);
    expect(() => chunkBytes(b, 0)).toThrow();
    expect(toBase64(Uint8Array.from([0x1b, 0x40]))).toBe('G0A=');
  });
});
