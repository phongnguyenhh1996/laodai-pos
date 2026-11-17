// @vitest-environment jsdom
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleTimeout } from './useIdleTimeout';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useIdleTimeout', () => {
  it('gọi onIdle đúng sau 2 phút không thao tác', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(120_000, onIdle));
    vi.advanceTimersByTime(119_999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('mỗi thao tác (chạm, gõ phím) đặt lại đồng hồ', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(120_000, onIdle));
    vi.advanceTimersByTime(100_000);
    fireEvent.pointerDown(document.body);
    vi.advanceTimersByTime(100_000);
    fireEvent.keyDown(document.body, { key: 'a' });
    vi.advanceTimersByTime(119_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('tắt (enabled = false) hoặc unmount thì không gọi', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(1_000, onIdle, false));
    const { unmount } = renderHook(() => useIdleTimeout(1_000, onIdle));
    unmount();
    vi.advanceTimersByTime(5_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
