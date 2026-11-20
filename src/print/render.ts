import type { FontSize, Line } from './types';

/**
 * Danh sách dòng → ảnh đen trắng rộng 384 điểm (khổ 58mm, 203 dpi). Vẽ bằng canvas với font Be Vietnam Pro
 * để giữ đúng dấu tiếng Việt và in được chữ to (máy in rẻ không có font tiếng Việt).
 *
 * Tách 2 bước: `planTicket` (thuần: xuống dòng, vị trí từng dòng, chiều cao — test được không cần canvas)
 * và `drawPlan` (vẽ lên canvas thật).
 */

export const PAPER_WIDTH = 384;
const MARGIN = 4;
const CONTENT = PAPER_WIDTH - MARGIN * 2;

export const FONT_PX: Record<FontSize, number> = { small: 20, normal: 24, large: 32, code: 76, code_xl: 112 };
const LINE_GAP = 1.25;
export const FONT_FAMILY = '"Be Vietnam Pro", sans-serif';

export function fontOf(size: FontSize, bold = false): string {
  return `${bold ? 700 : 500} ${FONT_PX[size]}px ${FONT_FAMILY}`;
}

/** Đo bề rộng chữ với một font (canvas: `ctx.measureText`). */
export type Measure = (text: string, font: string) => number;

/** Xuống dòng theo từ (giữ thụt đầu dòng); từ dài hơn cả dòng thì cắt theo ký tự. */
export function wrapText(text: string, maxWidth: number, font: string, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = /^\s*/.exec(para)![0];
    let fresh = true; // `cur` chỉ có thụt đầu dòng, chưa có từ nào
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = fresh ? cur + word : `${cur} ${word}`;
      if (measure(cand, font) <= maxWidth) {
        cur = cand;
        fresh = false;
        continue;
      }
      if (!fresh) {
        out.push(cur);
        cur = '';
      }
      fresh = false;
      if (measure(cur + word, font) <= maxWidth) {
        cur += word;
        continue;
      }
      for (const ch of word) {
        if (cur && measure(cur + ch, font) > maxWidth) {
          out.push(cur);
          cur = '';
        }
        cur += ch;
      }
    }
    out.push(fresh ? '' : cur);
  }
  return out;
}

export type DrawOp =
  | { op: 'text'; text: string; font: string; x: number; y: number; align: 'left' | 'center' | 'right'; white?: boolean }
  | { op: 'rect'; x: number; y: number; w: number; h: number }
  | { op: 'dash'; y: number; h: number };

export interface Plan {
  width: number;
  height: number;
  ops: DrawOp[];
}

/** Bố trí: y là đường chân chữ (baseline `alphabetic` xấp xỉ bằng 0.8 cỡ chữ). */
export function planTicket(lines: Line[], measure: Measure, bottomFeed = 24): Plan {
  const ops: DrawOp[] = [];
  let y = 4;
  const xFor = (align: 'left' | 'center' | 'right') => (align === 'left' ? MARGIN : align === 'right' ? PAPER_WIDTH - MARGIN : PAPER_WIDTH / 2);
  for (const l of lines) {
    if (l.type === 'gap') {
      y += l.px;
      continue;
    }
    if (l.type === 'rule') {
      y += 6;
      ops.push(l.dashed ? { op: 'dash', y, h: 2 } : { op: 'rect', x: MARGIN, y, w: CONTENT, h: 2 });
      y += 8;
      continue;
    }
    const px = FONT_PX[l.size];
    const lh = Math.round(px * LINE_GAP);
    const font = fontOf(l.size, l.bold);
    if (l.type === 'text') {
      const rows = wrapText(l.text, CONTENT - (l.invert ? 16 : 0), font, measure);
      if (l.invert) ops.push({ op: 'rect', x: MARGIN, y, w: CONTENT, h: lh * rows.length + 4 });
      for (const r of rows) {
        ops.push({ op: 'text', text: r, font, x: xFor(l.align), y: y + Math.round(px * 0.95), align: l.align, white: l.invert });
        y += lh;
      }
      if (l.invert) y += 6;
      continue;
    }
    // Hai cột: phần phải giữ nguyên, phần trái xuống dòng trong chỗ còn lại.
    const rightW = measure(l.right, font);
    const rows = wrapText(l.left, Math.max(CONTENT - rightW - 12, CONTENT / 2), font, measure);
    rows.forEach((r, i) => {
      ops.push({ op: 'text', text: r, font, x: MARGIN, y: y + Math.round(px * 0.95), align: 'left' });
      if (i === 0) ops.push({ op: 'text', text: l.right, font, x: PAPER_WIDTH - MARGIN, y: y + Math.round(px * 0.95), align: 'right' });
      y += lh;
    });
  }
  return { width: PAPER_WIDTH, height: Math.ceil(y + bottomFeed), ops };
}

