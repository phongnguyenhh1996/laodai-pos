import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { toBase64 } from './escpos';
import type { BtDevice, PrinterTransport } from './printer';

/**
 * Cầu nối tới plugin Java `LaodaiPrinter` (android/app/src/main/java/.../LaodaiPrinterPlugin.java):
 * Bluetooth Classic SPP (RFCOMM, UUID 00001101-…), liệt kê máy đã ghép, kết nối, ghi bytes.
 */
interface LaodaiPrinterPlugin {
  listPaired(): Promise<{ devices: BtDevice[] }>;
  connect(opts: { address: string }): Promise<void>;
  disconnect(): Promise<void>;
  write(opts: { data: string }): Promise<void>;
  addListener(event: 'disconnected', fn: () => void): Promise<PluginListenerHandle>;
}

const LaodaiPrinter = registerPlugin<LaodaiPrinterPlugin>('LaodaiPrinter');

/** Đang chạy trong app Android (Capacitor) ⇒ in được trực tiếp. PWA / trình duyệt ⇒ không. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LaodaiPrinter');
  } catch {
    return false;
  }
}

export function nativeTransport(): PrinterTransport {
  return {
    listPaired: async () => (await LaodaiPrinter.listPaired()).devices,
    connect: (address) => LaodaiPrinter.connect({ address }),
    disconnect: () => LaodaiPrinter.disconnect(),
    write: (bytes) => LaodaiPrinter.write({ data: toBase64(bytes) }),
    onDisconnect(fn) {
      const h = LaodaiPrinter.addListener('disconnected', fn);
      return () => void h.then((x) => x.remove());
    },
  };
}
