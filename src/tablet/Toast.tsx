import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';

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

/** Figma BH15–BH17 / BHP10: viên tối bo 14, icon 18 (đã thu: tích xanh lá, máy khác: info xám); in lỗi là viên đỏ đậm. */
const TONE: Record<ToastTone, { cls: string; icon: ReactNode }> = {
  ok: { cls: 'bg-[#111]', icon: <CircleCheck aria-hidden className="h-[18px] w-[18px] shrink-0 text-[#4ade80]" /> },
  info: { cls: 'bg-[#111]', icon: <Info aria-hidden className="h-[18px] w-[18px] shrink-0 text-[#bdbdbd]" /> },
  error: { cls: 'bg-[#b42318]', icon: <TriangleAlert aria-hidden className="h-[18px] w-[18px] shrink-0 text-white" /> },
};

/**
 * Chỗ hiện toast của màn bán hàng: tablet giữa cột giữa (không che giỏ), điện thoại ngay dưới header, sát trái.
 * Không chặn thao tác bên dưới. `extra` là toast do nơi khác quản lý (in lỗi), vẽ cùng chồng.
 * Sang màn khác ⇒ bỏ các toast đang hiện (vd. "Đã thu 31.000" không được theo sang màn Đóng ca đếm mù).
 */
export function ToastHost({ extra, children }: { extra?: ReactNode; children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const { pathname } = useLocation();
  useEffect(() => setItems([]), [pathname]);
  const show = useCallback((text: ReactNode, tone: ToastTone = 'ok') => {
    const id = ++seq.current;
    // Tối đa 3 toast; cái mới nằm trên cùng.
    setItems((l) => [{ id, text, tone }, ...l].slice(0, 3));
  }, []);
  const close = (id: number) => setItems((l) => l.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 top-[66px] z-40 flex flex-col items-start gap-2 md:left-60 md:right-[380px] md:top-[78px] md:items-center">
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
      className={`toast-in pointer-events-auto flex min-h-[42px] max-w-full items-center gap-2.5 rounded-[14px] py-3 pl-3.5 text-sm font-semibold leading-[18px] text-white shadow-[0_12px_32px_rgba(0,0,0,0.16)] ${actions ? 'pr-2' : 'pr-4'} ${cls}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {actions}
    </div>
  );
}
