// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { UpdateBannerView } from './UpdateBanner';

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: vi.fn() }));

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
