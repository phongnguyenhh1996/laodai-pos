/**
 * Mã đơn dạng 1 chữ + 2 số, ví dụ `A30`, `F15`.
 * Chữ bỏ I L O (dễ nhầm khi đọc / viết tay). Số dùng đủ 0–9: vị trí 2–3 luôn là số nên không nhầm với chữ.
 */
export const ORDER_CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_CODE_DIGITS = '0123456789';
export const ORDER_CODE_LENGTH = 3;
export const ORDER_CODE_SPACE = ORDER_CODE_LETTERS.length * ORDER_CODE_DIGITS.length ** 2;
const ORDER_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$/;

export type Rng = () => number;

/** PRNG có seed (mulberry32) để test tất định. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cryptoRng(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export function isValidOrderCode(code: string): boolean {
  return ORDER_CODE_RE.test(code);
}

const pick = (s: string, rng: Rng) => s[Math.floor(rng() * s.length)];

function randomCode(rng: Rng): string {
  return pick(ORDER_CODE_LETTERS, rng) + pick(ORDER_CODE_DIGITS, rng) + pick(ORDER_CODE_DIGITS, rng);
}

/** Mọi mã hợp lệ, theo thứ tự A00 … Z99. */
export function allOrderCodes(): string[] {
  const out: string[] = [];
  for (const l of ORDER_CODE_LETTERS) for (let n = 0; n < 100; n++) out.push(l + String(n).padStart(2, '0'));
  return out;
}

/**
 * Sinh mã ngẫu nhiên không trùng với các mã đã dùng trong ngày của tablet.
 * Mã không phụ thuộc số đơn đã bán ⇒ không suy ra được doanh số.
 */
export function generateOrderCode(used: ReadonlySet<string>, rng: Rng = cryptoRng): string {
  if (used.size >= ORDER_CODE_SPACE) throw new Error('Hết mã đơn trong ngày');
  // Khi gần đầy, chuyển sang chọn trong danh sách mã còn trống để tránh lặp vô hạn.
  if (used.size < ORDER_CODE_SPACE * 0.9) {
    for (let i = 0; i < 1000; i++) {
      const c = randomCode(rng);
      if (!used.has(c)) return c;
    }
  }
  const free = allOrderCodes().filter((c) => !used.has(c));
  if (free.length === 0) throw new Error('Hết mã đơn trong ngày');
  return free[Math.floor(rng() * free.length)];
}
