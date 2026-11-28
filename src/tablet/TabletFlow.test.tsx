// @vitest-environment jsdom
// Luồng bán hàng trên tablet: mở ca → màn Bán hàng (dải đơn + thực đơn + giỏ): tạo / sửa / xóa đơn → ra món → thanh toán trong giỏ → đóng ca.
// Chạy với server giả trong bộ nhớ (FakeServer): kiểm tra những thao tác server nhận, những gì hiện ra,
// và nhiều máy cùng hồ sơ tablet thấy cùng một ca + hàng đợi (realtime).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { App } from '@/app/App';
import { CANH, CHA, COMBO_XOI_FULL, COM_GA, DUA, TRUNG, XOI_GA, XOI_XEO } from '@/domain/fixtures';
import { dayTime } from '@/domain/time';
import { Pos, TabletStore } from '@/pos';
import { activateDevice, resetTablet, server, useFakeServer } from '@/test-utils/tablet';

const tid = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(tid(id));

function go(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
}

/** Tablet đã kích hoạt, Lan đã mở ca, đang ở màn Bán hàng. */
async function startShift(staff = 's1') {
  activateDevice();
  go('/');
  fireEvent.click(await screen.findByTestId(`staff-${staff}`));
  click('open-shift');
  await screen.findByTestId('queue-screen');
}

/** Giỏ đang là đơn mới (màn Bán hàng không chọn thẻ nào). */
async function newOrder() {
  await cartIsNew();
}

/** Giỏ về đơn mới trống (sau Lưu / Ra món / Thanh toán / Xóa / bỏ chọn). */
async function cartIsNew() {
  await waitFor(() => {
    expect(tid('order-code')).toHaveTextContent('Đơn mới');
    expect(tid('cart-lines').querySelectorAll('li[data-product]')).toHaveLength(0);
  });
}

/** Mục menu bán hàng: điện thoại nằm trong nút ☰. */
function nav(id: string) {
  if (screen.queryByTestId('open-menu')) click('open-menu');
  click(id);
}

/** Thêm món + topping qua bảng chọn topping. */
function addProduct(productId: string, toppingIds: string[] = []) {
  click(`menu-product-${productId}`);
  for (const t of toppingIds) click(`topping-option-${t}`);
  click('topping-add');
}

const cards = () => screen.queryAllByTestId(/^queue-card-/);

