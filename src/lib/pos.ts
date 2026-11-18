import { Pos, TabletStore, browserNetwork, browserVisibility, createSupabaseBackend } from '@/pos';
import { drainLegacyOutbox } from '@/pos/legacy';
import { supabase } from './supabase';

/**
 * Trạng thái màn bán hàng (danh mục, ca, đơn đang mở) lấy thẳng từ server bằng phiên vai trò `tablet`
 * của client chính, cập nhật qua Realtime. Chạy suốt vòng đời app từ lúc vào màn bán hàng.
 */
export const tabletStore = new TabletStore(createSupabaseBackend(supabase), {
  network: typeof window === 'undefined' ? undefined : browserNetwork(window),
  visibility: typeof document === 'undefined' ? undefined : browserVisibility(document),
});

/** Các thao tác bán hàng (ghi thẳng lên server). */
export const pos = new Pos(tabletStore);

let legacyDone = false;

/** Máy từng chạy bản offline: gửi nốt thao tác còn kẹt trong IndexedDB cũ (một lần), rồi tải lại. */
async function drainLegacy(): Promise<void> {
  if (legacyDone) return;
  legacyDone = true;
  try {
    const r = await drainLegacyOutbox(tabletStore.api);
    if (r.remaining > 0) legacyDone = false; // mất mạng: lần sau thử tiếp
    if (r.sent + r.rejected > 0) await tabletStore.refresh();
  } catch (e) {
    legacyDone = false;
    console.warn('Không gửi được thao tác cũ của bản offline', e);
  }
}

export function startTablet(profileId: string): void {
  tabletStore.start(profileId);
  void drainLegacy();
}
