/** Bảng chữ không gây nhầm: không có 0 O 1 I L. */
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_CODE_LENGTH = 3;
export const ORDER_CODE_SPACE = ORDER_CODE_ALPHABET.length ** ORDER_CODE_LENGTH;

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
  if (code.length !== ORDER_CODE_LENGTH) return false;
  return [...code].every((c) => ORDER_CODE_ALPHABET.includes(c));
}

function randomCode(rng: Rng): string {
  let s = '';
  for (let i = 0; i < ORDER_CODE_LENGTH; i++) {
    s += ORDER_CODE_ALPHABET[Math.floor(rng() * ORDER_CODE_ALPHABET.length)];
  }
  return s;
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
  const free: string[] = [];
  const A = ORDER_CODE_ALPHABET;
  for (const a of A) for (const b of A) for (const c of A) {
    const code = a + b + c;
    if (!used.has(code)) free.push(code);
  }
  return free[Math.floor(rng() * free.length)];
}
