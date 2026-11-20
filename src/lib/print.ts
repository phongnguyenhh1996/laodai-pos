import { useSyncExternalStore } from 'react';
import { buildQueue } from '@/domain/queue';
import type { Order } from '@/domain/types';
import { deviceId, type PosEvent } from '@/pos';
import { diffItems } from '@/print/diff';
import { isNativeApp, nativeTransport } from '@/print/native';
import { FakeTransport, PRINTER_KEY, Printer, type PrinterInfo } from '@/print/printer';
import { PrintService, supabasePrintApi, type PrintApi, type PrintServiceState } from '@/print/service';
import { pos, tabletStore } from './pos';
import { supabase } from './supabase';

/**
 * In phiếu bếp & bill trên máy này (SPEC mục 12). Chỉ app Android (Capacitor) in trực tiếp được;
 * PWA / trình duyệt có `printer.supported = false` ⇒ không tự in, không tạo lệnh.
 *
 * - Tạo đơn xong (server đã cấp mã) ⇒ phiếu bếp nếu bật `auto_print_kitchen`.
 * - Sửa đơn ⇒ phiếu "ĐÃ SỬA" + món thêm / bớt nếu bật `auto_reprint_kitchen_on_edit`.
 * - Thanh toán xong (kể cả ghi nợ) ⇒ bill nếu bật `auto_print_bill`.
 * - Lệnh in từ xa của chủ: nghe Realtime, máy có máy in đang kết nối nhận lệnh.
 */

/** Số thứ tự của đơn trên hàng đợi hiện tại (phiếu bếp). */
function queueNo(orderId: string): number | null {
  const s = tabletStore.getSnapshot();
  const orders = s.open?.orders ?? [];
  const q = buildQueue(orders, Date.now(), s.catalog?.config ?? { wait_yellow_min: 5, wait_red_min: 10 });
  return [...q.serve, ...q.pay].find((c) => c.order.id === orderId)?.position ?? null;
}

/**
 * Máy in giả cho E2E: chỉ có khi build với `VITE_FAKE_PRINTER=1` (bản production không có) VÀ máy đặt
 * `localStorage['laodai-fake-printer'] = '1'`. Cypress đọc / điều khiển qua `window.__laodaiFakePrinter`.
 */
function wantsFakePrinter(): boolean {
  try {
    return globalThis.localStorage?.getItem('laodai-fake-printer') === '1';
  } catch {
    return false;
  }
}

function makePrinter(): Printer {
  // Cờ build thay bằng hằng số lúc build ⇒ bản production bỏ hẳn nhánh này.
  if (import.meta.env.VITE_FAKE_PRINTER === '1' && wantsFakePrinter()) {
    const t = new FakeTransport();
    (globalThis as { __laodaiFakePrinter?: FakeTransport }).__laodaiFakePrinter = t;
    localStorage.setItem(PRINTER_KEY, JSON.stringify(t.devices[0]));
    return new Printer(t);
  }
  return new Printer(isNativeApp() ? nativeTransport() : null);
}

function createService(api: PrintApi = supabasePrintApi(supabase), printer = makePrinter()) {
  return new PrintService(api, printer, deviceId(), { queueNo, tz: tabletStore.getSnapshot().catalog?.config.timezone });
}

let service = createService();

export function printService(): PrintService {
  return service;
}

/** Test / E2E: thay bằng lệnh in + máy in giả. */
export function setPrintService(s: PrintService): void {
  service.stop();
  service = s;
  s.setQueueNo(queueNo);
  startedFor = null;
  notify();
}

const swapListeners = new Set<() => void>();
const notify = () => swapListeners.forEach((fn) => fn());

/** Công tắc in tự động của quầy (thiếu ⇒ bật). */
function autoFlag(key: 'auto_print_kitchen' | 'auto_reprint_kitchen_on_edit' | 'auto_print_bill'): boolean {
  return tabletStore.getSnapshot().catalog?.profile[key] !== false;
}

/** Tablet tự lưu từng chạm khi sửa đơn ⇒ gom các lần sửa liên tiếp thành MỘT phiếu "ĐÃ SỬA" (chờ yên lặng). */
let editDelayMs = 4000;
const pendingEdits = new Map<string, { before: Order; after: Order; timer: ReturnType<typeof setTimeout> }>();

export function setEditDelay(ms: number): void {
  editDelayMs = ms;
}

function sameHeader(a: Order, b: Order): boolean {
  return a.dine_type === b.dine_type && a.label === b.label && a.table_no === b.table_no && a.point_id === b.point_id;
}

function flushEdit(orderId: string): void {
  const p = pendingEdits.get(orderId);
  if (!p) return;
  clearTimeout(p.timer);
  pendingEdits.delete(orderId);
  const { added, removed } = diffItems(p.before.items, p.after.items);
  // Sửa rồi sửa lại như cũ ⇒ không in.
  if (!added.length && !removed.length && sameHeader(p.before, p.after)) return;
  void service.printKitchen(p.after.id, p.after.code, 'auto', { at: new Date().toISOString(), added, removed });
}

export function handlePosEvent(e: PosEvent): void {
  const s = service;
  if (!s.enabled) return;
  if (e.type === 'order_created') {
    if (autoFlag('auto_print_kitchen')) void s.printKitchen(e.order.id, e.order.code, 'auto');
  } else if (e.type === 'order_updated') {
    if (!autoFlag('auto_reprint_kitchen_on_edit')) return;
    const prev = pendingEdits.get(e.after.id);
    if (prev) clearTimeout(prev.timer);
    const id = e.after.id;
    pendingEdits.set(id, { before: prev?.before ?? e.before, after: e.after, timer: setTimeout(() => flushEdit(id), editDelayMs) });
  } else if (e.type === 'order_deleted') {
    // Xóa đơn thì không in.
    const p = pendingEdits.get(e.order.id);
    if (p) clearTimeout(p.timer);
    pendingEdits.delete(e.order.id);
  } else {
    flushEdit(e.order.id);
    if (autoFlag('auto_print_bill')) void s.printBill(e.order.id, e.order.code);
  }
}

pos.onEvent((e) => handlePosEvent(e));

let startedFor: string | null = null;

/** Bắt đầu nghe lệnh in từ xa của quầy + tự kết nối máy in (gọi cùng lúc `startTablet`). */
export function startPrinting(profileId: string): void {
  if (startedFor === profileId) return;
  startedFor = profileId;
  service.start(profileId);
}

export function stopPrinting(): void {
  startedFor = null;
  service.stop();
}

const subscribeAll = (fn: () => void) => {
  swapListeners.add(fn);
  const a = service.subscribe(fn);
  const b = service.printer.subscribe(fn);
  return () => {
    swapListeners.delete(fn);
    a();
    b();
  };
};

/** Trạng thái máy in + lỗi in gần nhất cho giao diện. */
export function usePrint(): { service: PrintService; state: PrintServiceState; printer: PrinterInfo } {
  useSyncExternalStore(subscribeAll, () => `${service.getSnapshot().printed}|${service.getSnapshot().busy}|${service.getSnapshot().failure?.at}|${JSON.stringify(service.printer.getSnapshot())}`);
  return { service, state: service.getSnapshot(), printer: service.printer.getSnapshot() };
}
