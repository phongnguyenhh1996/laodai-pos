import { CatalogRefresher, SyncRunner, browserNetwork, browserVisibility, createRpcTransport, createSupabaseCatalogSource } from '@/sync';
import { localDb } from './localdb';
import { supabase } from './supabase';

const network = typeof window === 'undefined' ? undefined : browserNetwork(window);

/**
 * Bộ đồng bộ của tablet: đẩy outbox lên `sync_push` bằng phiên vai trò `tablet` của client chính.
 * Chỉ khởi động trên tablet đã kích hoạt; chạy suốt vòng đời app (kể cả khi đang ở chế độ chủ).
 */
export const syncRunner = new SyncRunner(localDb, createRpcTransport(supabase), { network });

/** Danh mục (menu, giá, điểm bán, nhân viên, hồ sơ tablet) tải về máy để bán được khi offline. */
export const catalogRefresher = new CatalogRefresher(localDb, createSupabaseCatalogSource(supabase), {
  network,
  visibility: typeof document === 'undefined' ? undefined : browserVisibility(document),
});

export function ensureSyncStarted(): void {
  syncRunner.start();
  catalogRefresher.start();
}
