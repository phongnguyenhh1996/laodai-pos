// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { SyncRunner, SyncStatus } from '@/sync';
import { SyncBadge, syncLabel } from './SyncBadge';

const st = (state: SyncStatus['state'], pending = 0): SyncStatus => ({ state, pending, lastError: null, lastSyncedAt: null });

function fakeRunner(initial: SyncStatus) {
  let status = initial;
  const fns = new Set<(s: SyncStatus) => void>();
  return {
    runner: {
      getStatus: () => status,
      subscribe: (fn: (s: SyncStatus) => void) => {
        fns.add(fn);
        return () => fns.delete(fn);
      },
    } as unknown as SyncRunner,
    set(s: SyncStatus) {
      status = s;
      fns.forEach((fn) => fn(s));
    },
  };
}

describe('SyncBadge', () => {
  it('nhãn theo trạng thái: đã sync / đang chờ N thao tác / offline', () => {
    expect(syncLabel(st('synced'))).toBe('Đã đồng bộ');
    expect(syncLabel(st('pending', 3))).toBe('Đang chờ 3 thao tác');
    expect(syncLabel(st('retrying', 2))).toBe('Mất kết nối máy chủ · chờ 2 thao tác');
    expect(syncLabel(st('offline', 5))).toBe('Offline · chờ 5 thao tác');
    expect(syncLabel(st('offline'))).toBe('Offline');
  });

  it('cập nhật theo runner, chỉ hiện số thao tác chờ', () => {
    const f = fakeRunner(st('synced'));
    render(<SyncBadge runner={f.runner} />);
    const el = screen.getByTestId('sync-status');
    expect(el).toHaveAttribute('data-state', 'synced');
    act(() => f.set(st('offline', 4)));
    expect(el).toHaveAttribute('data-state', 'offline');
    expect(el).toHaveAttribute('data-pending', '4');
    expect(el).toHaveTextContent('Offline · chờ 4 thao tác');
  });
});
