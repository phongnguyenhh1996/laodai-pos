import { chunkBytes } from './escpos';

/**
 * Lớp máy in: một `Printer` dùng chung cho mọi bản, khác nhau ở đường truyền (`PrinterTransport`):
 * - Bluetooth Classic SPP qua plugin Capacitor (app Android, `native.ts`),
 * - giả (test / E2E: lưu lại mọi lệnh đã in),
 * - không có (PWA / trình duyệt: không in trực tiếp được).
 *
 * Máy in đã chọn được nhớ trên máy (theo từng máy, không theo quầy) và tự kết nối lại khi mở app.
 */

export interface BtDevice {
  name: string;
  address: string;
}

export interface PrinterTransport {
  /** Các máy Bluetooth đã ghép đôi trong cài đặt Android. */
  listPaired(): Promise<BtDevice[]>;
  connect(address: string): Promise<void>;
  disconnect(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  /** Mất kết nối giữa chừng (tắt máy in, ra khỏi vùng phủ sóng). Trả hàm hủy. */
  onDisconnect(fn: () => void): () => void;
}

export type PrinterState = 'unsupported' | 'unpaired' | 'disconnected' | 'connecting' | 'connected' | 'printing';

export interface PrinterInfo {
  state: PrinterState;
  device: BtDevice | null;
  /** Lỗi kết nối / in gần nhất. */
  error: string | null;
}

export class PrinterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrinterError';
  }
}

export const PRINTER_KEY = 'laodai-printer';

