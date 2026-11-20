import type { MonoImage } from './render';

/**
 * Ảnh 1-bit → lệnh ESC/POS. Dùng lệnh in ảnh raster `GS v 0` (máy in nhiệt 58mm rẻ tiền đều hỗ trợ),
 * chia ảnh thành từng dải để không tràn bộ đệm của máy in.
 */

const ESC = 0x1b;
const GS = 0x1d;

export interface EscposOptions {
  /** Số hàng điểm mỗi dải ảnh (mặc định 128). */
  bandRows?: number;
  /** Số dòng đẩy giấy sau phiếu (mặc định 4). */
  feedLines?: number;
  /** Máy có dao cắt ⇒ cắt giấy sau phiếu. */
  cut?: boolean;
}

export function escposRaster(img: MonoImage, { bandRows = 128, feedLines = 4, cut = false }: EscposOptions = {}): Uint8Array {
  const bytesPerRow = img.width / 8;
  if (!Number.isInteger(bytesPerRow)) throw new RangeError('Bề rộng ảnh phải chia hết cho 8');
  const parts: number[][] = [[ESC, 0x40]]; // ESC @: khởi tạo
  for (let y0 = 0; y0 < img.height; y0 += bandRows) {
    const rows = Math.min(bandRows, img.height - y0);
    // GS v 0 m xL xH yL yH d1…dk (m = 0: cỡ thường)
    parts.push([GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff]);
    parts.push(Array.from(img.bits.subarray(y0 * bytesPerRow, (y0 + rows) * bytesPerRow)));
  }
  parts.push([ESC, 0x64, feedLines & 0xff]); // ESC d n: đẩy giấy n dòng
  if (cut) parts.push([GS, 0x56, 0x42, 0x00]); // GS V B 0: cắt (nếu có dao)
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Chia bytes thành gói nhỏ để gửi qua Bluetooth SPP (máy in rẻ hay rớt dữ liệu khi gửi một lần quá nhiều). */
export function chunkBytes(bytes: Uint8Array, size = 512): Uint8Array[] {
  if (size <= 0) throw new RangeError('Kích thước gói phải > 0');
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

/** Bytes → base64 (cầu nối Capacitor chỉ truyền chuỗi). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
