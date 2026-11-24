import { SEED } from '../../tests/support/seed-ids';

// C. Bán hàng (mục 10.4), bước 5.

const tid = (id: string) => `[data-testid=${id}]`;
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$/;

interface DbOrder {
  id: string;
  code: string;
  point_id: string;
  dine_type: string;
  status: string;
  total: number;
  label: string | null;
  payment_method: string | null;
  cash_given: number | null;
  address: string | null;
  ship_fee: number;
  ship_mode: string;
  ship_payout: number;
  opened_shift_id: string;
  served: boolean;
  items: Array<{ product_id: string; qty: number; unit_price_snap: number; toppings: Array<{ id: string; price: number }> }>;
}

const serverOrders = () => cy.task<DbOrder[]>('db:orders', 'A');
const cards = (group?: 'serve' | 'pay') => cy.get(`${group ? tid(`queue-${group}`) + ' ' : ''}[data-testid^=queue-card-]`);

/** Đơn chỉ có một combo, lưu vào hàng đợi; trả về id đơn. */
function comboOrder(combo: keyof typeof SEED.combos, label?: string) {
  cy.get(tid('new-order')).click();
  if (label) cy.get(tid('order-label')).type(label);
  cy.get(tid(`menu-combo-${SEED.combos[combo]}`)).click();
  cy.get(tid('order-save')).click();
  cy.get(tid('queue-screen')).should('be.visible');
}

