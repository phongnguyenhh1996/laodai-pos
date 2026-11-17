import { SyncRunner, browserNetwork, createRpcTransport } from '@/sync';
import { localDb } from './localdb';
import { supabase } from './supabase';

/**
 * Bộ đồng bộ của tablet: đẩy outbox lên `sync_push` bằng phiên vai trò `tablet` của client chính.
 * Chỉ khởi động trên tablet đã kích hoạt; chạy suốt vòng đời app (kể cả khi đang ở chế độ chủ).
 */
export const syncRunner = new SyncRunner(localDb, createRpcTransport(supabase), {
  network: typeof window === 'undefined' ? undefined : browserNetwork(window),
});

export function ensureSyncStarted(): void {
  syncRunner.start();
}