/** Màn rộng như tablet (jsdom không có `matchMedia` ⇒ mặc định là điện thoại). Trả hàm trả lại như cũ. */
function asTablet(): () => void {
  window.matchMedia = ((query: string) => ({
    matches: query === '(min-width: 768px)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  return () => {
    delete (window as Partial<Window>).matchMedia;
  };
}

beforeEach(() => {
  useFakeServer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetTablet();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('mở ca', () => {
  it('chọn tên rồi bấm Mở ca: không nhập gì thêm, ca nhận số mặc định của hồ sơ tablet', async () => {
    activateDevice();
    go('/');
    expect(await screen.findByTestId('open-shift')).toBeDisabled(); // chưa chọn tên
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    click('staff-s2');
    expect(tid('staff-s2')).toHaveAttribute('aria-pressed', 'true');
    click('open-shift');
    expect(await screen.findByTestId('queue-screen')).toBeInTheDocument();
    expect(tid('shift-staff')).toHaveTextContent('Mai');
    const [op] = server.ops;
    expect(op.kind).toBe('open_shift');
    expect(op.payload).toMatchObject({ staff_id: 's2' });
    expect(server.openShift()).toMatchObject({ staff_id: 's2', open_boxes: 200, open_plates: 60, open_float: 500_000 });
  });

  it('chưa mở ca thì các đường dẫn bán hàng về màn mở ca', async () => {
    activateDevice();
    for (const path of ['/order/new', '/shift/close', '/order/abc/pay', '/debt']) {
      go(path);
      expect(await screen.findByTestId('open-shift-screen')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/');
      document.body.innerHTML = '';
    }
  });
});

describe('tạo đơn & thanh toán', () => {
  it('C10: combo 1 chạm + thu đủ tiền mặt = 2 chạm từ màn Bán hàng đến lúc xong đơn', async () => {
    await startShift();
    fireEvent.click(await screen.findByTestId(`menu-combo-${COMBO_XOI_FULL.id}`)); // 1
    click('order-pay-exact'); // 2
    expect(await screen.findByTestId('toast')).toHaveTextContent('Đã thu 39.000');
    expect(cards()).toHaveLength(0);
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'pay_order']);
    const pay = server.ops[2].payload;
    expect(pay).toMatchObject({ method: 'cash', cash_given: 39_000, total: 39_000 });
  });

  it('C11: món + 2 topping mang về: tổng đúng; Xôi mặc định Mang về, Cơm gà mặc định Tại chỗ', async () => {
    await startShift();
    await newOrder();
    expect(tid('order-dine-takeaway')).toHaveAttribute('aria-pressed', 'true');
    addProduct(XOI_GA.id, [TRUNG.id, CHA.id]);
    expect(tid('order-total')).toHaveTextContent('39.000');
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    expect(o).toMatchObject({ point_id: 'xoi-a', dine_type: 'takeaway', total: 39_000 });
    expect(o.items[0].toppings_snap.map((t) => t.id)).toEqual([TRUNG.id, CHA.id]);

    await newOrder();
    click('point-tab-com');
    expect(tid('order-dine-dinein')).toHaveAttribute('aria-pressed', 'true');
    addProduct(COM_GA.id, [CANH.id, DUA.id]);
    click('order-dine-takeaway');
    expect(tid('order-total')).toHaveTextContent('43.000');
  });

  it('đơn ship (điện thoại): chọn Ship không mở bàn phím; địa chỉ nhập trong bảng Giao hàng; chưa có địa chỉ thì không lưu được', async () => {
    await startShift();
    await newOrder();
    expect(screen.queryByTestId('order-ship-details')).toBeNull();
    addProduct(XOI_GA.id, [TRUNG.id]);
    click('order-dine-delivery');
    expect(tid('order-dine-delivery')).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(document.body); // không ô nào focus ⇒ bàn phím không che thực đơn
    expect(screen.queryByTestId('order-address')).toBeNull();
    expect(tid('order-address-missing')).toBeInTheDocument();
    expect(tid('order-save')).toBeDisabled();
    expect(tid('order-pay-exact')).toBeDisabled();

    click('order-ship-details');
    expect(tid('ship-sheet')).toBeInTheDocument();
    expect(tid('ship-customer-search')).toHaveFocus(); // khách trước, chọn xong mới điền địa chỉ
    expect(tid('ship-sheet-done')).toBeDisabled(); // địa chỉ bắt buộc
    fireEvent.change(tid('order-address'), { target: { value: '  12 Lê Lợi – 0909 123 456 ' } });
    click('ship-sheet-done');
    expect(screen.queryByTestId('ship-sheet')).toBeNull();
    expect(screen.queryByTestId('order-address-missing')).toBeNull();
    expect(tid('order-ship-summary')).toHaveTextContent('12 Lê Lợi – 0909 123 456');
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    expect(o).toMatchObject({ dine_type: 'delivery', address: '12 Lê Lợi – 0909 123 456' });
    expect(await screen.findByTestId(`queue-dine-${o.id}`)).toHaveTextContent('Ship');
    const create = server.ops.find((op) => op.kind === 'create_order')!;
    expect(create.payload).toMatchObject({ order: { dine_type: 'delivery', address: '12 Lê Lợi – 0909 123 456' } });
  });

  it('đơn ship chọn khách có sẵn (như Thu nợ): điền sẵn địa chỉ, khách hiện trên thẻ, ghi nợ chọn sẵn khách đó', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id, []);
    click('order-dine-delivery');
    click('order-ship-details');
    fireEvent.change(tid('ship-customer-search'), { target: { value: 'hoa' } });
    click('customer-suggest-c-hoa');
    expect(tid('ship-customer-label')).toHaveTextContent('Cô Hoa (20 Lê Lợi)');
    expect(tid('order-address')).toHaveValue('20 Lê Lợi, P.3');
    click('ship-sheet-done');
    expect(tid('order-ship-summary')).toHaveTextContent('20 Lê Lợi, P.3 · Cô Hoa (20 Lê Lợi)');
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    expect(o).toMatchObject({ dine_type: 'delivery', address: '20 Lê Lợi, P.3', customer_id: 'c-hoa' });
    expect(server.ops.find((op) => op.kind === 'create_order')!.payload).toMatchObject({ customer: { id: 'c-hoa' } });

    // Mở lại đơn: khách vẫn chọn; thanh toán ghi nợ ⇒ khách chọn sẵn.
    click(`queue-card-${o.id}`);
    expect(await screen.findByTestId('order-ship-summary')).toHaveTextContent('Cô Hoa');
    click('order-pay-debt');
    await screen.findByTestId('pay-debt');
    expect(tid('customer-chosen-label')).toHaveTextContent('Cô Hoa');
    click('pay-debt-confirm');
    await cartIsNew();
    expect(server.order(o.id)).toMatchObject({ status: 'paid', payment_method: 'debt', customer_id: 'c-hoa' });
  });

  it('đơn ship thêm khách mới (tên + SĐT): server tạo khách cùng đơn, lưu địa chỉ; trả tiền mặt vẫn giữ khách', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id, []);
    click('order-dine-delivery');
    click('order-ship-details');
    fireEvent.change(tid('ship-customer-search'), { target: { value: '0912 345 678' } });
    click('ship-customer-new');
    expect(tid('ship-customer-new-phone')).toHaveValue('0912 345 678');
    expect(tid('ship-customer-new-ok')).toBeDisabled(); // tên bắt buộc
    fireEvent.change(tid('ship-customer-new-name'), { target: { value: ' Anh Tú ' } });
    click('ship-customer-new-ok');
    expect(tid('ship-customer-chosen')).toHaveTextContent('Khách mới');
    fireEvent.change(tid('order-address'), { target: { value: '5 Hai Bà Trưng' } });
    click('ship-sheet-done');
    click('order-pay-exact');
    expect(await screen.findByTestId('toast')).toHaveTextContent('Đã thu');
    const create = server.ops.find((op) => op.kind === 'create_order')!;
    const sent = create.payload.customer as { id: string };
    expect(create.payload).toMatchObject({ customer: { is_new: true, name: 'Anh Tú', phone: '0912 345 678' } });
    expect(server.catalog.customers.find((c) => c.id === sent.id)).toMatchObject({ name: 'Anh Tú', address: '5 Hai Bà Trưng' });
    const o = server.orders.find((x) => x.id === create.entity_id)!;
    expect(o).toMatchObject({ status: 'paid', payment_method: 'cash', customer_id: sent.id });
  });

  it('đổi từ Ship về Mang về: bỏ địa chỉ', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id, []);
    click('order-dine-delivery');
    click('order-ship-details');
    fireEvent.change(tid('order-address'), { target: { value: '12 Lê Lợi' } });
    click('ship-sheet-done');
    click('order-dine-takeaway');
    expect(screen.queryByTestId('order-ship-details')).toBeNull();
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    expect(o).toMatchObject({ dine_type: 'takeaway', address: null });
  });

  it('phí ship: một hàng +5k…+20k cộng vào tổng, bấm lại để bỏ; Thu đủ gửi tổng có phí; đổi sang Mang về bỏ phí', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_XEO.id); // 15.000
    expect(screen.queryByTestId('order-ship-fee-10000')).toBeNull();
    click('order-dine-delivery');
    expect(screen.getAllByTestId(/^order-ship-fee-\d+$/).map((b) => b.textContent)).toEqual(['+5k', '+10k', '+15k', '+20k']);

    click('order-ship-fee-10000');
    expect(tid('order-ship-fee-10000')).toHaveAttribute('aria-pressed', 'true');
    expect(tid('order-total')).toHaveTextContent('25.000');
    expect(tid('cart-total')).toHaveTextContent('25.000');
    expect(tid('cart-ship-breakdown')).toHaveTextContent('15.000 + phí 10.000');
    expect(tid('order-pay-exact')).toHaveTextContent('25.000');
    click('order-ship-fee-10000'); // bấm lại ⇒ bỏ phí
    expect(tid('order-ship-fee-10000')).toHaveAttribute('aria-pressed', 'false');
    expect(tid('order-total')).toHaveTextContent('15.000');
    click('order-ship-fee-15000');
    expect(tid('order-total')).toHaveTextContent('30.000');

    click('order-dine-takeaway');
    expect(screen.queryByTestId('order-ship-fee-15000')).toBeNull();
    expect(tid('order-total')).toHaveTextContent('15.000');
    click('order-dine-delivery');
    expect(screen.getAllByTestId(/^order-ship-fee-\d+$/).filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0);

    click('order-ship-fee-10000');
    click('order-ship-details');
    expect(tid('ship-sheet-summary')).toHaveTextContent('Quán ship · phí đang chọn +10.000 · tổng 25.000');
    fireEvent.change(tid('order-address'), { target: { value: '12 Lê Lợi' } });
    click('ship-sheet-done');
    click('order-pay-exact');
    expect(await screen.findByTestId('toast')).toHaveTextContent('Đã thu 25.000');
    const create = server.ops.find((op) => op.kind === 'create_order')!;
    expect(create.payload).toMatchObject({ order: { dine_type: 'delivery', ship_fee: 10_000, total: 25_000 } });
    expect(server.ops.find((op) => op.kind === 'pay_order')!.payload).toMatchObject({ method: 'cash', cash_given: 25_000, total: 25_000 });
    expect(server.order(create.entity_id)).toMatchObject({ status: 'paid', ship_fee: 10_000, total: 25_000 });
  });

  it('đơn ship đã lưu: mở lại thấy mức phí đã chọn; đổi phí ⇒ tự lưu update_order có phí mới', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_XEO.id);
    click('order-dine-delivery');
    click('order-ship-fee-5000');
    click('order-ship-details');
    fireEvent.change(tid('order-address'), { target: { value: '12 Lê Lợi' } });
    click('ship-sheet-done');
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    expect(o).toMatchObject({ ship_fee: 5_000, total: 20_000 });
    expect(tid(`queue-ship-fee-${o.id}`)).toHaveTextContent('+5k ship');

    click(`queue-card-${o.id}`);
    expect(await screen.findByTestId('order-ship-fee-5000')).toHaveAttribute('aria-pressed', 'true');
    expect(tid('order-autosave')).toHaveAttribute('data-state', 'saved'); // mở lại không bị coi là đã sửa
    click('order-ship-fee-20000');
    await waitFor(() => expect(server.order(o.id)).toMatchObject({ ship_fee: 20_000, total: 35_000 }), { timeout: 3000 });
    const upd = server.ops.filter((op) => op.kind === 'update_order');
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toMatchObject({ ship_fee: 20_000, total: 35_000 });
  });

  it('tablet: hàng phí ship + ô khách / địa chỉ ngay trong cột giỏ (không có bảng Giao hàng)', async () => {
    const restore = asTablet();
    try {
      await startShift();
      await newOrder();
      addProduct(XOI_GA.id); // 25.000
      click('order-dine-delivery');
      expect(screen.queryByTestId('order-ship-details')).toBeNull();
      expect(tid('ship-customer-search')).toHaveFocus();
      click('order-ship-fee-20000');
      expect(tid('order-ship-fee')).toHaveTextContent('20.000');
      expect(tid('order-total')).toHaveTextContent('45.000');
      fireEvent.change(tid('order-address'), { target: { value: '12 Lê Lợi' } });
      click('order-save');
      await cartIsNew();
      expect(server.openOrders()[0]).toMatchObject({ dine_type: 'delivery', address: '12 Lê Lợi', ship_fee: 20_000, total: 45_000 });
    } finally {
      restore();
    }
  });

  it('shipper ngoài: hàng Trả shipper bắt buộc (khóa lưu / thanh toán), không cộng vào tổng; thanh toán có dòng nhắc; badge hàng đợi', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_XEO.id); // 15.000
    click('order-dine-delivery');
    click('order-ship-details');
    fireEvent.change(tid('order-address'), { target: { value: '12 Lê Lợi' } });
    click('ship-sheet-done');
    // Đầu ca: Quán ship, chưa chọn phí, không có hàng trả shipper.
    expect(tid('order-ship-mode-shop')).toHaveAttribute('aria-pressed', 'true');
    expect(tid('order-ship-fee-title')).toHaveTextContent('Phí ship');
    expect(screen.queryByTestId('order-ship-payout-10000')).toBeNull();

    click('order-ship-mode-external');
    expect(tid('order-ship-mode-external')).toHaveAttribute('aria-pressed', 'true');
    expect(tid('order-ship-fee-title')).toHaveTextContent('Phụ thu');
    expect(screen.getAllByTestId(/^order-ship-payout-\d+$/).map((b) => b.textContent)).toEqual(['+5k', '+10k', '+15k', '+20k']);
    expect(tid('order-payout-missing')).toHaveTextContent('Chưa chọn tiền trả shipper');
    for (const b of ['order-pay-exact', 'order-pay-cash', 'order-pay-transfer', 'order-pay-debt', 'order-serve', 'order-save']) expect(tid(b)).toBeDisabled();

    click('order-ship-fee-5000');
    click('order-ship-payout-10000');
    click('order-ship-payout-10000'); // bấm lại không bỏ
    expect(tid('order-ship-payout-10000')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('order-payout-missing')).toBeNull();
    expect(tid('cart-total')).toHaveTextContent('20.000'); // 15.000 + phụ thu 5.000, không cộng trả shipper
    expect(tid('cart-ship-breakdown')).toHaveTextContent('15.000 + phụ thu 5.000 · trả ship 10.000');
    click('order-ship-details');
    expect(tid('ship-sheet-summary')).toHaveTextContent('Shipper ngoài · phụ thu +5.000 · trả shipper 10.000 · tổng 20.000');
    click('ship-sheet-done');

    click('order-pay-cash');
    await screen.findByTestId('cart-pay');
    const create = server.ops.find((op) => op.kind === 'create_order')!;
    expect(create.payload).toMatchObject({ order: { ship_mode: 'external', ship_payout: 10_000, ship_fee: 5_000, total: 20_000 } });
    expect(tid('pay-total')).toHaveTextContent('20.000');
    expect(tid('pay-ship-fee')).toHaveTextContent('Phụ thu');
    expect(tid('pay-ship-payout')).toHaveTextContent('Trả shipper −10.000 (lấy từ két)');

    click('pay-back');
    expect(await screen.findByTestId('order-deselect')).toBeInTheDocument(); // về giỏ, sửa tiếp đơn vừa lưu
    click('order-deselect');
    await cartIsNew();
    expect(tid(`queue-ship-external-${create.entity_id}`)).toHaveTextContent('Ship ngoài · trả 10k');
  });

  it('mặc định theo ca: đơn ship thứ hai lấy Shipper ngoài + phụ thu + trả shipper của đơn ship gần nhất (kể cả đã thanh toán); đổi sang Mang về ⇒ shop / 0', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_XEO.id);
    click('order-dine-delivery');
    click('order-ship-details');
    fireEvent.change(tid('order-address'), { target: { value: '12 Lê Lợi' } });
    click('ship-sheet-done');
    click('order-ship-mode-external');
    click('order-ship-fee-5000');
    click('order-ship-payout-15000');
    click('order-pay-exact'); // đã thanh toán ⇒ tablet không còn thấy đơn, mặc định vẫn lấy từ server
    expect(await screen.findByTestId('toast')).toHaveTextContent('Đã thu 20.000');

    await newOrder();
    addProduct(XOI_XEO.id);
    click('order-dine-delivery');
    await waitFor(() => expect(tid('order-ship-mode-external')).toHaveAttribute('aria-pressed', 'true'));
    expect(tid('order-ship-fee-5000')).toHaveAttribute('aria-pressed', 'true');
    expect(tid('order-ship-payout-15000')).toHaveAttribute('aria-pressed', 'true');

    // Về quán ship bỏ trả shipper; sang Mang về ⇒ gửi shop / 0.
    click('order-ship-mode-shop');
    expect(screen.queryByTestId('order-ship-payout-15000')).toBeNull();
    click('order-ship-mode-external');
    expect(tid('order-payout-missing')).toBeInTheDocument();
    click('order-dine-takeaway');
    click('order-save');
    await cartIsNew();
    const take = server.ops.filter((op) => op.kind === 'create_order').at(-1)!;
    expect(take.payload).toMatchObject({ order: { dine_type: 'takeaway', ship_mode: 'shop', ship_payout: 0, ship_fee: 0, total: 15_000 } });
  });

  it('bảng topping: Hủy thì không thêm gì; bấm món 2 lần cùng topping ⇒ 1 dòng số lượng 2', async () => {
    await startShift();
    await newOrder();
    click(`menu-product-${XOI_GA.id}`);
    expect(tid('topping-add')).toHaveTextContent('25.000');
    click(`topping-option-${TRUNG.id}`);
    expect(tid('topping-add')).toHaveTextContent('31.000');
    click(`topping-option-${TRUNG.id}`); // bỏ chọn
    click('topping-cancel');
    expect(screen.queryAllByTestId(/^cart-line-[^-]+$/)).toHaveLength(0);
    addProduct(XOI_GA.id);
    addProduct(XOI_GA.id);
    const lines = within(tid('cart-lines')).getAllByRole('listitem');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('2');
    expect(tid('order-total')).toHaveTextContent('50.000');
  });

  it('C12: chuyển tab Xôi ↔ Cơm gà: đơn gắn đúng điểm bán; đơn đã có món thì không chuyển sang menu khác', async () => {
    await startShift();
    await newOrder();
    click('point-tab-com');
    expect(tid('order-screen')).toHaveAttribute('data-point', 'com');
    addProduct(COM_GA.id);
    expect(tid('point-tab-xoi-a')).toBeDisabled(); // đơn cơm gà không thể chứa món xôi
    click('order-save');
    await cartIsNew();
    // Đơn kế tiếp mở đúng tab đang bán (Cơm gà)
    await newOrder();
    expect(tid('order-screen')).toHaveAttribute('data-point', 'com');
    click('point-tab-xoi-a');
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await cartIsNew();
    const orders = server.openOrders().sort((a, b) => a.device_seq - b.device_seq);
    expect(orders.map((o) => [o.point_id, o.dine_type])).toEqual([
      ['com', 'dinein'],
      ['xoi-a', 'takeaway'],
    ]);
  });

  it('C13: nhân viên không có ô nào để sửa giá hay giảm giá', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    // Màn đơn: chỉ một ô nhập là nhãn / số bàn
    expect(screen.getAllByRole('textbox').map((e) => e.dataset.testid)).toEqual(['order-label']);
    expect(document.querySelectorAll('input:not([data-testid=order-label])')).toHaveLength(0);
    click('order-pay-cash');
    await screen.findByTestId('cart-pay');
    // Thanh toán trong giỏ: chỉ có ô "khách đưa" (nhập tay), không có ô giá / giảm giá
    expect(screen.getAllByRole('textbox').map((e) => e.dataset.testid)).toEqual(['cash-manual']);
    expect(document.body.innerHTML).not.toMatch(/giảm giá|discount|chiết khấu/i);
  });

  it('thanh toán tiền mặt: chỉ mệnh giá ≥ tổng; đưa thiếu không xác nhận được; hiện tiền thối', async () => {
    await startShift();
    await newOrder();
    expect(screen.queryByTestId(`menu-product-${COM_GA.id}`)).not.toBeInTheDocument(); // tab Xôi: không có món cơm
    click('point-tab-com');
    addProduct(COM_GA.id); // 35.000, không topping
    click('order-pay-cash');
    await screen.findByTestId('cart-pay');
    expect(tid('pay-total')).toHaveTextContent('35.000');
    expect(screen.queryByTestId('cash-quick-20000')).not.toBeInTheDocument();
    expect(tid('cash-exact')).toBeInTheDocument();
    expect(tid('cash-quick-50000')).toBeInTheDocument();
    expect(tid('pay-confirm')).toBeDisabled();
    fireEvent.change(tid('cash-manual'), { target: { value: '30' } });
    expect(tid('cash-change')).toHaveTextContent('Chưa đủ');
    expect(tid('pay-confirm')).toBeDisabled();
    click('cash-quick-100000');
    expect(tid('cash-change')).toHaveTextContent('65.000');
    click('pay-confirm');
    await cartIsNew();
    const pay = server.ops.at(-1)!;
    expect(pay).toMatchObject({ kind: 'pay_order' });
    expect(pay.payload).toMatchObject({ method: 'cash', cash_given: 100_000, total: 35_000 });
  });

  it('thanh toán chuyển khoản', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-pay-transfer');
    await screen.findByTestId('pay-transfer');
    click('pay-transfer-confirm');
    expect(await screen.findByTestId('toast')).toHaveTextContent('chuyển khoản');
    expect(server.ops.at(-1)!.payload).toMatchObject({ method: 'transfer', cash_given: null });
  });

  it('thanh toán trong giỏ: Ghi nợ là bảng đè lên giỏ, đóng ⇒ về hình thức trước đó / về giỏ; "Giỏ" ⇒ sửa tiếp đơn', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-pay-cash');
    await screen.findByTestId('pay-cash');
    expect(server.kinds).toEqual(['open_shift', 'create_order']); // mở thanh toán ⇒ đơn đã lưu
    expect(screen.queryByTestId('cart-lines')).not.toBeInTheDocument();
    click('pay-method-debt');
    expect(tid('pay-debt')).toBeInTheDocument();
    click('pay-debt-close');
    expect(tid('pay-method-cash')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('pay-debt')).not.toBeInTheDocument();
    click('pay-back');
    expect(tid('cart-lines')).toBeInTheDocument();
    click('order-pay-debt');
    await screen.findByTestId('pay-debt');
    click('pay-debt-close');
    expect(screen.queryByTestId('cart-pay')).not.toBeInTheDocument();
    expect(tid('cart-lines')).toBeInTheDocument();
    expect(server.kinds).toEqual(['open_shift', 'create_order']);
  });

  it('C16: thanh toán xong đơn biến mất; mở lại đường dẫn của đơn đó chỉ về đơn mới trên màn Bán hàng', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    await screen.findByTestId('order-screen');
    click('order-pay-cash');
    fireEvent.click(await screen.findByTestId('cash-exact'));
    click('pay-confirm');
    await screen.findByTestId('queue-empty');
    // Đơn đã thanh toán trên server nhưng không màn nào của tablet mở được
    expect(server.order(o.id)?.status).toBe('paid');
    for (const path of [`/order/${o.id}`, `/order/${o.id}/pay`]) {
      act(() => window.history.pushState({}, '', path));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      await waitFor(() => expect(window.location.pathname).toBe('/'));
      await waitFor(() => expect(window.location.search).toBe(''));
      await cartIsNew();
      expect(screen.queryByTestId('cart-pay')).not.toBeInTheDocument();
    }
  });

  it('bấm Lưu liên tục không tạo hai đơn', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    click('order-save');
    click('order-save');
    await cartIsNew();
    expect(server.kinds.filter((k) => k === 'create_order')).toHaveLength(1);
  });

  it('rời đơn chưa lưu ⇒ hỏi lại; đơn mới chưa lưu thì không để lại gì', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();

    // Đơn mới chưa có gì ⇒ chọn thẻ là sang luôn; bỏ chọn ⇒ về đơn mới
    click(`queue-card-${o.id}`);
    expect(await screen.findByTestId('order-code')).toHaveTextContent(o.code);
    click('order-deselect');
    await cartIsNew();

    // Đơn mới có món ⇒ chọn thẻ khác thì hỏi "Bỏ thay đổi?"
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click(`queue-card-${o.id}`);
    click('discard-no');
    expect(tid('order-code')).toHaveTextContent('Đơn mới');
    expect(tid('cart-lines').querySelectorAll('li[data-product]')).toHaveLength(1);
    click(`queue-card-${o.id}`);
    click('discard-yes');
    expect(await screen.findByTestId('order-code')).toHaveTextContent(o.code);
    // Sang màn khác cũng hỏi
    click('order-deselect');
    await cartIsNew();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    nav('open-debt');
    expect(tid('discard-sheet')).toBeInTheDocument();
    click('discard-yes');
    expect(await screen.findByTestId('debt-screen')).toBeInTheDocument();
    expect(server.kinds).toEqual(['open_shift', 'create_order']);
  });
});

