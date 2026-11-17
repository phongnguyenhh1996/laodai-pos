import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';

export type LiveState = 'connecting' | 'live' | 'off';

/**
 * Gọi `onChange` (gộp trong `debounceMs`) mỗi khi Supabase Realtime báo một trong các bảng đổi.
 * RLS vẫn áp dụng: chỉ phiên chủ mới nhận được thay đổi của đơn / ca.
 * Kèm làm mới định kỳ (`pollMs`) và khi quay lại tab, phòng khi kết nối realtime rớt.
 */
export function useLiveReload(
  client: SupabaseClient,
  tables: readonly string[],
  onChange: () => void,
  { debounceMs = 250, pollMs = 60_000 }: { debounceMs?: number; pollMs?: number } = {},
): LiveState {
  const [state, setState] = useState<LiveState>('connecting');
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(',');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    };
    let ch = client.channel(`owner-live-${key}-${Math.random().toString(36).slice(2)}`);
    for (const table of key.split(',')) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, fire);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setState('live');
        fire(); // có thể đã lỡ thay đổi trong lúc kết nối
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setState('off');
    });
    const poll = setInterval(() => cb.current(), pollMs);
    const onVisible = () => document.visibilityState === 'visible' && cb.current();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      void client.removeChannel(ch);
    };
  }, [client, key, debounceMs, pollMs]);

  return state;
}
