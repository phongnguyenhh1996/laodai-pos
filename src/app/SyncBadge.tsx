import { useSyncExternalStore } from 'react';
import { CloudOff, CloudUpload, RefreshCw, CircleCheck, type LucideIcon } from 'lucide-react';
import type { SyncRunner, SyncStatus } from '@/sync';

export function useSyncStatus(runner: SyncRunner): SyncStatus {
  return useSyncExternalStore(
    (cb) => runner.subscribe(cb),
    () => runner.getStatus(),
  );
}

const STYLE: Record<SyncStatus['state'], string> = {
  synced: 'bg-success-soft text-success-strong border-success-line',
  pending: 'bg-warning-soft text-warning-strong border-warning-line',
  retrying: 'bg-danger-soft text-danger-strong border-danger-line',
  offline: 'bg-surface-sunken text-ink border-line-strong',
};

const ICON: Record<SyncStatus['state'], LucideIcon> = {
  synced: CircleCheck,
  pending: CloudUpload,
  retrying: RefreshCw,
  offline: CloudOff,
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
  const Icon = ICON[s.state];
  return (
    <span
      data-testid="sync-status"
      data-state={s.state}
      data-pending={s.pending}
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${STYLE[s.state]}`}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      {syncLabel(s)}
    </span>
  );
}
