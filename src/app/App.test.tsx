// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { App } from './App';
import { tabletStore } from '@/lib/pos';
import { AuthError, enterOwnerModeOnTablet, exitOwnerMode } from '@/lib/auth';
import { OWNER_IDLE_MS } from '@/owner/OwnerGate';
import { COMBO_XOI_FULL, COM_GA, PRODUCTS, XOI_GA } from '@/domain/fixtures';
import { storeSession } from '@/test-utils/auth';
import { ACT, CATALOG, activateDevice, resetTablet, server, useFakeServer } from '@/test-utils/tablet';

vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth')>()),
  enterOwnerModeOnTablet: vi.fn(),
  exitOwnerMode: vi.fn(),
}));

function go(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
}

beforeEach(() => {
  useFakeServer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  resetTablet();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});


/** Client chủ giả: Tổng quan gọi `rpc('owner_dashboard')` (để treo) và đăng ký Realtime. */
function fakeOwnerClient(): SupabaseClient {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    rpc: () => new Promise(() => undefined),
    channel: () => channel,
    removeChannel: () => Promise.resolve('ok'),
  } as unknown as SupabaseClient;
}

describe('cổng tablet', () => {
  it('tablet chưa kích hoạt: đường dẫn bán hàng chuyển về màn kích hoạt', async () => {
    go('/queue');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/activate');
  });

  it('tablet đã kích hoạt (hồ sơ + phiên tablet): vào màn chọn nhân viên', async () => {
    activateDevice();
    go('/');
    expect(await screen.findByTestId('tablet-home')).toHaveTextContent('Tablet A');
    expect(await screen.findByTestId('staff-s1')).toHaveTextContent('Lan');
    // Nghe server từ lúc vào màn bán hàng, có chỉ báo kết nối
    await waitFor(() => expect(screen.getByTestId('conn-status')).toHaveAttribute('data-state', 'live'));
    expect(tabletStore.started).toBe(true);
  });

  it('danh mục từ server: chỉ nhân viên còn làm, tab theo hồ sơ tablet, bảng giá theo điểm; chủ đổi ⇒ cập nhật ngay', async () => {
    activateDevice();
    go('/');
    expect(await screen.findByTestId('staff-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-s9')).not.toBeInTheDocument();
    // Bảng chọn món nằm trong màn tạo đơn (sau khi mở ca)
    fireEvent.click(screen.getByTestId('staff-s1'));
    fireEvent.click(screen.getByTestId('open-shift'));
    fireEvent.click(await screen.findByTestId('new-order'));
    await screen.findByTestId('menu-board');
    // Hồ sơ A: Xôi A + Cơm gà, không có Xôi B
    expect(screen.getByTestId('point-tab-xoi-a')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('point-tab-com')).toBeInTheDocument();
    expect(screen.queryByTestId('point-tab-xoi-b')).not.toBeInTheDocument();
    expect(screen.getByTestId(`menu-product-${XOI_GA.id}-price`)).toHaveTextContent('25.000');
    expect(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}-price`)).toHaveTextContent('39.000');
    fireEvent.click(screen.getByTestId('point-tab-com'));
    expect(screen.getByTestId('menu-panel')).toHaveAttribute('data-point', 'com');
    expect(screen.getByTestId(`menu-product-${COM_GA.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`menu-product-${XOI_GA.id}`)).not.toBeInTheDocument();

    // Chủ bỏ Cơm gà khỏi tablet A, đổi giá: server báo qua realtime ⇒ màn hình cập nhật ngay
    server.catalog = {
      ...CATALOG,
      profile: { ...CATALOG.profile, point_ids: ['xoi-a'] },
      products: PRODUCTS.map((p) => (p.id === XOI_GA.id ? { ...p, price: 28_000 } : p)),
    };
    act(() => server.pulse('catalog'));
    await waitFor(() => expect(screen.queryByTestId('point-tab-com')).not.toBeInTheDocument());
    expect(screen.getByTestId('menu-panel')).toHaveAttribute('data-point', 'xoi-a');
    expect(screen.getByTestId(`menu-product-${XOI_GA.id}-price`)).toHaveTextContent('28.000');
  });

  it('hồ sơ không còn điểm bán nào: báo nhờ chủ cài đặt', async () => {
    server.catalog = { ...CATALOG, profile: { ...CATALOG.profile, point_ids: [] } };
    activateDevice();
    go('/');
    fireEvent.click(await screen.findByTestId('staff-s1'));
    fireEvent.click(screen.getByTestId('open-shift'));
    fireEvent.click(await screen.findByTestId('new-order'));
    expect(await screen.findByTestId('menu-no-points')).toBeInTheDocument();
  });

  it('chưa tải được danh mục (lỗi): báo cần mạng', async () => {
    server.catalogFails = true;
    activateDevice();
    go('/');
    expect(await screen.findByTestId('catalog-error')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-board')).not.toBeInTheDocument();
  });

  it('có hồ sơ kích hoạt nhưng không có phiên tablet (chép dữ liệu máy sang máy khác): về màn kích hoạt', async () => {
    activateDevice(null);
    go('/');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
  });

  it('phiên của hồ sơ khác hoặc phiên chủ không thay được phiên tablet', async () => {
    activateDevice({ role: 'tablet', tablet_profile_id: 'tab-b' });
    go('/');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
  });

  it('tablet đã kích hoạt vào /activate ⇒ về màn bán hàng', async () => {
    activateDevice();
    go('/activate');
    expect(await screen.findByTestId('tablet-home')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
});

describe('chế độ chủ trên tablet', () => {
  it('/owner/... trên tablet chỉ hỏi mật khẩu chủ', async () => {
    activateDevice();
    go('/owner/shifts');
    expect(await screen.findByTestId('owner-unlock')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-email')).not.toBeInTheDocument();
    expect(screen.queryByTestId('owner-home')).not.toBeInTheDocument();
  });

  it('sai mật khẩu: báo lỗi, vẫn khóa', async () => {
    vi.mocked(enterOwnerModeOnTablet).mockRejectedValue(new AuthError('bad_credentials'));
    activateDevice();
    go('/owner');
    fireEvent.change(await screen.findByTestId('owner-password'), { target: { value: 'sai' } });
    fireEvent.click(screen.getByTestId('owner-unlock-submit'));
    expect(await screen.findByTestId('owner-error')).toHaveTextContent('Sai email hoặc mật khẩu');
    expect(screen.queryByTestId('owner-home')).not.toBeInTheDocument();
  });

  it('đúng mật khẩu: vào chế độ chủ; 2 phút không thao tác ⇒ tự thoát về bán hàng và thu hồi phiên tạm', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    const fakeOwner = fakeOwnerClient();
    vi.mocked(enterOwnerModeOnTablet).mockResolvedValue(fakeOwner);
    activateDevice();
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
    const fakeOwner = fakeOwnerClient();
    vi.mocked(enterOwnerModeOnTablet).mockResolvedValue(fakeOwner);
    activateDevice();
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
