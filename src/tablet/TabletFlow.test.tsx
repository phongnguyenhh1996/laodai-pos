// @vitest-environment jsdom
// Luồng bán hàng trên tablet (bước 5): mở ca → tạo / sửa / xóa đơn → hàng đợi → ra món → thanh toán → đóng ca.
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

/** Tablet đã kích hoạt, Lan đã mở ca, đang ở hàng đợi. */
async function startShift(staff = 's1') {
  activateDevice();
  go('/');
  fireEvent.click(await screen.findByTestId(`staff-${staff}`));
  click('open-shift');
  await screen.findByTestId('queue-screen');
}

async function newOrder() {
  click('new-order');
  await screen.findByTestId('order-screen');
}

/** Thêm món + topping qua bảng chọn topping. */
function addProduct(productId: string, toppingIds: string[] = []) {
  click(`menu-product-${productId}`);
  for (const t of toppingIds) click(`topping-option-${t}`);
  click('topping-add');
}

const cards = () => screen.queryAllByTestId(/^queue-card-/);

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
  it('C10: combo 1 chạm + thu đủ tiền mặt = 3 chạm từ hàng đợi đến lúc xong đơn', async () => {
    await startShift();
    click('new-order'); // 1
    fireEvent.click(await screen.findByTestId(`menu-combo-${COMBO_XOI_FULL.id}`)); // 2
    click('order-pay-exact'); // 3
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent('Đã thu 39.000');
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
    await screen.findByTestId('queue-screen');
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

  it('đơn ship: hiện ô địa chỉ, chưa có địa chỉ thì không lưu được; địa chỉ gửi theo create_order', async () => {
    await startShift();
    await newOrder();
    expect(screen.queryByTestId('order-address')).toBeNull();
    addProduct(XOI_GA.id, [TRUNG.id]);
    click('order-dine-delivery');
    expect(tid('order-dine-delivery')).toHaveAttribute('aria-pressed', 'true');
    expect(tid('order-address')).toBeInTheDocument();
    expect(tid('order-address-missing')).toBeInTheDocument();
    expect(tid('order-save')).toBeDisabled();
    expect(tid('order-pay-exact')).toBeDisabled();

    fireEvent.change(tid('order-address'), { target: { value: '  12 Lê Lợi – 0909 123 456 ' } });
    expect(screen.queryByTestId('order-address-missing')).toBeNull();
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    expect(o).toMatchObject({ dine_type: 'delivery', address: '12 Lê Lợi – 0909 123 456' });
    expect(await screen.findByTestId(`queue-dine-${o.id}`)).toHaveTextContent('Ship');
    expect(tid(`queue-address-${o.id}`)).toHaveTextContent('12 Lê Lợi – 0909 123 456');
    const create = server.ops.find((op) => op.kind === 'create_order')!;
    expect(create.payload).toMatchObject({ order: { dine_type: 'delivery', address: '12 Lê Lợi – 0909 123 456' } });
  });

  it('đơn ship chọn khách có sẵn (như Thu nợ): điền sẵn địa chỉ, khách hiện trên thẻ, ghi nợ chọn sẵn khách đó', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id, []);
    click('order-dine-delivery');
    fireEvent.change(tid('ship-customer-search'), { target: { value: 'hoa' } });
    click('customer-suggest-c-hoa');
    expect(tid('ship-customer-label')).toHaveTextContent('Cô Hoa (20 Lê Lợi)');
    expect(tid('order-address')).toHaveValue('20 Lê Lợi, P.3');
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    expect(o).toMatchObject({ dine_type: 'delivery', address: '20 Lê Lợi, P.3', customer_id: 'c-hoa' });
    expect(server.ops.find((op) => op.kind === 'create_order')!.payload).toMatchObject({ customer: { id: 'c-hoa' } });
    expect(await screen.findByTestId(`queue-customer-${o.id}`)).toHaveTextContent('Cô Hoa');

    // Mở lại đơn: khách vẫn chọn; thanh toán ghi nợ ⇒ khách chọn sẵn.
    click(`queue-open-${o.id}`);
    expect(await screen.findByTestId('ship-customer-label')).toHaveTextContent('Cô Hoa');
    click('order-pay');
    await screen.findByTestId('pay-screen');
    click('pay-method-debt');
    expect(tid('customer-chosen-label')).toHaveTextContent('Cô Hoa');
    click('pay-debt-confirm');
    await screen.findByTestId('queue-screen');
    expect(server.order(o.id)).toMatchObject({ status: 'paid', payment_method: 'debt', customer_id: 'c-hoa' });
  });

  it('đơn ship thêm khách mới (tên + SĐT): server tạo khách cùng đơn, lưu địa chỉ; trả tiền mặt vẫn giữ khách', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id, []);
    click('order-dine-delivery');
    fireEvent.change(tid('ship-customer-search'), { target: { value: '0912 345 678' } });
    click('ship-customer-new');
    expect(tid('ship-customer-new-phone')).toHaveValue('0912 345 678');
    expect(tid('ship-customer-new-ok')).toBeDisabled(); // tên bắt buộc
    fireEvent.change(tid('ship-customer-new-name'), { target: { value: ' Anh Tú ' } });
    click('ship-customer-new-ok');
    expect(tid('ship-customer-chosen')).toHaveTextContent('Khách mới');
    fireEvent.change(tid('order-address'), { target: { value: '5 Hai Bà Trưng' } });
    click('order-pay-exact');
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent('Đã thu');
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
    fireEvent.change(tid('order-address'), { target: { value: '12 Lê Lợi' } });
    click('order-dine-takeaway');
    expect(screen.queryByTestId('order-address')).toBeNull();
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    expect(o).toMatchObject({ dine_type: 'takeaway', address: null });
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
    await screen.findByTestId('queue-screen');
    // Đơn kế tiếp mở đúng tab đang bán (Cơm gà)
    await newOrder();
    expect(tid('order-screen')).toHaveAttribute('data-point', 'com');
    click('point-tab-xoi-a');
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await screen.findByTestId('queue-screen');
    const orders = (server.openOrders()).sort((a, b) => a.device_seq - b.device_seq);
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
    click('order-pay');
    await screen.findByTestId('pay-screen');
    // Màn thanh toán: chỉ có ô "khách đưa" (nhập tay), không có ô giá / giảm giá
    expect(screen.getAllByRole('textbox').map((e) => e.dataset.testid)).toEqual(['cash-manual']);
    expect(document.body.innerHTML).not.toMatch(/giảm giá|discount|chiết khấu/i);
  });

  it('thanh toán tiền mặt: chỉ mệnh giá ≥ tổng; đưa thiếu không xác nhận được; hiện tiền thối', async () => {
    await startShift();
    await newOrder();
    expect(screen.queryByTestId(`menu-product-${COM_GA.id}`)).not.toBeInTheDocument(); // tab Xôi: không có món cơm
    click('point-tab-com');
    addProduct(COM_GA.id); // 35.000, không topping
    click('order-pay');
    await screen.findByTestId('pay-screen');
    expect(tid('pay-total')).toHaveTextContent('35.000');
    expect(screen.queryByTestId('cash-quick-20000')).not.toBeInTheDocument();
    expect(tid('cash-exact')).toBeInTheDocument();
    expect(tid('cash-quick-50000')).toBeInTheDocument();
    expect(tid('pay-confirm')).toBeDisabled();
    fireEvent.change(tid('cash-manual'), { target: { value: '30k' } });
    expect(tid('cash-change')).toHaveTextContent('Chưa đủ');
    expect(tid('pay-confirm')).toBeDisabled();
    click('cash-quick-100000');
    expect(tid('cash-change')).toHaveTextContent('65.000');
    click('pay-confirm');
    await screen.findByTestId('queue-screen');
    const pay = server.ops.at(-1)!;
    expect(pay).toMatchObject({ kind: 'pay_order' });
    expect(pay.payload).toMatchObject({ method: 'cash', cash_given: 100_000, total: 35_000 });
  });

  it('thanh toán chuyển khoản', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-pay');
    await screen.findByTestId('pay-screen');
    click('pay-method-transfer');
    click('pay-transfer-confirm');
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent('chuyển khoản');
    expect(server.ops.at(-1)!.payload).toMatchObject({ method: 'transfer', cash_given: null });
  });

  it('C16: thanh toán xong đơn biến mất; mở lại đường dẫn của đơn đó chỉ về hàng đợi', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    click('order-pay');
    fireEvent.click(await screen.findByTestId('cash-exact'));
    click('pay-confirm');
    await screen.findByTestId('queue-empty');
    // Đơn đã thanh toán trên server nhưng không màn nào của tablet mở được
    expect((server.order(o.id))?.status).toBe('paid');
    for (const path of [`/order/${o.id}`, `/order/${o.id}/pay`]) {
      act(() => window.history.pushState({}, '', path));
      act(() => window.dispatchEvent(new PopStateEvent('popstate')));
      await waitFor(() => expect(window.location.pathname).toBe('/'));
      expect(screen.queryByTestId('order-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pay-screen')).not.toBeInTheDocument();
    }
  });

  it('bấm Lưu liên tục không tạo hai đơn', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    click('order-save');
    click('order-save');
    await screen.findByTestId('queue-screen');
    expect((server.kinds).filter((k) => k === 'create_order')).toHaveLength(1);
  });

  it('rời đơn chưa lưu ⇒ hỏi lại; đơn mới chưa lưu thì không để lại gì', async () => {
    await startShift();
    await newOrder();
    click('order-back'); // chưa có gì ⇒ về luôn
    await screen.findByTestId('queue-screen');
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-back');
    click('discard-no');
    expect(tid('order-screen')).toBeInTheDocument();
    click('order-back');
    click('discard-yes');
    await screen.findByTestId('queue-empty');
    expect(server.kinds).toEqual(['open_shift']);
  });
});

