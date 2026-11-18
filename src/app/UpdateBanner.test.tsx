// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { UpdateBanner, UpdateBannerView, type UpdateCheckEnv } from './UpdateBanner';
import { APP_VERSION, fetchServerVersion, hardReload } from './version';

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: vi.fn() }));

const updateServiceWorker = vi.fn(async () => undefined);
const swUpdate = vi.fn(async () => undefined);

function sw(needRefresh: boolean) {
  vi.mocked(useRegisterSW).mockImplementation((opts) => {
    opts?.onRegisteredSW?.('/sw.js', { installing: null, update: swUpdate } as unknown as ServiceWorkerRegistration);
    return { needRefresh: [needRefresh, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker };
  });
}

function env(latest: string | null = 'v1'): UpdateCheckEnv & { fetchVersion: ReturnType<typeof vi.fn>; hardReload: ReturnType<typeof vi.fn> } {
  return { current: 'v1', fetchVersion: vi.fn(async () => latest), hardReload: vi.fn() };
}

const flush = () => act(async () => undefined);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test('banner gọi đúng hành động Tải lại / Để sau', () => {
  const onReload = vi.fn();
  const onLater = vi.fn();
  render(<UpdateBannerView onReload={onReload} onLater={onLater} />);
  expect(screen.getByTestId('update-banner')).toHaveTextContent('Có bản cập nhật mới');
  fireEvent.click(screen.getByTestId('update-reload'));
  fireEvent.click(screen.getByTestId('update-later'));
  expect(onReload).toHaveBeenCalledOnce();
  expect(onLater).toHaveBeenCalledOnce();
});

describe('UpdateBanner', () => {
  test('server cùng phiên bản (hoặc không đọc được) ⇒ không hiện', async () => {
    sw(false);
    const e = env('v1');
    render(<UpdateBanner env={e} />);
    await flush();
    expect(e.fetchVersion).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('update-banner')).toBeNull();
    const e2 = env(null);
    render(<UpdateBanner env={e2} />);
    await flush();
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });

  test('server có phiên bản khác ⇒ hiện ngay, nhờ service worker cài sẵn; Tải lại khi chưa có SW chờ ⇒ tải lại cưỡng bức', async () => {
    sw(false);
    const e = env('v2');
    render(<UpdateBanner env={e} />);
    await flush();
    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
    expect(swUpdate).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('update-reload'));
    expect(e.hardReload).toHaveBeenCalledOnce();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  test('SW mới đang chờ ⇒ Tải lại kích hoạt nó; kẹt quá 4 giây ⇒ tải lại cưỡng bức', async () => {
    vi.useFakeTimers();
    sw(true);
    const e = env('v1');
    render(<UpdateBanner env={e} />);
    fireEvent.click(screen.getByTestId('update-reload'));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
    expect(e.hardReload).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(4000));
    expect(e.hardReload).toHaveBeenCalledOnce();
  });

  test('hỏi lại mỗi 5 phút, khi bật lại màn hình, khi có mạng lại; mất mạng thì không hỏi', async () => {
    vi.useFakeTimers();
    sw(false);
    const e = env('v1');
    const { unmount } = render(<UpdateBanner env={e} />);
    expect(e.fetchVersion).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(5 * 60_000));
    expect(e.fetchVersion).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    act(() => void window.dispatchEvent(new Event('online')));
    expect(e.fetchVersion).toHaveBeenCalledTimes(4);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(e.fetchVersion).toHaveBeenCalledTimes(4);
    online.mockRestore();
    unmount();
    act(() => void window.dispatchEvent(new Event('online')));
    expect(e.fetchVersion).toHaveBeenCalledTimes(4);
  });

  test('Để sau ⇒ ẩn, 30 phút sau nhắc lại', async () => {
    vi.useFakeTimers();
    sw(true);
    render(<UpdateBanner env={env()} />);
    fireEvent.click(screen.getByTestId('update-later'));
    expect(screen.queryByTestId('update-banner')).toBeNull();
    act(() => void vi.advanceTimersByTime(30 * 60_000));
    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
  });
});

describe('version', () => {
  test('phiên bản build có trong bundle', () => {
    expect(APP_VERSION).toMatch(/^[\w]+-\d{12}$/);
  });

  test('fetchServerVersion: đọc /version.json không cache; lỗi / sai dạng ⇒ null', async () => {
    const ok = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ version: 'abc' })));
    expect(await fetchServerVersion(ok as unknown as typeof fetch)).toBe('abc');
    expect(ok.mock.calls[0][1]).toEqual({ cache: 'no-store' });
    expect(String(ok.mock.calls[0][0])).toMatch(/^\/version\.json\?t=\d+$/);
    expect(await fetchServerVersion(async () => new Response('x', { status: 404 }))).toBeNull();
    expect(await fetchServerVersion(async () => new Response('{"version":1}'))).toBeNull();
    expect(await fetchServerVersion(async () => new Response('oops'))).toBeNull();
    expect(await fetchServerVersion(() => Promise.reject(new TypeError('Failed to fetch')))).toBeNull();
  });

  test('hardReload: gỡ service worker, xóa cache, tải lại (cả khi trình duyệt không có SW / cache)', async () => {
    const unregister = vi.fn(async () => true);
    const del = vi.fn(async () => true);
    const reload = vi.fn();
    const win = {
      navigator: { serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] } },
      caches: { keys: async () => ['workbox-precache'], delete: del },
      location: { reload },
    } as unknown as Window;
    await hardReload(win);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith('workbox-precache');
    expect(reload).toHaveBeenCalledOnce();
    const bare = { navigator: {}, location: { reload: vi.fn() } } as unknown as Window;
    await hardReload(bare);
    expect(bare.location.reload).toHaveBeenCalledOnce();
  });
});
