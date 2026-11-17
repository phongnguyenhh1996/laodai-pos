import { useSyncExternalStore } from 'react';
import type { SyncRunner, SyncStatus } from '@/sync';

export function useSyncStatus(runner: SyncRunner): SyncStatus {
  return useSyncExternalStore(
    (cb) => runner.subscribe(cb),
    () => runner.getStatus(),
  );
}

const STYLE: Record<SyncStatus['state'], string> = {
  synced: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  retrying: 'bg-orange-50 text-orange-800 border-orange-200',
  offline: 'bg-stone-100 text-stone-700 border-stone-300',
};

export function syncLabel(s: SyncStatus): string {
  const waiting = `chờ ${s.pending} thao tác`;
  switch (s.state) {
    case 'synced':
      return 'Đã đồng bộ';
    case 'pending':
      return `Đang ${waiting}`;
    case 'retrying':
      return `Mất kết nối máy chủ · ${waiting}`;
    case 'offline':
      return s.pending > 0 ? `Offline · ${waiting}` : 'Offline';
  }
}

/** Chỉ báo đồng bộ (mục 7). Không hiện gì về doanh thu, chỉ số thao tác chờ gửi. */
export function SyncBadge({ runner }: { runner: SyncRunner }) {
  const s = useSyncStatus(runner);
  return (
    <span
      data-testid="sync-status"
      data-state={s.state}
      data-pending={s.pending}
      role="status"
      className={`inline-flex items-center rounded-full border px-3 py-1 text-base font-medium ${STYLE[s.state]}`}
    >
      {syncLabel(s)}
    </span>
  );
}
