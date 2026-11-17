import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input'] as const;

/** Gọi `onIdle` khi không có thao tác nào trong `ms` mili-giây; mỗi thao tác đặt lại đồng hồ. */
export function useIdleTimeout(ms: number, onIdle: () => void, enabled = true): void {
  const cb = useRef(onIdle);
  cb.current = onIdle;

  useEffect(() => {
    if (!enabled) return;
    let timer = setTimeout(() => cb.current(), ms);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), ms);
    };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, reset, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, reset, { capture: true });
    };
  }, [ms, enabled]);
}
