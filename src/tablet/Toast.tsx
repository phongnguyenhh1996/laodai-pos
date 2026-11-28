import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';

/** Toast còn hiện bao lâu. */
export const TOAST_MS = 4000;

/** ok: đã thu; info: đã xóa / đơn đổi ở máy khác; error: in lỗi. */
export type ToastTone = 'ok' | 'info' | 'error';

interface ToastItem {
  id: number;
  text: ReactNode;
  tone: ToastTone;
}

const ToastContext = createContext<(text: ReactNode, tone?: ToastTone) => void>(() => {});

/** Báo một sự kiện một lần (đã thanh toán, đã xóa, đơn đổi ở máy khác…). Trạng thái kéo dài thì không dùng toast. */
export function useToast() {
  return useContext(ToastContext);
}

/** Figma S16–S18 / P11: viên tối, icon nhạt theo loại; in lỗi là viên đỏ đậm. */
const TONE: Record<ToastTone, { cls: string; icon: ReactNode }> = {
  ok: { cls: 'bg-ink', icon: <CircleCheck aria-hidden className="h-5 w-5 shrink-0 text-success-tint" /> },
  info: { cls: 'bg-ink', icon: <CircleAlert aria-hidden className="h-5 w-5 shrink-0 text-warning-tint" /> },
  error: { cls: 'bg-danger-strong py-3', icon: <TriangleAlert aria-hidden className="h-5 w-5 shrink-0 text-white" /> },
};

/**
 * Chỗ hiện toast của màn bán hàng: tablet giữa cột thực đơn (không che giỏ), điện thoại ngay dưới header.
 * Không chặn thao tác bên dưới. `extra` là toast do nơi khác quản lý (in lỗi), vẽ cùng chồng.
 */
export function ToastHost({ extra, children }: { extra?: ReactNode; children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: ReactNode, tone: ToastTone = 'ok') => {
    const id = ++seq.current;
    // Tối đa 3 toast; cái mới nằm trên cùng.
    setItems((l) => [{ id, text, tone }, ...l].slice(0, 3));
  }, []);
  const close = (id: number) => setItems((l) => l.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 top-[60px] z-40 flex flex-col items-stretch gap-2 md:left-60 md:right-[380px] md:top-[78px] md:items-center lg:right-[390px]"
      >
        {extra}
        {items.map((t) => (
          <Toast key={t.id} tone={t.tone} testId="toast" onClose={() => close(t.id)} ms={TOAST_MS}>
            {t.text}
          </Toast>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Một toast: tự ẩn sau `ms`; `actions` là nút phụ (vd. "In lại"). */
export function Toast({ tone, testId, onClose, ms, actions, children }: { tone: ToastTone; testId: string; onClose: () => void; ms: number; actions?: ReactNode; children: ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => closeRef.current(), ms);
    return () => clearTimeout(t);
  }, [ms]);
  const { cls, icon } = TONE[tone];
  return (
    <div
      data-testid={testId}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      className={`toast-in pointer-events-auto flex min-h-[48px] max-w-full items-center gap-3 rounded-2xl px-4 py-2 text-base font-medium text-white shadow-raised ${cls}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {actions}
    </div>
  );
}