export interface PrinterOptions {
  storage?: Storage;
  /** Kích thước gói gửi qua Bluetooth. */
  chunkSize?: number;
  /** Nghỉ giữa các gói (máy in rẻ có bộ đệm nhỏ). */
  chunkDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function readSavedPrinter(storage: Storage | undefined = globalThis.localStorage): BtDevice | null {
  try {
    const raw = storage?.getItem(PRINTER_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<BtDevice>;
    return typeof d.address === 'string' && typeof d.name === 'string' ? { name: d.name, address: d.address } : null;
  } catch {
    return null;
  }
}

export class Printer {
  private info: PrinterInfo;
  private listeners = new Set<() => void>();
  private storage: Storage | undefined;
  private chunkSize: number;
  private chunkDelayMs: number;
  private sleep: (ms: number) => Promise<void>;
  private connecting: Promise<boolean> | null = null;
  /** In lần lượt: không gửi chồng hai phiếu lên một kết nối. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private transport: PrinterTransport | null,
    opts: PrinterOptions = {},
  ) {
    this.storage = opts.storage ?? globalThis.localStorage;
    this.chunkSize = opts.chunkSize ?? 512;
    this.chunkDelayMs = opts.chunkDelayMs ?? 20;
    this.sleep = opts.sleep ?? realSleep;
    const device = transport ? readSavedPrinter(this.storage) : null;
    this.info = { state: !transport ? 'unsupported' : device ? 'disconnected' : 'unpaired', device, error: null };
    transport?.onDisconnect(() => {
      if (this.info.state === 'connected' || this.info.state === 'printing') {
        this.set({ state: 'disconnected', error: 'Mất kết nối máy in' });
      }
    });
  }

  get supported(): boolean {
    return this.transport !== null;
  }

  getSnapshot = (): PrinterInfo => this.info;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(p: Partial<PrinterInfo>): void {
    this.info = { ...this.info, ...p };
    for (const fn of this.listeners) fn();
  }

  private need(): PrinterTransport {
    if (!this.transport) throw new PrinterError('Máy này không in trực tiếp được (chỉ app Android)');
    return this.transport;
  }

  async listPaired(): Promise<BtDevice[]> {
    try {
      return await this.need().listPaired();
    } catch (e) {
      throw new PrinterError(msg(e));
    }
  }

  /** Chủ chọn máy in (chế độ chủ → Máy in): nhớ trên máy rồi kết nối. */
  async select(device: BtDevice): Promise<boolean> {
    this.need();
    try {
      this.storage?.setItem(PRINTER_KEY, JSON.stringify(device));
    } catch {
      /* không ghi được localStorage: vẫn dùng được tới khi tắt app */
    }
    if (this.info.state === 'connected' || this.info.state === 'printing') await this.transport!.disconnect().catch(() => undefined);
    this.set({ device, state: 'disconnected', error: null });
    return this.connect();
  }

  /** Bỏ máy in đã chọn trên máy này. */
  async forget(): Promise<void> {
    if (!this.transport) return;
    try {
      this.storage?.removeItem(PRINTER_KEY);
    } catch {
      /* bỏ qua */
    }
    await this.transport.disconnect().catch(() => undefined);
    this.set({ device: null, state: 'unpaired', error: null });
  }

  /** Kết nối (lại) máy in đã chọn. Nhân viên bấm "Kết nối lại"; app tự gọi khi mở. Không ném lỗi. */
  connect(): Promise<boolean> {
    if (!this.transport || !this.info.device) return Promise.resolve(false);
    if (this.info.state === 'connected' || this.info.state === 'printing') return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    const device = this.info.device;
    this.set({ state: 'connecting', error: null });
    this.connecting = (async () => {
      try {
        await this.transport!.connect(device.address);
        this.set({ state: 'connected', error: null });
        return true;
      } catch (e) {
        this.set({ state: 'disconnected', error: `Không kết nối được máy in: ${msg(e)}` });
        return false;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  /** In một phiếu (bytes ESC/POS). Chưa kết nối ⇒ thử kết nối một lần. Lỗi ⇒ `PrinterError`. */
  print(bytes: Uint8Array): Promise<void> {
    const run = async () => {
      const t = this.need();
      if (!this.info.device) throw new PrinterError('Chưa chọn máy in');
      if (!(await this.connect())) throw new PrinterError(this.info.error ?? 'Chưa kết nối máy in');
      this.set({ state: 'printing' });
      try {
        const chunks = chunkBytes(bytes, this.chunkSize);
        for (let i = 0; i < chunks.length; i++) {
          if (i > 0 && this.chunkDelayMs > 0) await this.sleep(this.chunkDelayMs);
          await t.write(chunks[i]);
        }
        this.set({ state: 'connected', error: null });
      } catch (e) {
        await t.disconnect().catch(() => undefined);
        this.set({ state: 'disconnected', error: `In lỗi: ${msg(e)}` });
        throw new PrinterError(msg(e));
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }
}

/** Đường truyền giả: lưu lại bytes đã in; đặt `fail` để giả lập máy in lỗi / hết giấy. */
export class FakeTransport implements PrinterTransport {
  devices: BtDevice[] = [{ name: 'Máy in giả', address: '00:11:22:33:44:55' }];
  connected: string | null = null;
  /** Mỗi phần tử là một lần `write` (một gói). */
  writes: Uint8Array[] = [];
  fail: string | null = null;
  failConnect: string | null = null;
  private onDrop = new Set<() => void>();

  async listPaired() {
    return this.devices;
  }
  async connect(address: string) {
    if (this.failConnect) throw new Error(this.failConnect);
    if (!this.devices.some((d) => d.address === address)) throw new Error('Không thấy máy in');
    this.connected = address;
  }
  async disconnect() {
    this.connected = null;
  }
  async write(bytes: Uint8Array) {
    if (!this.connected) throw new Error('Chưa kết nối');
    if (this.fail) throw new Error(this.fail);
    this.writes.push(bytes.slice());
  }
  onDisconnect(fn: () => void) {
    this.onDrop.add(fn);
    return () => this.onDrop.delete(fn);
  }
  /** Giả lập máy in tắt giữa chừng. */
  drop() {
    this.connected = null;
    for (const fn of this.onDrop) fn();
  }
  /** Tổng số byte đã in. */
  get printedBytes(): number {
    return this.writes.reduce((s, w) => s + w.length, 0);
  }
}