describe('hàng đợi', () => {
  it('C14/C15: 3 đơn, cũ nhất ở trên; vàng ≥ 5 phút, đỏ ≥ 10 phút; Đã ra món ⇒ xuống nhóm Chờ thanh toán; chip lọc', async () => {
    const t0 = Date.parse('2026-11-18T00:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(t0);
    await startShift();
    for (const label of ['một', 'hai', 'ba']) {
      await newOrder();
      fireEvent.change(tid('order-label'), { target: { value: label } });
      fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
      click('order-save');
      await cartIsNew();
      vi.setSystemTime(Date.now() + 60_000);
    }
    await waitFor(() => expect(cards()).toHaveLength(3));
    const serveCards = () => cards().filter((c) => c.dataset.group === 'serve');
    expect(serveCards().map((c) => within(c).getByTestId(/^queue-label-/).textContent)).toEqual(['một', 'hai', 'ba']);
    expect(tid('queue-count-all')).toHaveTextContent('3');
    expect(tid('queue-count-serve')).toHaveTextContent('3');
    expect(tid('queue-count-pay')).toHaveTextContent('0');
    for (const c of serveCards()) expect(within(c).getByTestId(/^queue-code-/).textContent).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$/);
    expect(serveCards().map((c) => c.dataset.color)).toEqual(['normal', 'normal', 'normal']);

    // t0 + 5 phút: đơn đầu (tạo lúc t0) vàng
    act(() => void vi.advanceTimersByTime(2 * 60_000));
    expect(serveCards().map((c) => c.dataset.color)).toEqual(['yellow', 'normal', 'normal']);
    // t0 + 10 phút: đơn đầu đỏ, đơn hai (t0+1) vàng, đơn ba (t0+2) vàng
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(serveCards().map((c) => c.dataset.color)).toEqual(['red', 'yellow', 'yellow']);
    expect(within(serveCards()[0]).getByTestId(/^queue-wait-/)).toHaveTextContent('10′');

    // Chọn đơn đầu, Đã ra món trong giỏ ⇒ sang nhóm Chờ thanh toán (đứng sau các đơn chờ ra món), hết màu
    const first = serveCards()[0];
    const firstId = first.dataset.testid!.replace('queue-card-', '');
    fireEvent.click(first);
    expect(tid(`queue-card-${firstId}`)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(await screen.findByTestId('order-serve'));
    await waitFor(() => expect(tid(`queue-card-${firstId}`)).toHaveAttribute('data-group', 'pay'));
    await cartIsNew();
    const payCard = tid(`queue-card-${firstId}`);
    expect(payCard).toHaveAttribute('data-color', 'none');
    expect(cards().map((c) => c.dataset.group)).toEqual(['serve', 'serve', 'pay']);
    expect(server.order(firstId)?.served_at).not.toBeNull();

    // Chip lọc: Chờ thanh toán chỉ còn đơn đã ra món
    click('queue-filter-pay');
    expect(cards().map((c) => c.dataset.testid)).toEqual([`queue-card-${firstId}`]);
    click('queue-filter-all');

    // Thanh toán đơn hai ⇒ thẻ rời hàng đợi
    const secondId = serveCards()[0].dataset.testid!.replace('queue-card-', '');
    fireEvent.click(tid(`queue-card-${secondId}`));
    fireEvent.click(await screen.findByTestId('order-pay-exact'));
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.queryByTestId(`queue-card-${secondId}`)).toBeNull();
  });

  it('bỏ chọn đơn: bấm lại thẻ, bấm vùng trống của hàng đợi, nút ✕ đầu giỏ; bấm chip / thực đơn không bỏ chọn', async () => {
    await startShift();
    addProduct(XOI_GA.id);
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    const selected = () => tid(`queue-card-${o.id}`).getAttribute('aria-pressed') === 'true';

    click(`queue-card-${o.id}`);
    await waitFor(() => expect(selected()).toBe(true));
    click(`queue-card-${o.id}`); // bấm lại thẻ
    await cartIsNew();
    expect(selected()).toBe(false);

    click(`queue-card-${o.id}`);
    await waitFor(() => expect(selected()).toBe(true));
    click('queue-filter-serve'); // bấm chip chỉ lọc
    expect(selected()).toBe(true);
    addProduct(XOI_XEO.id); // bấm thực đơn: vẫn sửa đơn đó
    expect(selected()).toBe(true);
    expect(tid('order-code')).toHaveTextContent(o.code);
    fireEvent.click(tid('queue-screen')); // vùng trống ⇒ tự lưu rồi về đơn mới
    await cartIsNew();
    expect(selected()).toBe(false);
    await waitFor(() => expect(server.order(o.id)?.items).toHaveLength(2));
    expect(window.location.search).toBe('');

    click(`queue-card-${o.id}`);
    await waitFor(() => expect(selected()).toBe(true));
    click('order-deselect'); // nút ✕ đầu giỏ
    await cartIsNew();
    expect(selected()).toBe(false);
  });

  it('sửa đơn đang mở: tăng / bớt số lượng, đổi nhãn ⇒ update_order với tổng mới; không đổi gì thì không ghi', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    addProduct(XOI_XEO.id);
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    await screen.findByTestId('order-screen');
    expect(tid('order-code')).toHaveTextContent(o.code);
    expect(screen.queryByTestId('order-save')).not.toBeInTheDocument(); // đơn đã lưu thì tự lưu, không có nút Lưu
    expect(tid('order-autosave')).toHaveTextContent('Đã lưu');
    click('order-deselect'); // không đổi gì
    await cartIsNew();
    expect(server.kinds).toEqual(['open_shift', 'create_order']);

    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    await screen.findByTestId('order-screen');
    const [ga, xeo] = o.items;
    click(`cart-line-${ga.id}-plus`);
    click(`cart-line-${xeo.id}-minus`); // về 0 ⇒ bỏ dòng
    fireEvent.change(tid('order-label'), { target: { value: 'Bàn 4' } });
    expect(tid('order-total')).toHaveTextContent('50.000');
    click('order-serve');
    await cartIsNew();
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'update_order', 'serve_order']);
    const upd = server.ops[2].payload;
    expect(upd).toMatchObject({ total: 50_000, label: 'Bàn 4' });
    await waitFor(() => expect(tid(`queue-card-${o.id}`)).toHaveAttribute('data-group', 'pay'));
  });

  it('đơn đã lưu tự lưu khi sửa: gom các chạm liên tiếp thành một update_order, không cần bấm gì', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    await screen.findByTestId('order-screen');
    const [ga] = o.items;
    click(`cart-line-${ga.id}-plus`);
    click(`cart-line-${ga.id}-plus`);
    fireEvent.change(tid('order-label'), { target: { value: 'Bàn 2' } });
    expect(tid('order-autosave')).toHaveAttribute('data-state', 'saving');
    await waitFor(() => expect(tid('order-autosave')).toHaveAttribute('data-state', 'saved'), { timeout: 3000 });
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'update_order']);
    expect(server.order(o.id)).toMatchObject({ label: 'Bàn 2', total: 75_000 });
    expect(tid('order-code')).toHaveTextContent(o.code); // vẫn đang sửa đơn đó

    // Sửa rồi bỏ chọn ngay (chưa kịp tự lưu) ⇒ vẫn ghi, không hỏi bỏ thay đổi
    click(`cart-line-${ga.id}-minus`);
    click('order-deselect');
    await cartIsNew();
    expect(screen.queryByTestId('discard-sheet')).not.toBeInTheDocument();
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'update_order', 'update_order']);
    expect(server.order(o.id)?.total).toBe(50_000);
  });

  it('đổi món: bấm dòng để chọn, bấm món / combo khác ⇒ thay dòng đó (giữ số lượng); bấm lại dòng ⇒ thôi', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    addProduct(XOI_GA.id);
    addProduct(XOI_XEO.id);
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    await screen.findByTestId('order-screen');
    const [ga, xeo] = o.items;
    expect(ga.qty).toBe(2);

    // Chọn rồi bỏ chọn: không đổi gì
    click(`cart-line-${xeo.id}-pick`);
    expect(tid('swap-banner')).toHaveTextContent('Xôi xéo');
    expect(tid(`cart-line-${xeo.id}`)).toHaveAttribute('data-swapping', 'true');
    click(`cart-line-${xeo.id}-pick`);
    expect(screen.queryByTestId('swap-banner')).not.toBeInTheDocument();
    click(`cart-line-${xeo.id}-pick`);
    click('swap-cancel');
    expect(screen.queryByTestId('swap-banner')).not.toBeInTheDocument();

    // 2× Xôi gà ⇒ 2× Xôi gà (Trứng): bảng topping ghi "Đổi", dòng giữ vị trí và số lượng
    click(`cart-line-${ga.id}-pick`);
    click(`menu-product-${XOI_GA.id}`);
    expect(tid('topping-add')).toHaveTextContent('Đổi');
    click(`topping-option-${TRUNG.id}`);
    click('topping-add');
    expect(screen.queryByTestId('swap-banner')).not.toBeInTheDocument();
    let lines = within(tid('cart-lines')).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Xôi gà+ Trứng'); // topping là dòng phụ dưới tên
    expect(within(lines[0]).getByTestId(/-qty$/)).toHaveTextContent('2');
    expect(tid('order-total')).toHaveTextContent('77.000'); // 2 × 31.000 + 15.000

    // Đổi topping lần nữa: bảng topping mở sẵn topping cũ
    fireEvent.click(within(lines[0]).getByTestId(/-pick$/));
    click(`menu-product-${XOI_GA.id}`);
    expect(tid(`topping-option-${TRUNG.id}`)).toHaveAttribute('aria-pressed', 'true');
    click('topping-cancel');
    expect(tid('swap-banner')).toBeInTheDocument(); // hủy bảng topping vẫn đang chọn dòng
    click('swap-cancel');

    // Xôi xéo ⇒ combo
    click(`cart-line-${xeo.id}-pick`);
    click(`menu-combo-${COMBO_XOI_FULL.id}`);
    lines = within(tid('cart-lines')).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(screen.queryByTestId(`cart-line-${xeo.id}`)).not.toBeInTheDocument();

    click('order-deselect');
    await cartIsNew();
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'update_order']);
    const saved = server.order(o.id);
    expect(saved?.items.map((i) => [i.product_id, i.qty])).toEqual([
      [XOI_GA.id, 2],
      [COMBO_XOI_FULL.product_id, 1],
    ]);
    expect(saved?.items[0].toppings_snap.map((t) => t.id)).toEqual([TRUNG.id]);
  });

  it('đơn đã lưu bị bớt hết món ⇒ không tự lưu đơn trống, về thì hỏi bỏ thay đổi', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    await screen.findByTestId('order-screen');
    click(`cart-line-${o.items[0].id}-minus`);
    expect(tid('order-error')).toHaveTextContent('Xóa đơn');
    click('order-deselect');
    click('discard-yes');
    await cartIsNew();
    expect(server.kinds).toEqual(['open_shift', 'create_order']);
    expect(server.order(o.id)?.items).toHaveLength(1);
  });

  it('xóa đơn: chọn lý do 1 chạm ⇒ delete_order kèm trạng thái lúc xóa, đơn rời hàng đợi', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-serve');
    await cartIsNew();
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    fireEvent.click(await screen.findByTestId('order-delete'));
    expect(tid('delete-sheet')).toBeInTheDocument();
    click('delete-cancel');
    expect(screen.queryByTestId('delete-sheet')).not.toBeInTheDocument();
    click('order-delete');
    click('delete-reason-customer_left');
    expect(await screen.findByTestId('toast')).toHaveTextContent(`Đã xóa đơn ${o.code}`);
    expect(cards()).toHaveLength(0);
    expect(server.ops.at(-1)!.payload).toMatchObject({ reason: 'customer_left', status_before: 'served' });
  });
});

