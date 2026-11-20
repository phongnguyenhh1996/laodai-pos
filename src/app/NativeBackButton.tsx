import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/** Màn gốc: Back ở đây không lùi được nữa ⇒ phải bấm 2 lần mới thu nhỏ app. */
const ROOT_PATHS = ['/', '/activate'];
const EXIT_WINDOW_MS = 2000;

/**
 * Nút Back của Android trong app native (Capacitor). Mặc định Android đóng luôn app; ở đây:
 * 1. Đang mở bảng chọn (Sheet) có nút X ⇒ đóng bảng. Bảng không có nút X ⇒ bỏ qua (bắt chọn trong bảng).
 * 2. Không ở màn gốc ⇒ lùi lại một màn (hết lịch sử thì về màn hàng đợi).
 * 3. Ở màn gốc ⇒ bấm lần 1 hiện nhắc, bấm lần 2 trong 2 giây ⇒ thu nhỏ app (không tắt, giữ kết nối máy in).
 * PWA / trình duyệt: không làm gì.
 */
export function NativeBackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const lastPress = useRef(0);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return;
    const handle = CapApp.addListener('backButton', ({ canGoBack }) => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const top = dialogs[dialogs.length - 1];
      if (top) {
        top.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')?.click();
        return;
      }

      if (!ROOT_PATHS.includes(pathRef.current)) {
        if (canGoBack) window.history.back();
        else navigate('/', { replace: true });
        return;
      }

      const now = Date.now();
      if (now - lastPress.current < EXIT_WINDOW_MS) {
        lastPress.current = 0;
        setHint(false);
        void CapApp.minimizeApp();
      } else {
        lastPress.current = now;
        setHint(true);
      }
    });
    return () => void handle.then((h) => h.remove());
  }, [navigate]);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), EXIT_WINDOW_MS);
    return () => clearTimeout(t);
  }, [hint]);

  if (!hint) return null;
  return (
    <div
      role="status"
      data-testid="back-exit-hint"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
    >
      <span className="rounded-full bg-black/80 px-4 py-2 text-base font-medium text-white shadow-raised">
        Bấm Back lần nữa để thoát
      </span>
    </div>
  );
}
