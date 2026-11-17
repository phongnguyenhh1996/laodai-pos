// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { App } from './App';
import { localDb } from '@/lib/localdb';
import { META, setMeta } from '@/sync/db';

afterEach(async () => {
  await localDb.meta.clear();
  window.history.pushState({}, '', '/');
});

describe('App', () => {
  it('tablet chưa kích hoạt: đường dẫn bán hàng chuyển về màn kích hoạt', async () => {
    window.history.pushState({}, '', '/queue');
    render(<App />);
    expect(await screen.findByTestId('activate-screen')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/activate');
  });

  it('tablet đã kích hoạt: vào màn bán hàng', async () => {
    await setMeta(localDb, META.activation, { tablet_profile_id: 'a', tablet_name: 'Tablet A', activated_at: '' });
    render(<App />);
    expect(await screen.findByTestId('tablet-home')).toHaveTextContent('Tablet A');
  });
});