describe('đóng ca', () => {
  it('B8/B9: đếm mù, còn đơn mở vẫn đóng được; sau đó chỉ hiện "Đã đóng ca"; ca sau thấy và thu được đơn đó', async () => {
    await startShift('s1');
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    // Toast "Đã thu …" của màn Bán hàng không theo sang màn đếm mù
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-pay-exact');
    expect(await screen.findByTestId('toast')).toHaveTextContent('Đã thu 39.000');

    nav('open-close-shift');
    await screen.findByTestId('close-shift-screen');
    expect(screen.queryByTestId('toast')).toBeNull();
    click('close-review');
    expect(tid('close-error')).toBeInTheDocument(); // chưa nhập
    fireEvent.change(tid('close-boxes'), { target: { value: '190' } });
    fireEvent.change(tid('close-plates'), { target: { value: '60' } });
    fireEvent.change(tid('close-cash'), { target: { value: '480' } });
    click('close-review');
    click('close-edit'); // sửa lại được trước khi xác nhận
    click('close-review');
    click('close-confirm');
    expect(await screen.findByTestId('shift-closed')).toHaveTextContent('Đã đóng ca');
    // Không có số kỳ vọng / chênh lệch / doanh thu nào trên màn hình
    const text = tid('tablet-home').textContent ?? '';
    expect(text).not.toMatch(/\d{1,3}(\.\d{3})+/);
    expect(text).not.toMatch(/kỳ vọng|chênh|doanh thu/i);
    const close = server.ops.at(-1)!;
    expect(close).toMatchObject({ kind: 'close_shift' });
    expect(close.payload).toMatchObject({ boxes_left: 190, plates_left: 60, cash_counted: 480_000 });

    click('shift-closed-done');
    fireEvent.click(await screen.findByTestId('staff-s2'));
    click('open-shift');
    // Đơn của ca trước vẫn ở hàng đợi, ca Mai thu được
    expect(await screen.findByTestId(`queue-card-${o.id}`)).toBeInTheDocument();
    fireEvent.click(tid(`queue-card-${o.id}`));
    fireEvent.click(await screen.findByTestId('order-pay-exact'));
    await screen.findByTestId('queue-empty');
    const paid = server.order(o.id);
    const shifts = server.ops.filter((x) => x.kind === 'open_shift').map((x) => x.entity_id);
    expect(paid).toMatchObject({ opened_shift_id: shifts[0], paid_shift_id: shifts[1] });
  });

  it('quầy tắt đếm dĩa, bật đếm lon: chỉ hiện ô hộp, lon, tiền; xác nhận ghi đúng các số đó', async () => {
    server.catalog.profile = { ...server.catalog.profile, default_cans: 48, count_items: ['cash', 'boxes', 'cans'] };
    await startShift('s1');
    nav('open-close-shift');
    await screen.findByTestId('close-shift-screen');
    expect(screen.queryByTestId('close-plates')).not.toBeInTheDocument();
    fireEvent.change(tid('close-boxes'), { target: { value: '186' } });
    fireEvent.change(tid('close-cans'), { target: { value: '40' } });
    click('close-review');
    expect(tid('close-error')).toHaveTextContent('Nhập đủ 3 ô');
    fireEvent.change(tid('close-cash'), { target: { value: '545' } });
    click('close-review');
    expect(tid('close-confirm-box')).toHaveTextContent('Hộp: 186 · Lon: 40 · Tiền mặt: 545.000đ');
    click('close-confirm');
    await screen.findByTestId('shift-closed');
    expect(server.ops.at(-1)!.payload).toEqual({ shift_id: expect.any(String), boxes_left: 186, cans_left: 40, cash_counted: 545_000 });
  });
});

