// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { App } from './App';
import { localDb } from '@/lib/localdb';
import { catalogRefresher, syncRunner } from '@/lib/sync';
import { AuthError, enterOwnerModeOnTablet, exitOwnerMode } from '@/lib/auth';
import { OWNER_IDLE_MS } from '@/owner/OwnerGate';
import { META, setMeta, type Activation } from '@/sync/db';
import type { Catalog } from '@/sync/catalog';
import { COMBOS, COMBO_XOI_FULL, COM_GA, COM_MENU, PRODUCTS, TOPPINGS, XOI_GA, XOI_MENU } from '@/domain/fixtures';
import { storeSession } from '@/test-utils/auth';

vi.mock('@/lib/auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth')>()),
  enterOwnerModeOnTablet: vi.fn(),
  exitOwnerMode: vi.fn(),
}));

const ACT: Activation = { tablet_profile_id: 'tab-a', tablet_name: 'Tablet A', activated_at: '', owner_email: 'owner@x.vn' };

const CATALOG: Catalog = {
  fetched_at: '2026-11-17T00:00:00.000Z',
  profile: { id: 'tab-a', name: 'Tablet A', point_ids: ['xoi-a', 'com'], default_boxes: 200, default_plates: 60, default_float: 500_000 },
  menus: [{ id: XOI_MENU, name: 'Xôi' }, { id: COM_MENU, name: 'Cơm gà' }],
  points: [
    { id: 'xoi-a', name: 'Xôi A', menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 1 },
    { id: 'xoi-b', name: 'Xôi B', menu_id: XOI_MENU, active: true, default_dine_type: 'takeaway', sort: 2 },
    { id: 'com', name: 'Cơm gà', menu_id: COM_MENU, active: true, default_dine_type: 'dinein', sort: 3 },
  ],
  products: PRODUCTS,
  toppings: TOPPINGS,
  combos: COMBOS,
  staff: [
    { id: 's1', name: 'Lan', active: true, sort: 1 },
    { id: 's9', name: 'Nghỉ việc', active: false, sort: 2 },
  ],
  config: { wait_yellow_min: 5, wait_red_min: 10, timezone: 'Asia/Ho_Chi_Minh' },
};

/** Không gọi server: danh mục được đặt sẵn trong IndexedDB như sau một lần đồng bộ. */
function stubCatalog() {
  vi.spyOn(catalogRefresher, 'start').mockImplementation(() => undefined);
  vi.spyOn(catalogRefresher, 'refresh').mockResolvedValue(false);
}

async function activateDevice(session: Parameters<typeof storeSession>[0] | null = { role: 'tablet', tablet_profile_id: 'tab-a' }) {
  await setMeta(localDb, META.activation, ACT);
  await setMeta(localDb, META.catalog, CATALOG);
  if (session) storeSession(session);
}

function go(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
}

beforeEach(stubCatalog);

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

  it('danh mục trên máy: chỉ nhân viên còn làm, tab theo hồ sơ tablet, bảng giá theo điểm', async () => {
    await activateDevice();
    go('/');
    expect(await screen.findByTestId('staff-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-s9')).not.toBeInTheDocument();
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
    expect(catalogRefresher.refresh).toHaveBeenCalled();

    // Chủ bỏ Cơm gà khỏi tablet A, đổi giá: danh mục mới ghi xuống máy ⇒ màn hình cập nhật ngay
    await act(() =>
      setMeta(localDb, META.catalog, {
        ...CATALOG,
        profile: { ...CATALOG.profile, point_ids: ['xoi-a'] },
        products: PRODUCTS.map((p) => (p.id === XOI_GA.id ? { ...p, price: 28_000 } : p)),
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('point-tab-com')).not.toBeInTheDocument());
    expect(screen.getByTestId('menu-panel')).toHaveAttribute('data-point', 'xoi-a');
    expect(screen.getByTestId(`menu-product-${XOI_GA.id}-price`)).toHaveTextContent('28.000');
  });

  it('hồ sơ không còn điểm bán nào: báo nhờ chủ cài đặt', async () => {
    await activateDevice();
    await setMeta(localDb, META.catalog, { ...CATALOG, profile: { ...CATALOG.profile, point_ids: [] } });
    go('/');
    expect(await screen.findByTestId('menu-no-points')).toBeInTheDocument();
  });

  it('chưa từng tải được danh mục và lần tải lỗi: báo cần mạng', async () => {
    await activateDevice();
    await localDb.meta.delete(META.catalog);
    vi.spyOn(catalogRefresher, 'getStatus').mockReturnValue({ loading: false, lastError: 'offline', lastFetchedAt: null });
    go('/');
    expect(await screen.findByTestId('catalog-error')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-board')).not.toBeInTheDocument();
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
