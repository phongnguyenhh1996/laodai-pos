import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Có chạy hiệu ứng không: trình duyệt có Web Animations và người dùng không tắt chuyển động (jsdom: không). */
export function canAnimate(): boolean {
  if (typeof window === 'undefined' || typeof Element === 'undefined') return false;
  if (typeof Element.prototype.animate !== 'function') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

interface Snap {
  left: number;
  top: number;
  group: string | undefined;
}

function measure(root: HTMLElement): Map<string, Snap> {
  const map = new Map<string, Snap>();
  root.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((el) => {
    const r = el.getBoundingClientRect();
    map.set(el.dataset.flipId!, { left: r.left, top: r.top, group: el.dataset.flipGroup });
  });
  return map;
}

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * FLIP cho thẻ đơn trong `root`: khi `layoutKey` đổi (đơn đổi nhóm / thêm / bớt), mỗi phần tử
 * `[data-flip-id]` trượt từ chỗ cũ tới chỗ mới. Thẻ đổi nhóm (`data-flip-group`) được "nhấc lên"
 * (nổi trên các thẻ khác, to nhẹ, có bóng) trong lúc bay.
 *
 * Vị trí cũ đo ngay trong lúc render (DOM vẫn là bản trước khi commit), nên đúng cả khi đã cuộn
 * hay có thông báo chen vào; thẻ đang bay dở thì đo đúng chỗ đang hiện.
 */
export function useFlip(root: RefObject<HTMLElement>, layoutKey: string) {
  const committed = useRef<string | null>(null);
  const snap = useRef<Map<string, Snap> | null>(null);

  if (root.current && committed.current !== null && committed.current !== layoutKey && !snap.current && canAnimate()) {
    snap.current = measure(root.current);
  }

  useLayoutEffect(() => {
    const first = snap.current;
    snap.current = null;
    committed.current = layoutKey;
    if (!first || !root.current) return;
    root.current.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((el) => {
      const from = first.get(el.dataset.flipId!);
      if (!from) return;
      el.getAnimations().forEach((a) => a.id === 'flip' && a.cancel());
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const regroup = from.group !== el.dataset.flipGroup;
      const anim = regroup
        ? el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px) scale(1)`, boxShadow: '0 0 0 rgba(15, 23, 42, 0)' },
              { transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(1.04)`, boxShadow: '0 18px 40px rgba(15, 23, 42, 0.18)', offset: 0.45 },
              { transform: 'none', boxShadow: '0 0 0 rgba(15, 23, 42, 0)' },
            ],
            { duration: 620, easing: EASE_OUT },
          )
        : el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: EASE_OUT });
      anim.id = 'flip';
      if (regroup) {
        el.style.zIndex = '10';
        el.style.position = 'relative';
        const reset = () => {
          el.style.zIndex = '';
          el.style.position = '';
        };
        anim.onfinish = reset;
        anim.oncancel = reset;
      }
    });
  }, [layoutKey, root]);
}

/** Thời gian thẻ "đã thanh toán" / "biến mất" còn hiện trước khi gỡ khỏi lưới. */
export const EXIT_MS = { paid: 1100, gone: 380 } as const;

/** Hiệu ứng thẻ rời hàng đợi: đã thanh toán ⇒ dấu tích xanh hiện lên rồi thẻ thu nhỏ, mờ dần; còn lại ⇒ chỉ mờ dần. */
export function playExit(card: HTMLElement, overlay: HTMLElement | null, kind: keyof typeof EXIT_MS) {
  if (!canAnimate()) return;
  if (kind === 'paid') {
    overlay?.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.25 },
        { opacity: 1, offset: 1 },
      ],
      { duration: EXIT_MS.paid, fill: 'forwards' },
    );
    overlay?.firstElementChild?.animate(
      [
        { transform: 'scale(0.4)', opacity: 0 },
        { transform: 'scale(1.12)', opacity: 1, offset: 0.6 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 420, delay: 80, easing: EASE_OUT, fill: 'backwards' },
    );
    card.animate(
      [
        { opacity: 1, transform: 'none', offset: 0 },
        { opacity: 1, transform: 'none', offset: 0.55 },
        { opacity: 0, transform: 'scale(0.86) translateY(-6px)', offset: 1 },
      ],
      { duration: EXIT_MS.paid, easing: 'ease-in', fill: 'forwards' },
    );
  } else {
    card.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.92)' },
      ],
      { duration: EXIT_MS.gone, easing: 'ease-in', fill: 'forwards' },
    );
  }
}