describe('ghi nợ & thu nợ', () => {
  async function payByDebt() {
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`)); // 39.000
    click('order-pay-debt');
    await screen.findByTestId('pay-debt');
  }

  it('D17: gõ "dung" ⇒ gợi ý "Dũng (giáo viên)" (không phân biệt dấu); chọn ⇒ ghi nợ cho khách có sẵn', async () => {
    await startShift();
    await payByDebt();
    expect(tid('pay-debt-confirm')).toBeDisabled(); // tên bắt buộc
    fireEvent.change(tid('debt-name'), { target: { value: 'dung' } });
    expect(await screen.findByTestId('customer-suggest-c-gv')).toHaveTextContent('Dũng (giáo viên)');
    expect(tid('customer-suggest-c-pb')).toHaveTextContent('Dũng (phường B)');
    expect(screen.queryByTestId('customer-suggest-c-hoa')).not.toBeInTheDocument();
    // Khớp cả phần mô tả
    fireEvent.change(tid('debt-name'), { target: { value: 'giao vien' } });
    expect(screen.queryByTestId('customer-suggest-c-pb')).not.toBeInTheDocument();
    click('customer-suggest-c-gv');
    expect(tid('customer-chosen-label')).toHaveTextContent('Dũng (giáo viên)');
    expect(tid('customer-balance')).toHaveTextContent('0');
    click('pay-debt-confirm');
    expect(await screen.findByTestId('toast')).toHaveTextContent('Đã ghi nợ 39.000 – Dũng (giáo viên)');
    const op = server.ops.at(-1)!;
    expect(op.payload).toMatchObject({ method: 'debt', cash_given: null, customer: { id: 'c-gv', is_new: false } });
  });

  it('D18: tên mới + mô tả, SĐT để trống ⇒ tự tạo khách; khách mới có ngay trong Thu nợ với dư nợ đúng', async () => {
    await startShift();
    await payByDebt();
    fireEvent.change(tid('debt-name'), { target: { value: ' Hùng ' } });
    expect(screen.queryByTestId('customer-suggestions')).not.toBeInTheDocument();
    fireEvent.change(tid('debt-desc'), { target: { value: 'xe ôm' } });
    click('pay-debt-confirm');
    expect(await screen.findByTestId('toast')).toHaveTextContent('Hùng (xe ôm)');
    const c = server.lastOp('pay_order').payload.customer!;
    expect(c).toMatchObject({ is_new: true, name: 'Hùng', description: 'xe ôm', phone: null });

    nav('open-debt');
    fireEvent.change(await screen.findByTestId('debt-search'), { target: { value: 'hung' } });
    expect(await screen.findByTestId(`customer-suggest-${c.id}`)).toHaveTextContent('nợ 39.000');
  });

  it('D19b: Thu nợ hiện từng khoản còn nợ: ngày giờ, mã đơn, món; trả một phần ⇒ trừ vào đơn cũ nhất', async () => {
    await startShift();
    await payByDebt();
    fireEvent.change(tid('debt-name'), { target: { value: 'giao vien' } });
    fireEvent.click(await screen.findByTestId('customer-suggest-c-gv'));
    click('pay-debt-confirm');
    await screen.findByTestId('toast');
    const o = server.orders.find((x) => x.customer_id === 'c-gv')!;

    nav('open-debt');
    fireEvent.change(await screen.findByTestId('debt-search'), { target: { value: 'giao vien' } });
    fireEvent.click(await screen.findByTestId('customer-suggest-c-gv'));
    const row = await screen.findByTestId(`debt-open-${o.id}`);
    expect(row).toHaveTextContent(`#${o.code}`);
    expect(row).toHaveTextContent(o.items[0].name_snap);
    expect(row).toHaveTextContent(dayTime(o.paid_at!));
    expect(row).toHaveTextContent('39.000');

    fireEvent.change(tid('debt-amount'), { target: { value: '10' } });
    click('debt-confirm');
    await waitFor(() => expect(tid(`debt-open-${o.id}`)).toHaveTextContent('29.000/ 39.000'));
    expect(tid('debt-last-payment')).toHaveTextContent('10.000 (tiền mặt)');
  });

  it('D19: thu nợ 50.000 tiền mặt: dư nợ giảm đúng ngay trên máy; không thu quá dư nợ', async () => {
    await startShift();
    nav('open-debt');
    await screen.findByTestId('debt-screen');
    // Ô tìm trống: hiện sẵn khách đang nợ
    expect(await screen.findByTestId('customer-suggest-c-pb')).toHaveTextContent('120.000');
    expect(tid('customer-suggest-c-hoa')).toBeInTheDocument();
    expect(screen.queryByTestId('customer-suggest-c-gv')).not.toBeInTheDocument(); // không nợ
    click('customer-suggest-c-pb');
    expect(tid('customer-balance')).toHaveTextContent('120.000');
    fireEvent.change(tid('debt-amount'), { target: { value: '200' } });
    click('debt-confirm');
    expect(tid('debt-error')).toHaveTextContent('lớn hơn dư nợ');
    fireEvent.change(tid('debt-amount'), { target: { value: '50' } });
    expect(tid('debt-confirm')).toHaveTextContent('Thu 50.000');
    click('debt-confirm');
    expect(await screen.findByTestId('debt-done')).toHaveTextContent('Đã thu nợ 50.000 (tiền mặt) – Dũng (phường B)');
    await waitFor(() => expect(tid('customer-balance')).toHaveTextContent('70.000'));
    const op = server.ops.at(-1)!;
    expect(op).toMatchObject({ kind: 'debt_payment' });
    const shift = server.openShift()!;
    expect(op.payload).toMatchObject({ customer_id: 'c-pb', amount: 50_000, method: 'cash', shift_id: shift.id });

    // Trả hết bằng chuyển khoản
    click('debt-pay-all');
    expect(tid('debt-amount')).toHaveValue('70');
    click('debt-method-transfer');
    click('debt-confirm');
    await waitFor(() => expect(tid('customer-balance')).toHaveTextContent(/^0$/));
    expect(screen.queryByTestId('debt-confirm')).not.toBeInTheDocument(); // hết nợ ⇒ không còn ô thu
    click('customer-clear');
    expect(screen.queryByTestId('customer-suggest-c-pb')).not.toBeInTheDocument();
  });
});

