// @vitest-environment jsdom
// Hết món (SPEC mục 4.8): nhân viên báo món / topping hết trong ngày ở điểm bán đang chọn; món hết bị làm mờ,
// combo có thành phần hết cũng không bấm được; bấm lại trong chế độ đánh dấu để bán lại. Sang ngày khác thì tự bán lại.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { App } from '@/app/App';
import { COMBO_XOI_FULL, TRUNG, XOI_GA, XOI_XEO } from '@/domain/fixtures';
import { businessDate } from '@/domain/time';
import { CATALOG, activateDevice, resetTablet, server, useFakeServer } from '@/test-utils/tablet';

const tid = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(tid(id));

async function openOrderScreen() {
  activateDevice();
  window.history.pushState({}, '', '/');
  render(<App />);
  fireEvent.click(await screen.findByTestId('staff-s1'));
  click('open-shift');
  await screen.findByTestId('order-screen'); // màn Bán hàng: giỏ là đơn mới
}

afterEach(() => {
  resetTablet();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('hết món', () => {
  beforeEach(() => {
    useFakeServer();
  });

  it('báo hết món chính: gửi set_sold_out theo điểm bán, món + combo chứa món đó bị khóa; bấm lại thì bán lại', async () => {
    await openOrderScreen();
    click('soldout-toggle');
    expect(tid('soldout-banner')).toHaveTextContent('Xôi A');
    // Chế độ đánh dấu: ẩn combo, hiện topping.
    expect(screen.queryByTestId(`menu-combo-${COMBO_XOI_FULL.id}`)).not.toBeInTheDocument();
    expect(tid(`menu-topping-${TRUNG.id}`)).toBeInTheDocument();

    click(`menu-product-${XOI_GA.id}`);
    await waitFor(() => expect(tid(`menu-product-${XOI_GA.id}`)).toHaveAttribute('data-sold-out', 'true'));
    const op = server.ops.at(-1)!;
    expect(op.kind).toBe('set_sold_out');
    expect(op.payload).toMatchObject({ point_id: 'xoi-a', item_kind: 'product', item_id: XOI_GA.id, sold_out: true });
    expect(server.catalog.sold_out).toEqual([expect.objectContaining({ point_id: 'xoi-a', item_id: XOI_GA.id, day: businessDate(new Date()) })]);
    // Không thêm món vào giỏ khi đang đánh dấu.
    expect(screen.queryByTestId('topping-sheet')).not.toBeInTheDocument();

    click('soldout-toggle'); // Xong
    expect(screen.queryByTestId('soldout-banner')).not.toBeInTheDocument();
    expect(tid(`menu-product-${XOI_GA.id}`)).toBeDisabled();
    expect(tid(`menu-product-${XOI_GA.id}-soldout`)).toHaveTextContent('Hết');
    expect(tid(`menu-combo-${COMBO_XOI_FULL.id}`)).toBeDisabled();
    expect(tid(`menu-product-${XOI_XEO.id}`)).toBeEnabled();

    // Bán lại.
    click('soldout-toggle');
    click(`menu-product-${XOI_GA.id}`);
    await waitFor(() => expect(tid(`menu-product-${XOI_GA.id}`)).not.toHaveAttribute('data-sold-out'));
    expect(server.ops.at(-1)!.payload).toMatchObject({ item_id: XOI_GA.id, sold_out: false });
    click('soldout-toggle');
    expect(tid(`menu-combo-${COMBO_XOI_FULL.id}`)).toBeEnabled();
  });

  it('báo hết topping: không chọn được trong bảng topping, combo có topping đó bị khóa', async () => {
    await openOrderScreen();
    click('soldout-toggle');
    click(`menu-topping-${TRUNG.id}`);
    await waitFor(() => expect(tid(`menu-topping-${TRUNG.id}`)).toHaveAttribute('data-sold-out', 'true'));
    click('soldout-toggle');

    expect(tid(`menu-combo-${COMBO_XOI_FULL.id}`)).toBeDisabled(); // combo có trứng
    click(`menu-product-${XOI_XEO.id}`);
    expect(tid(`topping-option-${TRUNG.id}`)).toBeDisabled();
    expect(tid(`topping-option-${TRUNG.id}`)).toHaveTextContent('Hết');
  });

  it('chỉ áp cho điểm bán đã báo: tab Cơm gà không bị ảnh hưởng', async () => {
    await openOrderScreen();
    click('soldout-toggle');
    click(`menu-product-${XOI_GA.id}`);
    await waitFor(() => expect(tid(`menu-product-${XOI_GA.id}`)).toHaveAttribute('data-sold-out', 'true'));
    click('soldout-toggle');
    // Xôi B (cùng menu Xôi) không thuộc quầy này; server chỉ ghi cho xoi-a.
    expect(server.catalog.sold_out?.map((r) => r.point_id)).toEqual(['xoi-a']);
  });
});

describe('hết món từ hôm trước', () => {
  it('dòng của ngày khác không còn hiệu lực', async () => {
    useFakeServer({
      ...CATALOG,
      sold_out: [{ point_id: 'xoi-a', item_kind: 'product', item_id: XOI_GA.id, day: '2020-01-01', at: '2020-01-01T01:00:00Z' }],
    });
    await openOrderScreen();
    expect(tid(`menu-product-${XOI_GA.id}`)).toBeEnabled();
    expect(tid(`menu-product-${XOI_GA.id}`)).not.toHaveAttribute('data-sold-out');
  });

  it('máy khác đã báo hết hôm nay ⇒ máy này thấy ngay khi tải danh mục', async () => {
    useFakeServer({
      ...CATALOG,
      sold_out: [{ point_id: 'xoi-a', item_kind: 'product', item_id: XOI_GA.id, day: businessDate(new Date()), at: new Date().toISOString() }],
    });
    await openOrderScreen();
    expect(tid(`menu-product-${XOI_GA.id}`)).toBeDisabled();
  });
});