describe('hàng đợi', () => {
  it('C14/C15: 3 đơn, cũ nhất ở trên; vàng ≥ 5 phút, đỏ ≥ 10 phút; Đã ra món ⇒ xuống nhóm Chờ thanh toán; số thứ tự đánh lại', async () => {
    const t0 = Date.parse('2026-11-18T00:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(t0);
    await startShift();
    for (const label of ['một', 'hai', 'ba']) {
      await newOrder();
      fireEvent.change(tid('order-label'), { target: { value: label } });
      fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
      click('order-save');
      await screen.findByTestId('queue-screen');
      vi.setSystemTime(Date.now() + 60_000);
    }
    await waitFor(() => expect(cards()).toHaveLength(3));
    const serveCards = () => within(tid('queue-serve')).queryAllByTestId(/^queue-card-/);
    expect(serveCards().map((c) => within(c).getByTestId(/^queue-label-/).textContent)).toEqual(['một', 'hai', 'ba']);
    expect(serveCards().map((c) => c.dataset.position)).toEqual(['1', '2', '3']);
    for (const c of serveCards()) expect(within(c).getByTestId(/^queue-code-/).textContent).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$/);
    expect(serveCards().map((c) => c.dataset.color)).toEqual(['normal', 'normal', 'normal']);

    // t0 + 5 phút: đơn đầu (tạo lúc t0) vàng
    act(() => void vi.advanceTimersByTime(2 * 60_000));
    expect(serveCards().map((c) => c.dataset.color)).toEqual(['yellow', 'normal', 'normal']);
    // t0 + 10 phút: đơn đầu đỏ, đơn hai (t0+1) vàng, đơn ba (t0+2) vàng
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(serveCards().map((c) => c.dataset.color)).toEqual(['red', 'yellow', 'yellow']);
    expect(within(serveCards()[0]).getByTestId(/^queue-wait-/)).toHaveTextContent('10 phút');

    // Đã ra món đơn đầu ⇒ xuống nhóm Chờ thanh toán, hết màu, số thứ tự đánh lại
    const first = serveCards()[0];
    const firstId = first.dataset.testid!.replace('queue-card-', '');
    fireEvent.click(within(first).getByTestId(`queue-serve-btn-${firstId}`));
    await waitFor(() => expect(within(tid('queue-pay')).getByTestId(`queue-card-${firstId}`)).toBeInTheDocument());
    const payCard = tid(`queue-card-${firstId}`);
    expect(payCard).toHaveAttribute('data-color', 'none');
    expect(payCard).toHaveAttribute('data-position', '3');
    expect(serveCards().map((c) => c.dataset.position)).toEqual(['1', '2']);
    expect((server.order(firstId))?.served_at).not.toBeNull();

    // Thanh toán đơn hai (số 1) ⇒ đơn ba thành số 1, đơn đã ra món thành số 2
    const secondId = serveCards()[0].dataset.testid!.replace('queue-card-', '');
    fireEvent.click(tid(`queue-open-${secondId}`));
    fireEvent.click(await screen.findByTestId('order-pay-exact'));
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(cards().map((c) => c.dataset.position)).toEqual(['1', '2']);
    expect(tid(`queue-card-${firstId}`)).toHaveAttribute('data-position', '2');
  });

  it('sửa đơn đang mở: tăng / bớt số lượng, đổi nhãn ⇒ update_order với tổng mới; không đổi gì thì không ghi', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    addProduct(XOI_XEO.id);
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    expect(tid('order-code')).toHaveTextContent(o.code);
    expect(screen.queryByTestId('order-save')).not.toBeInTheDocument(); // đơn đã lưu thì tự lưu, không có nút Lưu
    expect(tid('order-autosave')).toHaveTextContent('Đã lưu');
    click('order-back'); // không đổi gì
    await screen.findByTestId('queue-screen');
    expect(server.kinds).toEqual(['open_shift', 'create_order']);

    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    const [ga, xeo] = o.items;
    click(`cart-line-${ga.id}-plus`);
    click(`cart-line-${xeo.id}-minus`); // về 0 ⇒ bỏ dòng
    fireEvent.change(tid('order-label'), { target: { value: 'Bàn 4' } });
    expect(tid('order-total')).toHaveTextContent('50.000');
    click('order-serve');
    await screen.findByTestId('queue-screen');
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'update_order', 'serve_order']);
    const upd = server.ops[2].payload;
    expect(upd).toMatchObject({ total: 50_000, label: 'Bàn 4' });
    expect(await within(tid('queue-pay')).findByTestId(`queue-card-${o.id}`)).toBeInTheDocument();
  });

  it('đơn đã lưu tự lưu khi sửa: gom các chạm liên tiếp thành một update_order, không cần bấm gì', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    const [ga] = o.items;
    click(`cart-line-${ga.id}-plus`);
    click(`cart-line-${ga.id}-plus`);
    fireEvent.change(tid('order-label'), { target: { value: 'Bàn 2' } });
    expect(tid('order-autosave')).toHaveAttribute('data-state', 'saving');
    await waitFor(() => expect(tid('order-autosave')).toHaveAttribute('data-state', 'saved'), { timeout: 3000 });
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'update_order']);
    expect(server.order(o.id)).toMatchObject({ label: 'Bàn 2', total: 75_000 });
    expect(tid('order-screen')).toBeInTheDocument(); // vẫn ở màn đơn

    // Sửa rồi về ngay (chưa kịp tự lưu) ⇒ vẫn ghi, không hỏi bỏ thay đổi
    click(`cart-line-${ga.id}-minus`);
    click('order-back');
    await screen.findByTestId('queue-screen');
    expect(screen.queryByTestId('discard-sheet')).not.toBeInTheDocument();
    expect(server.kinds).toEqual(['open_shift', 'create_order', 'update_order', 'update_order']);
    expect((server.order(o.id))?.total).toBe(50_000);
  });

  it('đổi món: bấm dòng để chọn, bấm món / combo khác ⇒ thay dòng đó (giữ số lượng); bấm lại dòng ⇒ thôi', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    addProduct(XOI_GA.id);
    addProduct(XOI_XEO.id);
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
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
    expect(lines[0]).toHaveTextContent('Xôi gà (Trứng)');
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

    click('order-back');
    await screen.findByTestId('queue-screen');
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
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    click(`cart-line-${o.items[0].id}-minus`);
    expect(tid('order-error')).toHaveTextContent('Xóa đơn');
    click('order-back');
    click('discard-yes');
    await screen.findByTestId('queue-screen');
    expect(server.kinds).toEqual(['open_shift', 'create_order']);
    expect((server.order(o.id))?.items).toHaveLength(1);
  });

  it('xóa đơn: chọn lý do 1 chạm ⇒ delete_order kèm trạng thái lúc xóa, đơn rời hàng đợi', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-serve');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    fireEvent.click(await screen.findByTestId('order-delete'));
    expect(tid('delete-sheet')).toBeInTheDocument();
    click('delete-cancel');
    expect(screen.queryByTestId('delete-sheet')).not.toBeInTheDocument();
    click('order-delete');
    click('delete-reason-customer_left');
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent(`Đã xóa đơn ${o.code}`);
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
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();

    click('open-close-shift');
    await screen.findByTestId('close-shift-screen');
    click('close-review');
    expect(tid('close-error')).toBeInTheDocument(); // chưa nhập
    fireEvent.change(tid('close-boxes'), { target: { value: '190' } });
    fireEvent.change(tid('close-plates'), { target: { value: '60' } });
    fireEvent.change(tid('close-cash'), { target: { value: '480.000' } });
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
    fireEvent.click(tid(`queue-open-${o.id}`));
    fireEvent.click(await screen.findByTestId('order-pay-exact'));
    await screen.findByTestId('queue-empty');
    const paid = server.order(o.id);
    const shifts = server.ops.filter((x) => x.kind === 'open_shift').map((x) => x.entity_id);
    expect(paid).toMatchObject({ opened_shift_id: shifts[0], paid_shift_id: shifts[1] });
  });
});