describe('chi tiền (khoản chi giữa ca)', () => {
  const rows = () => screen.queryAllByTestId('expense-row');

  async function openExpenses() {
    nav('open-expenses');
    await screen.findByTestId('expense-screen');
  }

  it('ghi khoản chi: số tiền theo nghìn + ghi chú ⇒ xác nhận to ⇒ create_expense; danh sách + tổng cập nhật ngay', async () => {
    await startShift();
    await openExpenses();
    expect(tid('expense-total')).toHaveTextContent('0đ');
    // Thiếu ghi chú ⇒ báo, không mở xác nhận.
    fireEvent.change(tid('expense-amount'), { target: { value: '50' } });
    click('expense-save');
    expect(tid('expense-error')).toHaveTextContent('Cần ghi chú');
    expect(screen.queryByTestId('expense-confirm-sheet')).not.toBeInTheDocument();

    fireEvent.change(tid('expense-note'), { target: { value: 'mua đá' } });
    expect(tid('expense-save')).toHaveTextContent('Chi 50.000đ');
    click('expense-save');
    expect(within(tid('expense-confirm-sheet')).getByRole('heading')).toHaveTextContent('Chi 50.000đ – mua đá?');
    click('expense-edit'); // Sửa lại ⇒ đóng, giữ số đã nhập
    expect(screen.queryByTestId('expense-confirm-sheet')).not.toBeInTheDocument();
    click('expense-save');
    click('expense-confirm');
    expect(await screen.findByTestId('expense-done')).toHaveTextContent('Đã ghi chi 50.000đ – mua đá');
    expect(server.ops.at(-1)).toMatchObject({ kind: 'create_expense', payload: { amount: 50_000, note: 'mua đá' } });
    expect(rows()).toHaveLength(1);
    expect(tid('expense-total')).toHaveTextContent('50.000đ');
    expect(tid('expense-note')).toHaveValue('');
  });

  it('ghi chú gần đây: bấm chỉ điền ghi chú, không điền số tiền', async () => {
    await startShift();
    server.ownerExpense(20_000, 'mua đá');
    server.ownerExpense(10_000, 'mua ga');
    await openExpenses();
    const chips = await screen.findAllByTestId('expense-recent');
    expect(chips.map((c) => c.textContent).sort()).toEqual(['mua ga', 'mua đá']);
    const da = chips.find((c) => c.textContent === 'mua đá')!;
    fireEvent.click(da);
    expect(tid('expense-note')).toHaveValue('mua đá');
    expect(da).toHaveAttribute('aria-pressed', 'true');
    expect(tid('expense-amount')).toHaveValue('');
  });

  it('hủy khoản mình ghi (có hỏi lại) ⇒ gạch ngang, tổng giảm; khoản chủ ghi không có nút hủy và hiện ngay qua realtime', async () => {
    await startShift();
    await openExpenses();
    fireEvent.change(tid('expense-amount'), { target: { value: '20' } });
    fireEvent.change(tid('expense-note'), { target: { value: 'ghi nhầm' } });
    click('expense-save');
    click('expense-confirm');
    await waitFor(() => expect(rows()).toHaveLength(1));

    click('expense-void');
    click('expense-void-cancel');
    expect(server.kinds).not.toContain('void_expense');
    click('expense-void');
    click('expense-void-confirm');
    await waitFor(() => expect(rows()[0]).toHaveAttribute('data-voided', 'true'));
    expect(tid('expense-total')).toHaveTextContent('0đ');
    expect(server.ops.at(-1)?.kind).toBe('void_expense');

    act(() => void server.ownerExpense(10_000, 'mua chanh'));
    await waitFor(() => expect(rows()).toHaveLength(2));
    const owner = rows().find((r) => r.dataset.owner)!;
    expect(owner).toHaveTextContent('Chủ ghi');
    expect(within(owner).queryByTestId('expense-void')).not.toBeInTheDocument();
    expect(tid('expense-total')).toHaveTextContent('10.000đ');
  });

  it('mất kết nối ⇒ không lưu, báo rõ', async () => {
    await startShift();
    await openExpenses();
    fireEvent.change(tid('expense-amount'), { target: { value: '20' } });
    fireEvent.change(tid('expense-note'), { target: { value: 'mua đá' } });
    server.offline = true;
    click('expense-save');
    click('expense-confirm');
    expect(await screen.findByTestId('expense-error')).toHaveTextContent('mất kết nối');
    expect(rows()).toHaveLength(0);
    expect(server.expenses).toHaveLength(0);
  });
});

