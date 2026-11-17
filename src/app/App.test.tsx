// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { App } from './App';
import { localDb } from '@/lib/localdb';
import { syncRunner } from '@/lib/sync';
import { supabase } from '@/lib/supabase';
import { AuthError, enterOwnerModeOnTablet, exitOwnerMode } from '@/lib/auth';
import { OWNER_IDLE_MS } from '@/owner/OwnerGate';
import { META, setMeta, type Activation } from '@/sync/db';
import { storeSession } from '@/test-utils/auth';

vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth')>()),
  enterOwnerModeOnTablet: vi.fn(),
  exitOwnerMode: vi.fn(),
}));

const ACT: Activation = { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: 'owner@x.vn' };

function stubStaff() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: [{ id: 's1', name: 'Lan' }], error: null }),
  };
  vi.spyOn(supabase, 'from').mockReturnValue(chain as never);
}

async function activateDevice(session: Parameters<typeof storeSession>[0] | null = { role: 'tablet', tablet_profile_id: 'tab-a' }) {
  await setMeta(localDb, META.activation, ACT);
  if (session) storeSession(session);
}

function go(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
}

beforeEach(stubStaff);

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await localDb.meta.clear();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('cổng tablet', () => {
  it('tablet chưa kích hoạt: đường dẫn bán hàng chuyển về màn kích hoạt', async () => {
    go('/queue');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/activate');
  });

  it('tablet đã kích hoạt (hồ sơ + phiên tablet): vào màn chọn nhân viên', async () => {
    await activateDevice();
    go('/');
    expect(await screen.findByTestId('tablet-home')).toHaveTextContent('Tablet A');
    expect(await screen.findByTestId('staff-s1')).toHaveTextContent('Lan');
    // Bộ đồng bộ chạy từ lúc vào màn bán hàng, có chỉ báo trạng thái
    expect(screen.getByTestId('sync-status')).toHaveAttribute('data-state', 'synced');
    expect(syncRunner.isStarted).toBe(true);
  });

  it('có hồ sơ kích hoạt nhưng không có phiên tablet (chép IndexedDB sang máy khác): về màn kích hoạt', async () => {
    await activateDevice(null);
    go('/');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
  });

  it('phiên của hồ sơ khác hoặc phiên chủ không thay được phiên tablet', async () => {
    await activateDevice({ role: 'tablet', tablet_profile_id: 'tab-b' });
    go('/');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
  });

  it('tablet đã kích hoạt vào /activate ⇒ về màn bán hàng', async () => {
    await activateDevice();
    go('/activate');
    expect(await screen.findByTestId('tablet-home')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});

describe('chế độ chủ trên tablet', () => {
  it('/owner/... trên tablet chỉ hỏi mật khẩu chủ', async () => {
    await activateDevice();
    go('/owner/shifts');
    expect(await screen.findByTestId('owner-unlock')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('owner-home')).not.toBeInTheDocument();
  });

  it('sai mật khẩu: báo lỗi, vẫn khóa', async () => {
    vi.mocked(enterOwnerModeOnTablet).mockRejectedValue(new AuthError('bad_credentials'));
    await activateDevice();
    go('/owner');
    fireEvent.change(await screen.findByTestId('owner-password'), { target: { value: 'sai' } });
    fireEvent.click(screen.getByTestId('owner-unlock-submit'));
    expect(await screen.findByTestId('owner-error')).toHaveTextContent('Sai email hoặc mật khẩu');
    expect(screen.queryByTestId('owner-home')).not.toBeInTheDocument();
  });

  it('đúng mật khẩu: vào chế độ chủ; 2 phút không thao tác ⇒ tự thoát về bán hàng và thu hồi phiên tạm', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    const fakeOwner = { tag: 'owner' } as unknown as SupabaseClient;
    vi.mocked(enterOwnerModeOnTablet).mockResolvedValue(fakeOwner);
    await activateDevice();
    go('/owner');
    fireEvent.change(await screen.findByTestId('owner-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('owner-unlock-submit'));
    expect(await screen.findByTestId('owner-home')).toBeInTheDocument();
    expect(enterOwnerModeOnTablet).toHaveBeenCalledWith(ACT, 'pw');

    act(() => void vi.advanceTimersByTime(OWNER_IDLE_MS - 1_000));
    fireEvent.pointerDown(screen.getByTestId('owner-home')); // thao tác ⇒ đặt lại đồng hồ
    act(() => void vi.advanceTimersByTime(OWNER_IDLE_MS - 1_000));
    expect(screen.getByTestId('owner-home')).toBeInTheDocument();
    expect(exitOwnerMode).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1_000));
    expect(await screen.findByTestId('tablet-home')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(exitOwnerMode).toHaveBeenCalledWith(fakeOwner);
  });

  it('nút Thoát về bán hàng ngay', async () => {
    const fakeOwner = {} as SupabaseClient;
    vi.mocked(enterOwnerModeOnTablet).mockResolvedValue(fakeOwner);
    await activateDevice();
    go('/owner');
    fireEvent.change(await screen.findByTestId('owner-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('owner-unlock-submit'));
    fireEvent.click(await screen.findByTestId('owner-exit'));
    expect(await screen.findByTestId('tablet-home')).toBeInTheDocument();
    await waitFor(() => expect(exitOwnerMode).toHaveBeenCalledWith(fakeOwner));
  });
});

describe('điện thoại chủ (máy chưa kích hoạt)', () => {
  it('chưa đăng nhập: /owner hiện form email + mật khẩu', async () => {
    go('/owner');
    expect(await screen.findByTestId('owner-login')).toBeInTheDocument();
    expect(screen.getByTestId('owner-email')).toBeInTheDocument();
  });

  it('đã có phiên chủ: vào thẳng màn chủ', async () => {
    storeSession({ role: 'owner', email: 'owner@x.vn' });
    go('/owner');
    expect(await screen.findByTestId('owner-home')).toHaveTextContent('owner@x.vn');
    expect(screen.getByTestId('owner-logout')).toBeInTheDocument();
  });

  it('phiên chủ không mở được màn bán hàng', async () => {
    storeSession({ role: 'owner', email: 'owner@x.vn' });
    go('/');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
  });
});
