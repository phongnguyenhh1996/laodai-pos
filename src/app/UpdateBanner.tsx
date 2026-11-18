import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Tablet mở cả ngày không có lần tải trang nào, nên tự hỏi máy chủ có bản mới không. */
const CHECK_EVERY_MS = 30 * 60 * 1000;
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

export function UpdateBanner() {
  const [snoozed, setSnoozed] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine && !reg.installing) reg.update().catch(() => {});
      };
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  useEffect(() => {
    if (!snoozed) return;
    const t = setTimeout(() => setSnoozed(false), SNOOZE_MS);
    return () => clearTimeout(t);
  }, [snoozed]);

  if (!needRefresh || snoozed) return null;
  return <UpdateBannerView onReload={() => void updateServiceWorker(true)} onLater={() => setSnoozed(true)} />;
}
