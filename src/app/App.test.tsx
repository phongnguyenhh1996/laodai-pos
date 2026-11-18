// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { App } from './App';
import { tabletStore } from '@/lib/pos';
import { AuthError, enterOwnerModeOnTablet, exitOwnerMode, listTabletProfiles, switchTablet } from '@/lib/auth';
import { readActivation, writeActivation } from '@/pos';
import { OWNER_IDLE_MS } from '@/owner/OwnerGate';
import { COMBO_XOI_FULL, COM_GA, PRODUCTS, XOI_GA } from '@/domain/fixtures';
import { storeSession } from '@/test-utils/auth';
import { ACT, CATALOG, activateDevice, resetTablet, server, useFakeServer } from '@/test-utils/tablet';

vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth')>()),
  enterOwnerModeOnTablet: vi.fn(),
  exitOwnerMode: vi.fn(),
  listTabletProfiles: vi.fn(),
  switchTablet: vi.fn(),
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

  it('chủ đổi tên quầy: màn bán hàng hiện tên mới ngay (không cần kích hoạt lại), tên mới ghi lại xuống máy', async () => {
    server.catalog = { ...CATALOG, profile: { ...CATALOG.profile, name: 'Quầy chợ' } };
    activateDevice();
    go('/');
    await waitFor(() => expect(screen.getByTestId('tablet-name')).toHaveTextContent('Quầy chợ'));
    expect(readActivation()?.tablet_name).toBe('Quầy chợ');

    server.catalog = { ...CATALOG, profile: { ...CATALOG.profile, name: 'Quầy cổng trường' } };
    act(() => server.pulse('catalog'));
    await waitFor(() => expect(screen.getByTestId('tablet-name')).toHaveTextContent('Quầy cổng trường'));
    expect(readActivation()?.tablet_name).toBe('Quầy cổng trường');
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

describe('đổi quầy cho máy này (chế độ chủ)', () => {
  async function openDevicePage() {
    vi.mocked(enterOwnerModeOnTablet).mockResolvedValue(fakeOwnerClient());
    vi.mocked(listTabletProfiles).mockResolvedValue([
      { id: 'tab-a', name: 'Tablet A' },
      { id: 'tab-b', name: 'Quầy B' },
    ]);
    activateDevice();
    go('/owner');
    fireEvent.change(await screen.findByTestId('owner-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('owner-unlock-submit'));
    expect(await screen.findByTestId('owner-nav-device')).toHaveTextContent('Đang ở Tablet A');
    fireEvent.click(screen.getByTestId('owner-nav-device'));
    await screen.findByTestId('device-profiles');
  }

  it('quầy đang dùng không chọn được; chọn quầy khác ⇒ hỏi lại rồi mới chuyển; Thôi thì không làm gì', async () => {
    await openDevicePage();
    expect(screen.getByTestId('device-profile-tab-a')).toBeDisabled();
    expect(screen.getByTestId('device-profile-tab-a')).toHaveTextContent('Đang dùng');
    fireEvent.click(screen.getByTestId('device-profile-tab-b'));
    expect(screen.getByTestId('device-switch')).toHaveTextContent('Chuyển sang Quầy B');
    fireEvent.click(screen.getByTestId('device-cancel'));
    expect(screen.queryByTestId('device-confirm')).not.toBeInTheDocument();
    expect(switchTablet).not.toHaveBeenCalled();
  });

  it('chuyển xong: về màn bán hàng của quầy mới, không cần đăng nhập lại', async () => {
    vi.mocked(switchTablet).mockImplementation(async () => {
      const next = { ...ACT, tablet_profile_id: 'tab-b', tablet_name: 'Quầy B' };
      server.catalog = { ...CATALOG, profile: { ...CATALOG.profile, id: 'tab-b', name: 'Quầy B' } };
      writeActivation(next);
      storeSession({ role: 'tablet', tablet_profile_id: 'tab-b' });
      return next;
    });
    await openDevicePage();
    fireEvent.click(screen.getByTestId('device-profile-tab-b'));
    fireEvent.click(screen.getByTestId('device-switch'));
    expect(await screen.findByTestId('tablet-home')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(switchTablet).toHaveBeenCalledWith(expect.anything(), 'tab-b');
    await waitFor(() => expect(screen.getByTestId('tablet-name')).toHaveTextContent('Quầy B'));
    expect(await screen.findByTestId('staff-s1')).toBeInTheDocument();
  });

  it('lỗi khi chuyển: báo lỗi, máy vẫn ở quầy cũ', async () => {
    vi.mocked(switchTablet).mockRejectedValue(new AuthError('offline'));
    await openDevicePage();
    fireEvent.click(screen.getByTestId('device-profile-tab-b'));
    fireEvent.click(screen.getByTestId('device-switch'));
    expect(await screen.findByTestId('device-error')).toHaveTextContent('Không có mạng');
    expect(readActivation()?.tablet_profile_id).toBe('tab-a');
  });
});

describe('máy chưa đăng nhập + chọn quầy (kể cả điện thoại chủ)', () => {
  it('/owner/... chuyển về màn đăng nhập, không có form đăng nhập chủ riêng', async () => {
    go('/owner/reports');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/activate');
    expect(screen.queryByTestId('owner-home')).not.toBeInTheDocument();
  });

  it('phiên chủ lưu từ bản cũ không còn vào thẳng màn chủ', async () => {
    storeSession({ role: 'owner', email: 'owner@x.vn' });
    go('/owner');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-home')).not.toBeInTheDocument();
  });

  it('phiên chủ không mở được màn bán hàng', async () => {
    storeSession({ role: 'owner', email: 'owner@x.vn' });
    go('/');
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
  });
});
