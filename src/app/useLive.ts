import { useEffect, useState } from 'react';

/** Giờ hiện tại, cập nhật mỗi `intervalMs` (đồng hồ chờ trên hàng đợi). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