describe('ghi nợ & thu nợ', () => {
  async function payByDebt() {
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`)); // 39.000
    click('order-pay');
    await screen.findByTestId('pay-screen');
    click('pay-method-debt');
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
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent('Đã ghi nợ 39.000 – Dũng (giáo viên)');
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
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent('Hùng (xe ôm)');
    const c = server.ops.at(-1)!.payload.customer as Record<string, unknown>;
    expect(c).toMatchObject({ is_new: true, name: 'Hùng', description: 'xe ôm', phone: null });

    click('open-debt');
    fireEvent.change(await screen.findByTestId('debt-search'), { target: { value: 'hung' } });
    expect(await screen.findByTestId(`customer-suggest-${c.id}`)).toHaveTextContent('nợ 39.000');
  });

  it('D19b: Thu nợ hiện từng khoản còn nợ: ngày giờ, mã đơn, món; trả một phần ⇒ trừ vào đơn cũ nhất', async () => {
    await startShift();
    await payByDebt();
    fireEvent.change(tid('debt-name'), { target: { value: 'giao vien' } });
    fireEvent.click(await screen.findByTestId('customer-suggest-c-gv'));
    click('pay-debt-confirm');
    await screen.findByTestId('queue-flash');
    const o = server.orders.find((x) => x.customer_id === 'c-gv')!;

    click('open-debt');
    fireEvent.change(await screen.findByTestId('debt-search'), { target: { value: 'giao vien' } });
    fireEvent.click(await screen.findByTestId('customer-suggest-c-gv'));
    const row = await screen.findByTestId(`debt-open-${o.id}`);
    expect(row).toHaveTextContent(`#${o.code}`);
    expect(row).toHaveTextContent(o.items[0].name_snap);
    expect(row).toHaveTextContent(dayTime(o.paid_at!));
    expect(row).toHaveTextContent('39.000');

    fireEvent.change(tid('debt-amount'), { target: { value: '10k' } });
    click('debt-confirm');
    await waitFor(() => expect(tid(`debt-open-${o.id}`)).toHaveTextContent('29.000/ 39.000'));
    expect(tid('debt-last-payment')).toHaveTextContent('10.000 (tiền mặt)');
  });

  it('D19: thu nợ 50.000 tiền mặt: dư nợ giảm đúng ngay trên máy; không thu quá dư nợ', async () => {
    await startShift();
    click('open-debt');
    await screen.findByTestId('debt-screen');
    // Ô tìm trống: hiện sẵn khách đang nợ
    expect(await screen.findByTestId('customer-suggest-c-pb')).toHaveTextContent('120.000');
    expect(tid('customer-suggest-c-hoa')).toBeInTheDocument();
    expect(screen.queryByTestId('customer-suggest-c-gv')).not.toBeInTheDocument(); // không nợ
    click('customer-suggest-c-pb');
    expect(tid('customer-balance')).toHaveTextContent('120.000');
    fireEvent.change(tid('debt-amount'), { target: { value: '200k' } });
    click('debt-confirm');
    expect(tid('debt-error')).toHaveTextContent('lớn hơn dư nợ');
    fireEvent.change(tid('debt-amount'), { target: { value: '50k' } });
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
    expect(tid('debt-amount')).toHaveValue('70000');
    click('debt-method-transfer');
    click('debt-confirm');
    await waitFor(() => expect(tid('customer-balance')).toHaveTextContent(/^0$/));
    expect(screen.queryByTestId('debt-confirm')).not.toBeInTheDocument(); // hết nợ ⇒ không còn ô thu
    click('customer-clear');
    expect(screen.queryByTestId('customer-suggest-c-pb')).not.toBeInTheDocument();
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

  it('máy khác mở ca ⇒ máy này tự chuyển sang hàng đợi của ca đó; không mở được ca thứ hai', async () => {
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

  it('máy khác tạo đơn ⇒ hiện ngay trong hàng đợi máy này; mã đơn + số thứ tự do server cấp, không trùng', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await screen.findByTestId('queue-screen');
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

  it('máy khác thanh toán đơn đang mở ở màn thanh toán ⇒ về hàng đợi, báo đã thanh toán ở máy khác; không thu lần hai', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-pay');
    await screen.findByTestId('pay-screen');
    const [o] = server.openOrders();
    const b = await otherDevice();
    await b.pos.payOrder(o.id, { method: 'transfer' });
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent('thanh toán hoặc xóa ở máy khác');
    expect(cards()).toHaveLength(0);
    expect(server.kinds.filter((k) => k === 'pay_order')).toHaveLength(1);
    b.store.stop();
  });

  it('máy khác sửa đơn đang mở trên màn này (chưa sửa gì) ⇒ màn này hiện bản mới', async () => {
    await startShift();
    await newOrder();
    addProduct(XOI_GA.id);
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
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
    await screen.findByTestId('queue-screen');
    const [o] = server.openOrders();
    // Thanh toán thẳng trên server, không báo realtime (kênh của máy này đang trễ)
    Object.assign(server.order(o.id)!, { status: 'paid' });
    fireEvent.click(tid(`queue-serve-btn-${o.id}`));
    expect(await screen.findByTestId('queue-error')).toHaveTextContent('thanh toán hoặc xóa');
    await waitFor(() => expect(cards()).toHaveLength(0));
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
    await screen.findByTestId('queue-screen');
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
    await screen.findByTestId('queue-screen');
    expect(server.kinds).toEqual(['open_shift', 'create_order']);
    expect(server.openOrders()).toHaveLength(1);

    const [o] = server.openOrders();
    fireEvent.click(tid(`queue-open-${o.id}`));
    click('order-pay');
    fireEvent.click(await screen.findByTestId('cash-exact'));
    server.dropNextResponse = true;
    click('pay-confirm');
    // Lần gửi đầu đã ghi trên server ⇒ máy tải lại thấy đơn đã thanh toán, về hàng đợi; không gửi thêm lần nào.
    await screen.findByTestId('queue-screen');
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
