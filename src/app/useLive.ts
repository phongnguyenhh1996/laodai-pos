import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

export type Live<T> = { status: 'loading' } | { status: 'ready'; value: T };

/** Kết quả truy vấn IndexedDB, tự cập nhật khi dữ liệu đổi (Dexie liveQuery). */
export function useLive<T>(query: () => Promise<T>, deps: unknown[]): Live<T> {
  const [state, setState] = useState<Live<T>>({ status: 'loading' });
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: (value) => setState({ status: 'ready', value }),
      error: (e: unknown) => {
        console.error(e);
      },
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Giờ hiện tại, cập nhật mỗi `intervalMs` (đồng hồ chờ trên hàng đợi). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
