// @vitest-environment jsdom
// Luồng bán hàng trên tablet (bước 5): mở ca → tạo / sửa / xóa đơn → hàng đợi → ra món → thanh toán → đóng ca.
// Chạy với IndexedDB giả, không có server: kiểm tra những gì ghi xuống máy + outbox và những gì hiện ra.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { App } from '@/app/App';
import { CANH, CHA, COMBO_XOI_FULL, COM_GA, DUA, TRUNG, XOI_GA, XOI_XEO } from '@/domain/fixtures';
import { localDb } from '@/lib/localdb';
import { syncRunner } from '@/lib/sync';
import { pendingOps, visibleOrders } from '@/sync';
import { activateDevice, clearLocalDb, stubCatalog } from '@/test-utils/tablet';

const tid = (id: string) => screen.getByTestId(id);
const click = (id: string) => fireEvent.click(tid(id));
const ops = async () => (await pendingOps(localDb)).map((o) => o.kind);

function go(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
}

/** Tablet đã kích hoạt, Lan đã mở ca, đang ở hàng đợi. */
async function startShift(staff = 's1') {
  await activateDevice();
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
  stubCatalog();
  vi.spyOn(syncRunner, 'start').mockImplementation(() => undefined); // outbox giữ nguyên để kiểm tra
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await clearLocalDb();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('mở ca', () => {
  it('chọn tên rồi bấm Mở ca: không nhập gì thêm, ca nhận số mặc định của hồ sơ tablet', async () => {
    await activateDevice();
    go('/');
    expect(await screen.findByTestId('open-shift')).toBeDisabled(); // chưa chọn tên
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    click('staff-s2');
    expect(tid('staff-s2')).toHaveAttribute('aria-pressed', 'true');
    click('open-shift');
    expect(await screen.findByTestId('queue-screen')).toBeInTheDocument();
    expect(tid('shift-staff')).toHaveTextContent('Mai');
    const [op] = await pendingOps(localDb);
    expect(op.kind).toBe('open_shift');
    expect(op.payload).toMatchObject({ staff_id: 's2' });
    expect(await localDb.meta.get('shift')).toMatchObject({
      value: { staff_id: 's2', open_boxes: 200, open_plates: 60, open_float: 500_000 },
    });
  });

  it('chưa mở ca thì các đường dẫn bán hàng về màn mở ca', async () => {
    await activateDevice();
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
    expect(await ops()).toEqual(['open_shift', 'create_order', 'pay_order']);
    const pay = (await pendingOps(localDb))[2].payload;
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
    const [o] = await visibleOrders(localDb);
    expect(o).toMatchObject({ point_id: 'xoi-a', dine_type: 'takeaway', total: 39_000 });
    expect(o.items[0].toppings_snap.map((t) => t.id)).toEqual([TRUNG.id, CHA.id]);

    await newOrder();
    click('point-tab-com');
    expect(tid('order-dine-dinein')).toHaveAttribute('aria-pressed', 'true');
    addProduct(COM_GA.id, [CANH.id, DUA.id]);
    click('order-dine-takeaway');
    expect(tid('order-total')).toHaveTextContent('43.000');
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
    const orders = (await visibleOrders(localDb)).sort((a, b) => a.device_seq - b.device_seq);
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
    const pay = (await pendingOps(localDb)).at(-1)!;
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
    expect((await pendingOps(localDb)).at(-1)!.payload).toMatchObject({ method: 'transfer', cash_given: null });
  });

  it('C16: thanh toán xong đơn biến mất; mở lại đường dẫn của đơn đó chỉ về hàng đợi', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = await visibleOrders(localDb);
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    click('order-pay');
    fireEvent.click(await screen.findByTestId('cash-exact'));
    click('pay-confirm');
    await screen.findByTestId('queue-empty');
    // Đơn vẫn nằm ẩn trong IndexedDB chờ sync nhưng không màn nào mở được
    expect((await localDb.orders.get(o.id))?.status).toBe('paid');
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
    expect((await ops()).filter((k) => k === 'create_order')).toHaveLength(1);
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
    expect(await ops()).toEqual(['open_shift']);
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
    for (const c of serveCards()) expect(within(c).getByTestId(/^queue-code-/).textContent).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/);
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
    expect((await localDb.orders.get(firstId))?.served_at).not.toBeNull();

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
    const [o] = await visibleOrders(localDb);
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    expect(tid('order-code')).toHaveTextContent(o.code);
    click('order-save'); // không đổi gì
    await screen.findByTestId('queue-screen');
    expect(await ops()).toEqual(['open_shift', 'create_order']);

    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    await screen.findByTestId('order-screen');
    const [ga, xeo] = o.items;
    click(`cart-line-${ga.id}-plus`);
    click(`cart-line-${xeo.id}-minus`); // về 0 ⇒ bỏ dòng
    fireEvent.change(tid('order-label'), { target: { value: 'Bàn 4' } });
    expect(tid('order-total')).toHaveTextContent('50.000');
    click('order-serve');
    await screen.findByTestId('queue-screen');
    expect(await ops()).toEqual(['open_shift', 'create_order', 'update_order', 'serve_order']);
    const upd = (await pendingOps(localDb))[2].payload;
    expect(upd).toMatchObject({ total: 50_000, label: 'Bàn 4' });
    expect(await within(tid('queue-pay')).findByTestId(`queue-card-${o.id}`)).toBeInTheDocument();
  });

  it('xóa đơn: chọn lý do 1 chạm ⇒ delete_order kèm trạng thái lúc xóa, đơn rời hàng đợi', async () => {
    await startShift();
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-serve');
    await screen.findByTestId('queue-screen');
    const [o] = await visibleOrders(localDb);
    fireEvent.click(await screen.findByTestId(`queue-open-${o.id}`));
    fireEvent.click(await screen.findByTestId('order-delete'));
    expect(tid('delete-sheet')).toBeInTheDocument();
    click('delete-cancel');
    expect(screen.queryByTestId('delete-sheet')).not.toBeInTheDocument();
    click('order-delete');
    click('delete-reason-customer_left');
    expect(await screen.findByTestId('queue-flash')).toHaveTextContent(`Đã xóa đơn ${o.code}`);
    expect(cards()).toHaveLength(0);
    expect((await pendingOps(localDb)).at(-1)!.payload).toMatchObject({ reason: 'customer_left', status_before: 'served' });
  });
});

describe('đóng ca', () => {
  it('B8/B9: đếm mù, còn đơn mở vẫn đóng được; sau đó chỉ hiện "Đã đóng ca"; ca sau thấy và thu được đơn đó', async () => {
    await startShift('s1');
    await newOrder();
    fireEvent.click(screen.getByTestId(`menu-combo-${COMBO_XOI_FULL.id}`));
    click('order-save');
    await screen.findByTestId('queue-screen');
    const [o] = await visibleOrders(localDb);

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
    const close = (await pendingOps(localDb)).at(-1)!;
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
    const paid = await localDb.orders.get(o.id);
    const shifts = (await pendingOps(localDb)).filter((x) => x.kind === 'open_shift').map((x) => x.entity_id);
    expect(paid).toMatchObject({ opened_shift_id: shifts[0], paid_shift_id: shifts[1] });
  });
});