describe('nhiều máy cùng hồ sơ tablet (realtime)', () => {
  /** Máy thứ hai đã kích hoạt cùng hồ sơ Tablet A, nói chuyện với cùng server. */
  async function otherDevice() {
    const store = new TabletStore(server.device(), { debounceMs: 0 });
    store.start('tab-a');
    await store.refresh();
    return { store, pos: new Pos(store, { retryDelaysMs: [] }) };
  }

  const combo = () => ({
    id: 'line-1',
    product_id: COMBO_XOI_FULL.product_id,
    name_snap: 'Xôi gà',
    unit_price_snap: XOI_GA.price,
    qty: 1,
    toppings_snap: COMBO_XOI_FULL.topping_ids.map((id) => {
      const t = [TRUNG, CHA].find((x) => x.id === id)!;
      return { id: t.id, name: t.name, price: t.price, extra_box: t.extra_box_takeaway };
    }),
  });

  it('máy khác mở ca ⇒ máy này tự chuyển sang màn Bán hàng của ca đó; không mở được ca thứ hai', async () => {
    activateDevice();
    go('/');
    await screen.findByTestId('open-shift-screen');
    click('staff-s1');
    const b = await otherDevice();
    await b.pos.openShift({ staff_id: 's2' });
    expect(await screen.findByTestId('queue-screen')).toBeInTheDocument();
    expect(tid('shift-staff')).toHaveTextContent('Mai');
    expect(server.kinds).toEqual(['open_shift']);
    b.store.stop();
  });

  it('máy khác tạo đơn ⇒ hiện ngay trong hàng đợi máy này; mã đơn + số thứ tự máy (device_seq) do server cấp, không trùng', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await cartIsNew();
    const b = await otherDevice();
    const theirs = await b.pos.createOrder({ point_id: 'xoi-a', dine_type: 'takeaway', label: 'máy B', items: [combo()] });
    expect(await screen.findByTestId(`queue-card-${theirs.id}`)).toBeInTheDocument();
    const [x, y] = server.openOrders();
    expect([x.device_seq, y.device_seq]).toEqual([1, 2]);
    expect(x.code).not.toBe(y.code);
    // Máy B cũng thấy đơn của máy này
    await waitFor(() => expect(b.store.getSnapshot().open?.orders).toHaveLength(2));
    b.store.stop();
  });

  it('máy khác thanh toán đơn đang thanh toán trong giỏ ⇒ giỏ về đơn mới, báo đã thanh toán ở máy khác; không thu lần hai', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-pay-cash');
    await screen.findByTestId('cart-pay');
    const [o] = server.openOrders();
    const b = await otherDevice();
    await b.pos.payOrder(o.id, { method: 'transfer' });
    expect(await screen.findByTestId('toast')).toHaveTextContent('thanh toán hoặc xóa ở máy khác');
    expect(cards()).toHaveLength(0);
    expect(server.kinds.filter((k) => k === 'pay_order')).toHaveLength(1);
    b.store.stop();
  });

  it('máy khác sửa đơn đang mở trên màn này (chưa sửa gì) ⇒ màn này hiện bản mới', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-card-${o.id}`));
    await screen.findByTestId('order-screen');
    const b = await otherDevice();
    await b.pos.updateOrder(o.id, { items: o.items.map((it) => ({ ...it, qty: 3 })) });
    await waitFor(() => expect(tid('order-total')).toHaveTextContent('75.000'));
    b.store.stop();
  });

  it('máy khác vừa thanh toán đơn mà máy này chưa kịp thấy ⇒ server từ chối, báo rõ, đơn rời hàng đợi', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await cartIsNew();
    const [o] = server.openOrders();
    // Thanh toán thẳng trên server, không báo realtime (kênh của máy này đang trễ)
    Object.assign(server.order(o.id)!, { status: 'paid' });
    click(`queue-card-${o.id}`);
    fireEvent.click(await screen.findByTestId('order-serve'));
    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(await screen.findByTestId('toast')).toHaveTextContent('thanh toán hoặc xóa');
    await cartIsNew();
  });
});

describe('mất kết nối', () => {
  it('không lưu được thì báo rõ, giữ nguyên đơn đang soạn; có mạng lại bấm lại là lưu', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    server.offline = true;
    click('order-save');
    expect(await screen.findByTestId('order-error')).toHaveTextContent('mất kết nối máy chủ');
    expect(await screen.findByTestId('conn-status')).toHaveAttribute('data-state', 'offline');
    expect(tid('offline-banner')).toBeInTheDocument();
    expect(tid('order-total')).toHaveTextContent('39.000');
    server.offline = false;
    click('order-save');
    await cartIsNew();
    expect(server.kinds).toEqual(['open_shift', 'create_order']);
    await waitFor(() => expect(tid('conn-status')).toHaveAttribute('data-state', 'live'));
  });

  it('server đã ghi nhưng mất phản hồi: bấm lại không tạo đơn thứ hai, không thu tiền hai lần', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    server.dropNextResponse = true;
    click('order-save');
    expect(await screen.findByTestId('order-error')).toHaveTextContent('mất kết nối');
    click('order-save');
    await cartIsNew();
    expect(server.kinds).toEqual(['open_shift', 'create_order']);
    expect(server.openOrders()).toHaveLength(1);

    const [o] = server.openOrders();
    fireEvent.click(tid(`queue-card-${o.id}`));
    click('order-pay-cash');
    fireEvent.click(await screen.findByTestId('cash-exact'));
    server.dropNextResponse = true;
    click('pay-confirm');
    // Lần gửi đầu đã ghi trên server ⇒ máy tải lại thấy đơn đã thanh toán, về hàng đợi; không gửi thêm lần nào.
    await cartIsNew();
    expect(server.kinds.filter((k) => k === 'pay_order')).toHaveLength(1);
    expect(server.order(o.id)?.status).toBe('paid');
  });

  it('mở app lúc mất mạng: báo cần mạng, bấm Thử lại khi có mạng thì vào được', async () => {
    server.offline = true;
    activateDevice();
    go('/');
    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    server.offline = false;
    click('load-retry');
    expect(await screen.findByTestId('open-shift-screen')).toBeInTheDocument();
  });
});