/** Phần canvas cần dùng (để test bằng bản giả). */
export interface Ctx2D {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): Ctx2D | null;
}

export function drawPlan(plan: Plan, canvas: CanvasLike): Ctx2D {
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không vẽ được phiếu (canvas)');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.textBaseline = 'alphabetic';
  for (const o of plan.ops) {
    ctx.fillStyle = '#000';
    if (o.op === 'rect') ctx.fillRect(o.x, o.y, o.w, o.h);
    else if (o.op === 'dash') for (let x = MARGIN; x < PAPER_WIDTH - MARGIN; x += 12) ctx.fillRect(x, o.y, 6, o.h);
    else {
      ctx.font = o.font;
      ctx.textAlign = o.align;
      if (o.white) ctx.fillStyle = '#fff';
      ctx.fillText(o.text, o.x, o.y);
    }
  }
  return ctx;
}

/** Ảnh 1-bit, mỗi hàng `width / 8` byte, bit cao trước, 1 = chấm đen (đúng định dạng `GS v 0`). */
export interface MonoImage {
  width: number;
  height: number;
  bits: Uint8Array;
}

/** RGBA → 1-bit theo ngưỡng độ sáng (nền trong suốt coi là trắng). */
export function toMonochrome(img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }, threshold = 160): MonoImage {
  const bytesPerRow = Math.ceil(img.width / 8);
  const bits = new Uint8Array(bytesPerRow * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const a = img.data[i + 3] / 255;
      const lum = (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a);
      if (lum < threshold) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width: bytesPerRow * 8, height: img.height, bits };
}

/** Đợi font tải xong (WebView Android cũ: vẽ trước khi có font ⇒ mất dấu / sai cỡ). */
export async function ensureFonts(doc: Document | undefined = globalThis.document): Promise<void> {
  const fonts = doc?.fonts;
  if (!fonts) return;
  try {
    await Promise.all([fonts.load(`500 24px ${FONT_FAMILY}`, 'Ấ'), fonts.load(`700 24px ${FONT_FAMILY}`, 'Ấ')]);
  } catch {
    /* không tải được font: vẽ bằng font dự phòng */
  }
}

/** Trình duyệt: vẽ phiếu lên canvas mới. Trả canvas (xem trước) + ảnh 1-bit (gửi máy in). */
export async function renderTicket(lines: Line[], doc: Document = document): Promise<{ canvas: HTMLCanvasElement; image: MonoImage }> {
  await ensureFonts(doc);
  const canvas = doc.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) throw new Error('Không vẽ được phiếu (canvas)');
  const measure: Measure = (t, f) => {
    probe.font = f;
    return probe.measureText(t).width;
  };
  const plan = planTicket(lines, measure);
  const ctx = drawPlan(plan, canvas as unknown as CanvasLike);
  return { canvas, image: toMonochrome(ctx.getImageData(0, 0, plan.width, plan.height)) };
}

/** Ảnh 1-bit → canvas (xem trước đúng từng chấm sẽ in). */
export function monoToCanvas(img: MonoImage, doc: Document = document): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const out = ctx.createImageData(img.width, img.height);
  const bpr = img.width / 8;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const black = (img.bits[y * bpr + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
      const i = (y * img.width + x) * 4;
      const v = black ? 0 : 255;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
