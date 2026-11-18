declare const __APP_VERSION__: string;

/** Phiên bản đang chạy (commit + giờ build), do vite.config.ts ghi vào lúc build. */
export const APP_VERSION: string = __APP_VERSION__;

/** Phiên bản mới nhất trên server (`/version.json`, không cache). Không đọc được (mất mạng…) ⇒ null. */
export async function fetchServerVersion(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: unknown }).version;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/**
 * Tải lại chắc chắn ra bản mới: gỡ service worker + xóa cache của nó rồi tải lại trang.
 * Không đụng tới localStorage (phiên tablet, hồ sơ kích hoạt) nên không phải kích hoạt lại.
 */
export async function hardReload(win: Window = window): Promise<void> {
  try {
    const regs = (await win.navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await win.caches?.keys()) ?? [];
    await Promise.all(keys.map((k) => win.caches.delete(k)));
  } finally {
    win.location.reload();
  }
}
