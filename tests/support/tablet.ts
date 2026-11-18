// Tablet thật (src/pos: TabletStore + Pos + backend Supabase) chạy bằng phiên vai trò tablet trên Supabase local.
import type { SupabaseClient } from '@supabase/supabase-js';
import { Pos, TabletStore, createSupabaseBackend, type PosBackend } from '@/pos';

export interface LiveTablet {
  store: TabletStore;
  pos: Pos;
  stop(): void;
}

/**
 * `realtime: false` (mặc định): không mở kênh Realtime, không hẹn giờ; test tự gọi `store.refresh()`.
 * `realtime: true`: nghe `live_pulse` thật như trên tablet.
 */
export async function liveTablet(client: SupabaseClient, profileId: string, { realtime = false } = {}): Promise<LiveTablet> {
  const real = createSupabaseBackend(client);
  const backend: PosBackend = realtime
    ? real
    : {
        ...real,
        subscribe: (_p, _onPulse, onStatus) => {
          onStatus('live');
          return () => undefined;
        },
      };
  const store = new TabletStore(backend, realtime ? { debounceMs: 50 } : { schedule: () => () => undefined });
  store.start(profileId);
  await store.refresh();
  return { store, pos: new Pos(store, { retryDelaysMs: [] }), stop: () => store.stop() };
}
