import { useSyncExternalStore } from 'react';

/** Theo dõi một media query. Không có `matchMedia` (jsdom) ⇒ luôn false. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}

/** Màn rộng như tablet (≥ 768px, trùng breakpoint `md:` của Tailwind). */
export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