describe('C. Bán hàng', () => {
  beforeEach(() => {
    cy.resetAll();
    cy.activateTablet('A');
  });

  it('C10: bấm combo 1 lần rồi thanh toán tiền mặt "đủ tiền": tối đa 3 chạm từ hàng đợi đến lúc xong đơn', () => {
    cy.openShift('Lan');
    cy.get(tid('new-order')).click(); // 1
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click(); // 2
    cy.get(tid('order-pay-exact')).should('contain.text', '31.000').click(); // 3
    cy.get(tid('queue-screen')).should('be.visible');
    cy.get(tid('queue-flash')).should('contain.text', '31.000');
    cy.get('[data-testid^=queue-card-]').should('not.exist');

    cy.waitLive();
    serverOrders().then((os) => {
      expect(os).to.have.length(1);
      expect(os[0]).to.include({ status: 'paid', payment_method: 'cash', total: 31_000, cash_given: 31_000, point_id: SEED.points.xoiA });
      expect(os[0].items).to.have.length(1);
      expect(os[0].items[0]).to.include({ product_id: SEED.products.xoiGa, qty: 1, unit_price_snap: 25_000 });
      expect(os[0].items[0].toppings.map((t) => t.id)).to.deep.eq([SEED.toppings.trung]);
    });
  });

  it('C11: món + 2 topping, mang về: tổng tiền đúng; Tại chỗ / Mang về mặc định đúng theo điểm bán', () => {
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('have.attr', 'aria-selected', 'true');
    cy.get(tid('order-dine-takeaway')).should('have.attr', 'aria-pressed', 'true'); // Xôi = Mang về
    cy.get(tid(`menu-product-${SEED.products.xoiXeo}`)).click();
    cy.get(tid(`topping-option-${SEED.toppings.cha}`)).click();
    cy.get(tid(`topping-option-${SEED.toppings.ruoc}`)).click();
    cy.get(tid('topping-add')).should('contain.text', '28.000').click(); // 15.000 + 8.000 + 5.000
    cy.get(tid('order-total')).should('have.text', '28.000');

    cy.get(tid(`point-tab-${SEED.points.com}`)).should('be.disabled'); // đơn xôi không chuyển sang menu cơm
    cy.get(tid('order-save')).click();

    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.com}`)).click();
    cy.get(tid('order-dine-dinein')).should('have.attr', 'aria-pressed', 'true'); // Cơm gà = Tại chỗ
    cy.get(tid('order-back')).click();

    cy.waitLive();
    serverOrders().then((os) => {
      expect(os).to.have.length(1);
      expect(os[0]).to.include({ dine_type: 'takeaway', total: 28_000, status: 'open' });
      expect(os[0].items[0].toppings.map((t) => t.id).sort()).to.deep.eq([SEED.toppings.cha, SEED.toppings.ruoc].sort());
    });
  });

  it('C12: chuyển tab Xôi ↔ Cơm gà trong cùng ca: đơn được gắn nhãn điểm bán đúng', () => {
    cy.openShift('Lan');
    // Đơn xôi
    comboOrder('xoiGaTrung');
    // Chuyển sang Cơm gà, bán một đơn
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.com}`)).click();
    cy.get(tid(`menu-combo-${SEED.combos.comGaCanh}`)).click();
    cy.get(tid('order-save')).click();
    // Đơn kế tiếp mở đúng tab đang bán (Cơm gà); quay lại Xôi
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('have.attr', 'aria-selected', 'true');
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiXeoChaRuoc}`)).click();
    cy.get(tid('order-save')).click();
    cards().should('have.length', 3);

    cy.waitLive();
    serverOrders().then((os) => {
      expect(os.map((o) => [o.point_id, o.dine_type, o.total])).to.deep.eq([
        [SEED.points.xoiA, 'takeaway', 31_000],
        [SEED.points.com, 'dinein', 40_000],
        [SEED.points.xoiA, 'takeaway', 28_000],
      ]);
    });
  });

  it('C13: nhân viên không có ô nào để sửa giá hay giảm giá', () => {
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    // Màn đơn: ô nhập duy nhất là nhãn / số bàn
    cy.get(`${tid('order-screen')} input, ${tid('order-screen')} textarea, ${tid('order-screen')} [contenteditable]`)
      .should('have.length', 1)
      .first()
      .should('have.attr', 'data-testid', 'order-label');
    cy.get('[data-testid*=price-input], [data-testid*=discount]').should('not.exist');
    cy.get(tid('order-pay')).click();
    // Màn thanh toán: ô nhập duy nhất là "khách đưa"
    cy.get(`${tid('pay-screen')} input, ${tid('pay-screen')} textarea`).should('have.length', 1).first().should('have.attr', 'data-testid', 'cash-manual');
    cy.get(tid('pay-method-transfer')).click();
    cy.get(`${tid('pay-screen')} input`).should('not.exist');
    cy.get('[data-testid*=discount]').should('not.exist');
  });

  it('C14: 3 đơn, cũ nhất ở trên; 5 phút ⇒ vàng, 10 phút ⇒ đỏ; "Đã ra món" ⇒ xuống nhóm "Chờ thanh toán"', () => {
    // Giờ tạo đơn là giờ server ⇒ lùi giờ tạo trên server (một: t0, hai: t0+1, ba: t0+2 với t0 = 2 phút trước),
    // tablet nhận thay đổi qua realtime; rồi tua đồng hồ của trình duyệt.
    cy.openShift('Lan');
    comboOrder('xoiGaTrung', 'một');
    comboOrder('xoiXeoChaRuoc', 'hai');
    comboOrder('xoiGaTrung', 'ba');
    cy.task('db:ageOrders', { một: 2, hai: 1, ba: 0 });
    cards('serve').first().find('[data-testid^=queue-wait-]').should('contain.text', '2 phút');
    cy.then(() => cy.clock(Date.now(), ['Date'])); // giờ lúc lệnh chạy (không phải lúc xếp lệnh)
    // (giờ = t0 + 2 phút)
    cards('serve').should('have.length', 3);
    cards('serve').then(($c) => {
      expect([...$c].map((c) => c.querySelector('[data-testid^=queue-label-]')?.textContent)).to.deep.eq(['một', 'hai', 'ba']);
      expect([...$c].map((c) => c.dataset.position)).to.deep.eq(['1', '2', '3']);
      expect([...$c].map((c) => c.dataset.color)).to.deep.eq(['normal', 'normal', 'normal']);
    });

    cy.tick(3 * 60_000); // t0 + 5: đơn "một" chờ 5 phút
    cards('serve').should(($c) => expect([...$c].map((c) => c.dataset.color)).to.deep.eq(['yellow', 'normal', 'normal']));
    cy.tick(5 * 60_000); // t0 + 10
    cards('serve').should(($c) => expect([...$c].map((c) => c.dataset.color)).to.deep.eq(['red', 'yellow', 'yellow']));
    cards('serve').first().find('[data-testid^=queue-wait-]').should('have.text', '10 phút');

    // Đã ra món đơn "một" ⇒ xuống nhóm Chờ thanh toán, hết màu chờ
    cards('serve').first().find('[data-testid^=queue-serve-btn-]').click();
    cards('serve').should('have.length', 2);
    cards('pay').should('have.length', 1).first().should('have.attr', 'data-color', 'none').find('[data-testid^=queue-label-]').should('have.text', 'một');
    cards('serve').should(($c) => expect([...$c].map((c) => c.dataset.position)).to.deep.eq(['1', '2']));
    cards('pay').first().should('have.attr', 'data-position', '3');
    cy.clock().invoke('restore');

    cy.waitLive();
    serverOrders().then((os) => {
      expect(os.map((o) => [o.label, o.status, o.served])).to.deep.eq([
        ['một', 'served', true],
        ['hai', 'open', false],
        ['ba', 'open', false],
      ]);
    });
  });

  it('C15: mã đơn đúng dạng 1 chữ + 2 số; số thứ tự trong hàng đợi đánh lại sau khi thanh toán một đơn', () => {
    cy.openShift('Lan');
    comboOrder('xoiGaTrung', 'một');
    comboOrder('xoiXeoChaRuoc', 'hai');
    comboOrder('xoiGaTrung', 'ba');
    cards().should('have.length', 3);
    cy.get('[data-testid^=queue-code-]').each(($c) => expect($c.text()).to.match(CODE));
    cy.get('[data-testid^=queue-code-]').then(($c) => expect(new Set([...$c].map((c) => c.textContent)).size).to.eq(3));
    cy.get('[data-testid^=queue-pos-]').then(($p) => expect([...$p].map((p) => p.textContent)).to.deep.eq(['1', '2', '3']));

    // Thanh toán đơn "hai" (số 2)
    cards().eq(1).find('[data-testid^=queue-open-]').click();
    cy.get(tid('order-code')).invoke('text').should('match', CODE);
    cy.get(tid('order-pay')).click();
    // Nhập tay theo nghìn: gõ 1000 = 1.000.000đ; bấm nút tiền nhanh thì ô nhập tay xóa
    cy.get(tid('cash-manual')).type('1000').should('have.value', '1.000');
    cy.get(tid('cash-change')).should('have.text', '972.000');
    cy.get(tid('cash-quick-50000')).click();
    cy.get(tid('cash-manual')).should('have.value', '');
    cy.get(tid('cash-change')).should('have.text', '22.000');
    cy.get(tid('pay-confirm')).click();

    cards().should('have.length', 2);
    cards().then(($c) => {
      expect([...$c].map((c) => c.querySelector('[data-testid^=queue-label-]')?.textContent)).to.deep.eq(['một', 'ba']);
      expect([...$c].map((c) => c.dataset.position)).to.deep.eq(['1', '2']);
    });
    cy.get('[data-testid^=queue-pos-]').then(($p) => expect([...$p].map((p) => p.textContent)).to.deep.eq(['1', '2']));

    cy.waitLive();
    serverOrders().then((os) => {
      expect(os.every((o) => CODE.test(o.code))).to.eq(true);
      expect(os[1]).to.include({ label: 'hai', status: 'paid', cash_given: 50_000 });
    });
  });

  it('C16: thanh toán xong, đơn biến mất khỏi tablet; không có màn hình nào xem lại đơn đã thanh toán', () => {
    cy.openShift('Lan');
    comboOrder('xoiGaTrung', 'khách A');
    cards().first().invoke('attr', 'data-testid').then((t) => {
      const id = String(t).replace('queue-card-', '');
      cards().first().find(`[data-testid=queue-open-${id}]`).click();
      cy.get(tid('order-pay')).click();
      cy.get(tid('pay-method-transfer')).click();
      cy.get(tid('pay-transfer-confirm')).click();
      cy.get(tid('queue-empty')).should('be.visible');
      cy.get(tid(`queue-card-${id}`)).should('not.exist');

      // Vào thẳng đường dẫn của đơn đã thanh toán: chỉ về hàng đợi
      for (const path of [`/order/${id}`, `/order/${id}/pay`]) {
        cy.visit(path);
        cy.location('pathname').should('eq', '/');
        cy.get(tid('queue-screen')).should('be.visible');
        cy.get(tid('order-screen')).should('not.exist');
        cy.get(tid('pay-screen')).should('not.exist');
      }
      // Không có link / nút nào dẫn tới lịch sử đơn
      cy.get('a[href*=history], a[href*=paid], [data-testid*=history]').should('not.exist');

      cy.waitLive();
      serverOrders().then((os) => expect(os[0]).to.include({ id, status: 'paid', payment_method: 'transfer' }));
      // Tablet không giữ dữ liệu đơn nào trên máy (không còn IndexedDB của bản offline)
      cy.window().then((win) => win.indexedDB.databases()).should((dbs) => expect(dbs.map((d) => d.name)).not.to.include('laodai-pos'));
    });
  });

  it('C17: khách đổi món: bấm dòng trong đơn để chọn, bấm món / combo khác ⇒ thay đúng dòng đó, giữ số lượng; server nhận đơn đã đổi', () => {
    const P = SEED.products;
    const T = SEED.toppings;
    const line = (productId: string) => cy.get(`[data-testid^=cart-line-][data-product="${productId}"]`);
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    for (const p of [P.xoiGa, P.xoiGa, P.xoiXeo]) {
      cy.get(tid(`menu-product-${p}`)).click();
      cy.get(tid('topping-add')).click();
    }
    cy.get(tid('order-total')).should('have.text', '65.000'); // 2 × 25.000 + 15.000
    cy.get(tid('order-save')).click();
    cy.get('[data-testid^=queue-open-]').click();

    // Chọn rồi bấm lại ⇒ thôi, không đổi gì
    line(P.xoiGa).find('[data-testid$=-pick]').click();
    cy.get(tid('swap-banner')).should('contain.text', '2× Xôi gà');
    line(P.xoiGa).should('have.attr', 'data-swapping', 'true');
    line(P.xoiGa).find('[data-testid$=-pick]').click();
    cy.get(tid('swap-banner')).should('not.exist');

    // 2× Xôi gà ⇒ 2× Xôi pate (Trứng): vẫn ở dòng đầu, vẫn 2 phần
    line(P.xoiGa).find('[data-testid$=-pick]').click();
    cy.get(tid(`menu-product-${P.xoiPate}`)).click();
    cy.get(tid(`topping-option-${T.trung}`)).click();
    cy.get(tid('topping-add')).should('contain.text', 'Đổi').and('contain.text', '26.000').click();
    cy.get(tid('swap-banner')).should('not.exist');
    line(P.xoiGa).should('not.exist');
    cy.get(`${tid('cart-lines')} > li`).should('have.length', 2).first().should('have.attr', 'data-product', P.xoiPate);
    line(P.xoiPate).find('[data-testid$=-qty]').should('have.text', '2');

    // Đổi topping của chính món đó: bảng topping mở sẵn Trứng
    line(P.xoiPate).find('[data-testid$=-pick]').click();
    cy.get(tid(`menu-product-${P.xoiPate}`)).click();
    cy.get(tid(`topping-option-${T.trung}`)).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('topping-cancel')).click();
    cy.get(tid('swap-cancel')).click();

    // 1× Xôi xéo ⇒ combo Xôi xéo chả ruốc (1 chạm)
    line(P.xoiXeo).find('[data-testid$=-pick]').click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiXeoChaRuoc}`)).click();
    cy.get(`${tid('cart-lines')} > li`).should('have.length', 2);
    cy.get(tid('order-total')).should('have.text', '80.000'); // 2 × 26.000 + 28.000
    cy.get(tid('order-autosave')).should('have.attr', 'data-state', 'saved');
    cy.get(tid('order-back')).click();
    cy.get(tid('queue-screen')).should('be.visible');

    cy.waitLive();
    serverOrders().then((os) => {
      expect(os).to.have.length(1);
      expect(os[0]).to.include({ status: 'open', total: 80_000 });
      expect(os[0].items.map((i) => [i.product_id, i.qty, i.toppings.map((t) => t.id).sort().join()])).to.deep.eq([
        [P.xoiPate, 2, T.trung],
        [P.xoiXeo, 1, [T.cha, T.ruoc].sort().join()],
      ]);
    });
  });

  it('C18: điện thoại 390×844, đơn ship có phí: bấm Ship không bật bàn phím; phí cộng vào tổng; bảng địa chỉ; 3 nút một hàng', () => {
    cy.viewport(390, 844);
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click(); // 31.000
    cy.get(tid('order-dine-delivery')).click();
    cy.document().its('activeElement.tagName').should('not.be.oneOf', ['INPUT', 'TEXTAREA']);
    cy.get(tid('order-address-missing')).should('be.visible');

    cy.get(tid('order-ship-fee-10000')).click().should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-pay-exact')).should('contain.text', '41.000');
    cy.get(tid('order-ship-fee-10000')).click().should('have.attr', 'aria-pressed', 'false'); // bấm lại = bỏ phí
    cy.get(tid('order-pay-exact')).should('contain.text', '31.000');
    cy.get(tid('order-ship-fee-15000')).click();
    cy.get(tid('order-pay-exact')).should('contain.text', '46.000');

    // Ba nút dưới cùng nằm trên một hàng, chữ không bị cắt.
    cy.get(tid('order-pay')).then(($pay) => {
      const top = $pay[0].getBoundingClientRect().top;
      for (const id of ['order-serve', 'order-save']) {
        cy.get(tid(id)).should(($b) => {
          expect(Math.abs($b[0].getBoundingClientRect().top - top)).to.be.lessThan(2);
          expect($b[0].scrollWidth).to.be.at.most($b[0].clientWidth);
        });
      }
    });

    cy.get(tid('order-ship-details')).click();
    cy.get(tid('ship-sheet-summary')).should('contain.text', '+15.000').and('contain.text', '46.000');
    cy.get(tid('ship-sheet-done')).should('be.disabled');
    cy.get(tid('ship-customer-search')).should('be.focused');
    cy.get(tid('order-address')).type('12 Lê Lợi');
    cy.get(tid('ship-sheet-done')).click();
    cy.get(tid('order-ship-summary')).should('contain.text', '12 Lê Lợi');

    cy.get(tid('order-save')).click();
    cy.get(tid('queue-screen')).should('be.visible');
    cards().first().find('[data-testid^=queue-ship-fee-]').should('have.text', '+15k ship');

    cy.waitLive();
    serverOrders().then((os) => {
      expect(os).to.have.length(1);
      expect(os[0]).to.include({ dine_type: 'delivery', address: '12 Lê Lợi', ship_fee: 15_000, total: 46_000, status: 'open' });
    });
    cy.telegramWaitFor('Quán ship · phí ship 15.000');
  });

  it('C19: shipper ngoài: trả shipper bắt buộc, không vào tổng; thu CK; đóng ca đếm = tiền lẻ − trả shipper ⇒ chênh 0; hai máy cùng quầy cùng mặc định', () => {
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click(); // 31.000
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-shop')).should('have.attr', 'aria-pressed', 'true'); // đầu ca
    cy.get(tid('order-address')).type('12 Lê Lợi');
    cy.get(tid('order-ship-mode-external')).click();
    cy.get(tid('order-ship-fee-title')).should('have.text', 'Phụ thu');
    cy.get(tid('order-payout-missing')).should('be.visible');
    cy.get(tid('order-pay')).should('be.disabled');
    cy.get(tid('order-ship-fee-5000')).click();
    cy.get(tid('order-ship-payout-10000')).click();
    cy.get(tid('order-total')).should('have.text', '36.000'); // không cộng 10.000 trả shipper
    cy.get(tid('order-pay')).should('not.be.disabled').click();
    cy.get(tid('pay-total')).should('have.text', '36.000');
    cy.get(tid('pay-ship-payout')).should('have.text', 'Trả shipper −10.000 (lấy từ két)');
    cy.get(tid('pay-method-transfer')).click();
    cy.get(tid('pay-transfer-confirm')).click();
    cy.get(tid('queue-flash')).should('contain.text', 'chuyển khoản');
    cy.telegramWaitFor('Shipper ngoài · phụ thu 5.000 · trả shipper 10.000');

    // Máy thứ hai của cùng quầy hỏi server ⇒ cùng mặc định (đơn đã thanh toán vẫn tính).
    cy.task('sim:shipDefaults', 'A').should('deep.equal', { ship_mode: 'external', ship_fee: 5000, ship_payout: 10000 });
    cy.get(tid('new-order')).click();
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-external')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-ship-fee-5000')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-ship-payout-10000')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-back')).click();
    // Máy kia tạo đơn quán ship +15k (thu CK) ⇒ đơn mới ở máy này theo đơn đó.
    cy.task('sim:shipOrder', { tablet: 'A', mode: 'shop', fee: 15_000, method: 'transfer' });
    cy.get(tid('new-order')).click();
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-shop')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-ship-fee-15000')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-back')).click();

    // Đóng ca: không ai bán tiền mặt ⇒ két = 500.000 tiền lẻ − 10.000 đưa shipper.
    cy.get(tid('open-close-shift')).click();
    cy.get(tid('close-boxes')).type('198');
    cy.get(tid('close-plates')).type('60');
    cy.get(tid('close-cash')).type('490');
    cy.get(tid('close-review')).click();
    cy.get(tid('close-confirm')).click();
    cy.get(tid('shift-closed')).should('be.visible');
    cy.waitLive();
    serverOrders().then((os) => {
      expect(os.map((o) => [o.ship_mode, o.ship_fee, o.ship_payout, o.total, o.payment_method])).to.deep.eq([
        ['external', 5_000, 10_000, 36_000, 'transfer'],
        ['shop', 15_000, 0, 40_000, 'transfer'],
      ]);
      cy.task<{ cash: { expected: number; diff: number }; ship: Record<string, number> }>('db:reconcile', os[0].opened_shift_id).then((r) => {
        expect(r.cash).to.include({ expected: 490_000, diff: 0 });
        expect(r.ship).to.deep.eq({ shop_orders: 1, external_orders: 1, shop_fee: 15_000, external_fee: 5_000, payout: 10_000, external_profit: -5_000 });
      });
    });
    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'đếm 490.000 / kỳ vọng 490.000 → 0').and('contain', 'Ship ngoài: 1 đơn · phụ thu 5.000 · trả 10.000 → −5.000');
  });

  it('C20: điện thoại 360×800, hàng đợi có đơn ship ngoài: badge "Ship ngoài · trả 10k" + tổng không làm scroll ngang', () => {
    cy.viewport(360, 800);
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-external')).click();
    cy.get(tid('order-ship-payout-10000')).click();
    cy.get(tid('order-ship-details')).click();
    cy.get(tid('order-address')).type('12 Lê Lợi');
    cy.get(tid('ship-sheet-done')).click();
    cy.get(tid('order-save')).click();
    cy.get(tid('queue-screen')).should('be.visible');
    cards().should('have.length', 1).and('contain.text', 'Ship ngoài · trả 10k');
    cards().should(($c) => expect($c[0].getBoundingClientRect().right).to.be.at.most(360));
    // Không vùng cuộn nào của hàng đợi rộng hơn màn.
    cy.get(tid('queue-screen')).should(($s) => {
      const scrollers = [...$s[0].querySelectorAll<HTMLElement>('*')].filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX));
      for (const el of scrollers) expect(el.scrollWidth, 'scroll ngang').to.be.at.most(el.clientWidth);
    });
  });
});
