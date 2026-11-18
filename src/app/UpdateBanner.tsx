import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_VERSION, fetchServerVersion, hardReload } from './version';

/** Tablet mở cả ngày không có lần tải trang nào, nên tự hỏi máy chủ có bản mới không. */
const CHECK_EVERY_MS = 5 * 60 * 1000;
/** Bấm "Tải lại" mà service worker mới chưa nhận quyền sau ngần này ⇒ tải lại cưỡng bức. */
const RELOAD_FALLBACK_MS = 4000;
/** Bấm "Để sau" thì ẩn banner một lúc rồi nhắc lại. */
const SNOOZE_MS = 30 * 60 * 1000;

export function UpdateBannerView({ onReload, onLater }: { onReload: () => void; onLater: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        data-testid="update-banner"
        role="status"
        className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-lg"
      >
        <RefreshCw aria-hidden className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 text-base font-medium">Có bản cập nhật mới. Tải lại khi rảnh tay.</span>
        <div className="flex gap-2">
          <button type="button" data-testid="update-later" className="btn text-white/80 hover:bg-white/10" onClick={onLater}>
            Để sau
          </button>
          <button type="button" data-testid="update-reload" className="btn btn-primary" onClick={onReload}>
            Tải lại
          </button>
        </div>
      </div>
    </div>
  );
}

export interface UpdateCheckEnv {
  /** Phiên bản đang chạy. */
  current: string;
  fetchVersion: () => Promise<string | null>;
  /** Tải lại chắc chắn ra bản mới (gỡ service worker + cache). */
  hardReload: () => void;
}

const defaultEnv: UpdateCheckEnv = { current: APP_VERSION, fetchVersion: () => fetchServerVersion(), hardReload: () => void hardReload() };

/**
 * Banner "Có bản cập nhật mới". Hai nguồn báo, nguồn nào thấy trước cũng được:
 * - service worker mới đã cài xong và đang chờ (vite-plugin-pwa);
 * - `/version.json` trên server khác phiên bản đang chạy — hỏi mỗi 5 phút, khi bật lại màn hình, khi có mạng lại.
 *   Tablet chạy cả ngày (ghim màn hình, không tải lại trang) vẫn biết có bản mới, không phụ thuộc trình duyệt kiểm tra sw.js.
 * "Tải lại": có service worker chờ thì kích hoạt nó; không có / kẹt thì gỡ service worker rồi tải lại trang.
 */
export function UpdateBanner({ env = defaultEnv }: { env?: UpdateCheckEnv }) {
  const [snoozed, setSnoozed] = useState(false);
  const [stale, setStale] = useState(false);
  const regRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      regRef.current = reg;
    },
  });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!navigator.onLine) return;
      const latest = await env.fetchVersion();
      if (!alive || !latest || latest === env.current) return;
      setStale(true);
      // Cho service worker cài sẵn bản mới (để "Tải lại" nhanh, không phải tải hết từ đầu).
      const reg = regRef.current;
      if (reg && !reg.installing) reg.update().catch(() => undefined);
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const onOnline = () => void check();
    void check();
    const t = setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [env]);

  useEffect(() => {
    if (!snoozed) return;
    const t = setTimeout(() => setSnoozed(false), SNOOZE_MS);
    return () => clearTimeout(t);
  }, [snoozed]);

  function reload() {
    if (!needRefresh) return env.hardReload();
    void updateServiceWorker(true);
    // Service worker mới không nhận quyền điều khiển (kẹt) ⇒ vẫn tải lại được.
    setTimeout(env.hardReload, RELOAD_FALLBACK_MS);
  }

  if (!(needRefresh || stale) || snoozed) return null;
  return <UpdateBannerView onReload={reload} onLater={() => setSnoozed(true)} />;
}
