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
const cards = (group?: 'serve' | 'pay') => cy.get(`[data-testid^=queue-card-]${group ? `[data-group=${group}]` : ''}`);

/** Đơn chỉ có một combo, lưu vào hàng đợi (giỏ về đơn mới trống). */
function comboOrder(combo: keyof typeof SEED.combos, label?: string) {
  cy.newOrder();
  cy.get(tid(`menu-combo-${SEED.combos[combo]}`)).click();
  if (label) {
    // Điện thoại: ô nhãn nằm trong giỏ thu gọn ⇒ mở giỏ trước.
    cy.get(tid('cart-toggle')).then(($t) => {
      if ($t.is(':visible') && $t.attr('aria-expanded') === 'false') cy.wrap($t).click();
    });
    cy.get(tid('order-label')).type(label);
  }
  cy.get(tid('order-save')).click();
  cy.newOrder();
}

/** Id đơn của thẻ đầu tiên trong dải đơn. */
const firstCardId = () =>
  cards()
    .first()
    .invoke('attr', 'data-testid')
    .then((t) => String(t).replace('queue-card-', ''));

const VIEWPORTS = [
  { name: 'tablet 1280×800', w: 1280, h: 800 },
  { name: 'điện thoại 390×844', w: 390, h: 844 },
] as const;

describe('C. Bán hàng', () => {
  beforeEach(() => {
    cy.resetAll();
    cy.activateTablet('A');
  });

  for (const vp of VIEWPORTS) {
    it(`C10 (${vp.name}): combo 1 chạm rồi "Thu đủ tiền mặt": 2 chạm (≤ 3) từ màn Bán hàng đến lúc xong đơn`, () => {
      cy.viewport(vp.w, vp.h);
      cy.openShift('Lan');
      cy.newOrder(); // màn Bán hàng: giỏ sẵn là đơn mới, không cần chạm
      cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click(); // 1
      cy.get(tid('order-pay-exact')).should('contain.text', '31.000').click(); // 2
      cy.get(tid('toast')).should('contain.text', '31.000');
      cy.get('[data-testid^=queue-card-]').should('not.exist');
      cy.newOrder();

      cy.waitLive();
      serverOrders().then((os) => {
        expect(os).to.have.length(1);
        expect(os[0]).to.include({ status: 'paid', payment_method: 'cash', total: 31_000, cash_given: 31_000, point_id: SEED.points.xoiA });
        expect(os[0].items).to.have.length(1);
        expect(os[0].items[0]).to.include({ product_id: SEED.products.xoiGa, qty: 1, unit_price_snap: 25_000 });
        expect(os[0].items[0].toppings.map((t) => t.id)).to.deep.eq([SEED.toppings.trung]);
      });
    });
  }

  it('C11: món + 2 topping, mang về: tổng tiền đúng; Tại chỗ / Mang về mặc định đúng theo điểm bán', () => {
    cy.openShift('Lan');
    cy.newOrder();
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('have.attr', 'aria-selected', 'true');
    cy.get(tid('order-dine-takeaway')).should('have.attr', 'aria-pressed', 'true'); // Xôi = Mang về
    cy.get(tid(`menu-product-${SEED.products.xoiXeo}`)).click();
    cy.get(tid(`topping-option-${SEED.toppings.cha}`)).click();
    cy.get(tid(`topping-option-${SEED.toppings.ruoc}`)).click();
    cy.get(tid('topping-add')).should('contain.text', '28.000').click(); // 15.000 + 8.000 + 5.000
    cy.get(tid('order-total')).should('have.text', '28.000');

    cy.get(tid(`point-tab-${SEED.points.com}`)).should('be.disabled'); // đơn xôi không chuyển sang menu cơm
    cy.get(tid('order-save')).click();

    cy.newOrder();
    cy.get(tid(`point-tab-${SEED.points.com}`)).click();
    cy.get(tid('order-dine-dinein')).should('have.attr', 'aria-pressed', 'true'); // Cơm gà = Tại chỗ

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
    cy.newOrder();
    cy.get(tid(`point-tab-${SEED.points.com}`)).click();
    cy.get(tid(`menu-combo-${SEED.combos.comGaCanh}`)).click();
    cy.get(tid('order-save')).click();
    // Đơn kế tiếp mở đúng tab đang bán (Cơm gà); quay lại Xôi
    cy.newOrder();
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
    cy.newOrder();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    // Thực đơn + giỏ: ô nhập duy nhất là nhãn / số bàn
    cy.get(`${tid('order-screen')} input, ${tid('order-screen')} textarea, ${tid('order-screen')} [contenteditable]`)
      .should('have.length', 1)
      .first()
      .should('have.attr', 'data-testid', 'order-label');
    cy.get('[data-testid*=price-input], [data-testid*=discount]').should('not.exist');
    cy.get(tid('order-pay-cash')).click();
    // Thanh toán trong giỏ: ô nhập duy nhất là "khách đưa"
    cy.get(`${tid('cart-pay')} input, ${tid('cart-pay')} textarea`).should('have.length', 1).first().should('have.attr', 'data-testid', 'cash-manual');
    cy.get(tid('pay-method-transfer')).click();
    cy.get(`${tid('cart-pay')} input`).should('not.exist');
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
    cards('serve').first().find('[data-testid^=queue-wait-]').should('have.text', '2′');
    cy.then(() => cy.clock(Date.now(), ['Date'])); // giờ lúc lệnh chạy (không phải lúc xếp lệnh)
    // (giờ = t0 + 2 phút)
    cards('serve').should('have.length', 3);
    cards('serve').then(($c) => {
      expect([...$c].map((c) => c.querySelector('[data-testid^=queue-label-]')?.textContent)).to.deep.eq(['một', 'hai', 'ba']);
      expect([...$c].map((c) => c.dataset.color)).to.deep.eq(['normal', 'normal', 'normal']);
    });

    cy.tick(3 * 60_000); // t0 + 5: đơn "một" chờ 5 phút
    cards('serve').should(($c) => expect([...$c].map((c) => c.dataset.color)).to.deep.eq(['yellow', 'normal', 'normal']));
    cy.tick(5 * 60_000); // t0 + 10
    cards('serve').should(($c) => expect([...$c].map((c) => c.dataset.color)).to.deep.eq(['red', 'yellow', 'yellow']));
    cards('serve').first().find('[data-testid^=queue-wait-]').should('have.text', '10′');

    // Chọn đơn "một", Đã ra món trong giỏ ⇒ xuống nhóm Chờ thanh toán (sau các đơn chờ ra món), hết màu chờ; giỏ về đơn mới
    cards('serve').first().click().should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-serve')).click();
    cy.newOrder();
    cards('serve').should('have.length', 2);
    cards('pay').should('have.length', 1).first().should('have.attr', 'data-color', 'none').find('[data-testid^=queue-label-]').should('have.text', 'một');
    cards().should(($c) => expect([...$c].map((c) => c.dataset.group)).to.deep.eq(['serve', 'serve', 'pay']));

    // Chip lọc kèm số đếm: mỗi chip chỉ hiện nhóm của nó, mỗi nhóm cũ nhất trước
    cy.get(tid('queue-count-all')).should('have.text', '3');
    cy.get(tid('queue-count-serve')).should('have.text', '2');
    cy.get(tid('queue-count-pay')).should('have.text', '1');
    cy.get(tid('queue-filter-serve')).click();
    cards().should(($c) => expect([...$c].map((c) => c.querySelector('[data-testid^=queue-label-]')?.textContent)).to.deep.eq(['hai', 'ba']));
    cy.get(tid('queue-filter-pay')).click();
    cards().should(($c) => expect([...$c].map((c) => c.querySelector('[data-testid^=queue-label-]')?.textContent)).to.deep.eq(['một']));
    cy.get(tid('queue-filter-all')).click();
    cards().should('have.length', 3);
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

  it('C15: mã đơn đúng dạng 1 chữ + 2 số, không trùng; thẻ không có số thứ tự; thanh toán TM trong giỏ ⇒ thẻ rời dải, các thẻ khác giữ thứ tự', () => {
    cy.openShift('Lan');
    comboOrder('xoiGaTrung', 'một');
    comboOrder('xoiXeoChaRuoc', 'hai');
    comboOrder('xoiGaTrung', 'ba');
    cards().should('have.length', 3);
    cy.get('[data-testid^=queue-code-]').each(($c) => expect($c.text()).to.match(CODE));
    cy.get('[data-testid^=queue-code-]').then(($c) => expect(new Set([...$c].map((c) => c.textContent)).size).to.eq(3));
    cy.get('[data-testid^=queue-pos-]').should('not.exist'); // bỏ số thứ tự hàng đợi: mã đơn đủ để gọi khách

    // Thanh toán đơn "hai"
    cards().eq(1).click();
    cy.get(tid('order-code')).invoke('text').should('match', CODE);
    cy.get(tid('order-pay-cash')).click();
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
    });
    cy.newOrder();

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
      cy.get(tid(`queue-card-${id}`)).click();
      cy.get(tid('order-pay-transfer')).click();
      cy.get(tid('pay-transfer-confirm')).click();
      cy.get(tid('queue-empty')).should('be.visible');
      cy.get(tid(`queue-card-${id}`)).should('not.exist');

      // Vào thẳng đường dẫn của đơn đã thanh toán (cũ và mới): chỉ về màn Bán hàng với đơn mới trống
      for (const path of [`/order/${id}`, `/order/${id}/pay`, `/?order=${id}`]) {
        cy.visit(path);
        cy.location('pathname').should('eq', '/');
        cy.location('search').should('eq', '');
        cy.get(tid('queue-screen')).should('be.visible');
        cy.newOrder();
        cy.get(tid('cart-pay')).should('not.exist');
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
    cy.newOrder();
    for (const p of [P.xoiGa, P.xoiGa, P.xoiXeo]) {
      cy.get(tid(`menu-product-${p}`)).click();
      cy.get(tid('topping-add')).click();
    }
    cy.get(tid('order-total')).should('have.text', '65.000'); // 2 × 25.000 + 15.000
    cy.get(tid('order-save')).click();
    cy.newOrder();
    cy.get('[data-testid^=queue-card-]').click();

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
    cy.get(tid('order-deselect')).click();
    cy.newOrder();

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

  it('C18: điện thoại 390×844, đơn ship có phí: bấm Ship không bật bàn phím; phí cộng vào tổng; bảng địa chỉ; TM · CK · Ghi nợ một hàng', () => {
    cy.viewport(390, 844);
    cy.openShift('Lan');
    cy.newOrder();
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

    // Hàng TM · CK · Ghi nợ nằm trên một hàng; Đã ra món + Tạo đơn một hàng; chữ không bị cắt.
    for (const row of [
      ['order-pay-cash', 'order-pay-transfer', 'order-pay-debt'],
      ['order-serve', 'order-save'],
    ]) {
      cy.get(tid(row[0])).then(($first) => {
        const top = $first[0].getBoundingClientRect().top;
        for (const id of row) {
          cy.get(tid(id)).should(($b) => {
            expect(Math.abs($b[0].getBoundingClientRect().top - top), id).to.be.lessThan(2);
            expect($b[0].scrollWidth, id).to.be.at.most($b[0].clientWidth);
            expect($b[0].getBoundingClientRect().right, id).to.be.at.most(390);
          });
        }
      });
    }

    cy.get(tid('order-ship-details')).click();
    cy.get(tid('ship-sheet-summary')).should('contain.text', '+15.000').and('contain.text', '46.000');
    cy.get(tid('ship-sheet-done')).should('be.disabled');
    cy.get(tid('ship-customer-search')).should('be.focused');
    cy.get(tid('order-address')).type('12 Lê Lợi');
    cy.get(tid('ship-sheet-done')).click();
    cy.get(tid('order-ship-summary')).should('contain.text', '12 Lê Lợi');

    cy.get(tid('order-save')).click();
    cy.newOrder();
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
    cy.newOrder();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click(); // 31.000
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-shop')).should('have.attr', 'aria-pressed', 'true'); // đầu ca
    cy.get(tid('order-address')).type('12 Lê Lợi');
    cy.get(tid('order-ship-mode-external')).click();
    cy.get(tid('order-ship-fee-title')).should('have.text', 'Phụ thu');
    cy.get(tid('order-payout-missing')).should('be.visible');
    cy.get(tid('order-pay-cash')).should('be.disabled');
    cy.get(tid('order-ship-fee-5000')).click();
    cy.get(tid('order-ship-payout-10000')).click();
    cy.get(tid('order-total')).should('have.text', '36.000'); // không cộng 10.000 trả shipper
    cy.get(tid('order-pay-cash')).should('not.be.disabled').click();
    cy.get(tid('pay-total')).should('have.text', '36.000');
    cy.get(tid('pay-ship-payout')).should('have.text', 'Trả shipper −10.000 (lấy từ két)');
    cy.get(tid('pay-method-transfer')).click();
    cy.get(tid('pay-transfer-confirm')).click();
    cy.get(tid('toast')).should('contain.text', 'chuyển khoản');
    cy.telegramWaitFor('Shipper ngoài · phụ thu 5.000 · trả shipper 10.000');

    // Máy thứ hai của cùng quầy hỏi server ⇒ cùng mặc định (đơn đã thanh toán vẫn tính).
    cy.task('sim:shipDefaults', 'A').should('deep.equal', { ship_mode: 'external', ship_fee: 5000, ship_payout: 10000 });
    cy.newOrder();
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-external')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-ship-fee-5000')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-ship-payout-10000')).should('have.attr', 'aria-pressed', 'true');
    // Máy kia tạo đơn quán ship +15k (thu CK) ⇒ đơn mới ở máy này theo đơn đó (mặc định lấy khi mở giỏ mới: tải lại).
    cy.task('sim:shipOrder', { tablet: 'A', mode: 'shop', fee: 15_000, method: 'transfer' });
    cy.reload();
    cy.get(tid('queue-screen')).should('be.visible');
    cy.newOrder();
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-shop')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('order-ship-fee-15000')).should('have.attr', 'aria-pressed', 'true');

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
    cy.newOrder();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    cy.get(tid('order-dine-delivery')).click();
    cy.get(tid('order-ship-mode-external')).click();
    cy.get(tid('order-ship-payout-10000')).click();
    cy.get(tid('order-ship-details')).click();
    cy.get(tid('order-address')).type('12 Lê Lợi');
    cy.get(tid('ship-sheet-done')).click();
    cy.get(tid('order-save')).click();
    cy.newOrder();
    cards().should('have.length', 1).and('contain.text', 'Ship ngoài · trả 10k');
    cards().should(($c) => expect($c[0].getBoundingClientRect().right).to.be.at.most(360));
    // Dải thẻ (cuộn ngang theo thiết kế) không rộng hơn màn khi chỉ có một thẻ; cả trang không cuộn ngang.
    cy.get(tid('queue-cards')).should(($r) => expect($r[0].scrollWidth, 'dải thẻ').to.be.at.most($r[0].clientWidth));
    cy.document().should((doc) => expect(doc.documentElement.scrollWidth, 'trang').to.be.at.most(360));
  });

  for (const vp of VIEWPORTS) {
    it(`C21 (${vp.name}): bấm thẻ ⇒ sửa đơn đó trong giỏ (tự lưu); bỏ chọn bằng bấm lại thẻ, vùng trống của dải, nút ✕; sửa trong giỏ không bỏ chọn`, () => {
      cy.viewport(vp.w, vp.h);
      cy.openShift('Lan');
      comboOrder('xoiGaTrung', 'một');
      firstCardId().then((id) => {
        const card = () => cy.get(tid(`queue-card-${id}`));
        serverOrders().then(([o]) => {
          card().click().should('have.attr', 'aria-pressed', 'true');
          cy.location('search').should('eq', `?order=${id}`);
          cy.get(tid('order-code')).should('have.text', o.code);
          if (vp.w < 768) cy.get(tid('cart-toggle')).should('have.attr', 'aria-expanded', 'true'); // điện thoại: giỏ tự mở rộng

          // Sửa trong giỏ: vẫn đang chọn, tự lưu
          cy.get('[data-testid^=cart-line-][data-testid$=-plus]').click();
          cy.get(tid('order-total')).should('have.text', '62.000');
          card().should('have.attr', 'aria-pressed', 'true');
          cy.get(tid('order-autosave')).should('have.attr', 'data-state', 'saved');
          card().find('[data-testid^=queue-total-]').should('have.text', '62k');

          // Bấm lại thẻ ⇒ bỏ chọn
          card().click().should('have.attr', 'aria-pressed', 'false');
          cy.newOrder();
          cy.location('search').should('eq', '');

          // Vùng trống của dải (góc dưới bên phải, sau các thẻ) ⇒ bỏ chọn; bấm chip chỉ lọc
          card().click().should('have.attr', 'aria-pressed', 'true');
          cy.get(tid('queue-filter-serve')).click();
          card().should('have.attr', 'aria-pressed', 'true');
          cy.get(tid('queue-filter-all')).click();
          cy.get(tid('queue-screen')).click('bottomRight');
          card().should('have.attr', 'aria-pressed', 'false');
          cy.newOrder();

          // Nút ✕ đầu giỏ ⇒ bỏ chọn
          card().click();
          cy.get(tid('order-deselect')).click();
          card().should('have.attr', 'aria-pressed', 'false');
          cy.newOrder();

          cy.waitLive();
          serverOrders().then((os) => {
            expect(os).to.have.length(1);
            expect(os[0]).to.include({ id, status: 'open', total: 62_000 });
            expect(os[0].items.map((i) => i.qty)).to.deep.eq([2]);
          });
        });
      });
    });

    it(`C22 (${vp.name}): đơn mới chưa lưu có món, bấm thẻ ⇒ "Bỏ thay đổi?"; đơn đã lưu đổi sang thẻ khác ⇒ tự lưu, không hỏi`, () => {
      cy.viewport(vp.w, vp.h);
      cy.openShift('Lan');
      comboOrder('xoiGaTrung', 'một');
      comboOrder('xoiXeoChaRuoc', 'hai');
      cy.get('[data-testid^=queue-label-]').then(($l) => expect([...$l].map((l) => l.textContent)).to.deep.eq(['một', 'hai']));
      cards().then(($c) => {
        const [one, two] = [...$c].map((c) => c.dataset.testid!.replace('queue-card-', ''));

        // Đơn mới có món ⇒ hỏi; "Không" giữ nguyên giỏ
        cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
        cy.get(tid(`queue-card-${one}`)).click();
        cy.get(tid('discard-sheet')).should('be.visible').and('contain.text', 'Bỏ thay đổi?');
        cy.get(tid('discard-no')).click();
        cy.get(tid('discard-sheet')).should('not.exist');
        cy.get(tid('order-code')).should('have.text', 'Đơn mới');
        cy.get(tid('order-total')).should('have.text', '31.000');
        cy.get(tid(`queue-card-${one}`)).should('have.attr', 'aria-pressed', 'false');

        // "Bỏ thay đổi" ⇒ sang đơn đó, đơn mới không để lại gì
        cy.get(tid(`queue-card-${one}`)).click();
        cy.get(tid('discard-yes')).click();
        cy.get(tid(`queue-card-${one}`)).should('have.attr', 'aria-pressed', 'true');
        cy.get(tid('order-total')).should('have.text', '31.000');

        // Đơn đã lưu: sửa rồi bấm sang thẻ khác ⇒ tự lưu, chuyển thẳng, không hỏi
        cy.get('[data-testid^=cart-line-][data-testid$=-plus]').click();
        cy.get(tid('order-total')).should('have.text', '62.000');
        cy.get(tid(`queue-card-${two}`)).click();
        cy.get(tid('discard-sheet')).should('not.exist');
        cy.get(tid(`queue-card-${two}`)).should('have.attr', 'aria-pressed', 'true');
        cy.get(tid(`queue-card-${one}`)).should('have.attr', 'aria-pressed', 'false');
        cy.get(tid('order-total')).should('have.text', '28.000');

        cy.waitLive();
        serverOrders().then((os) => {
          expect(os.map((o) => [o.id, o.total])).to.deep.eq([
            [one, 62_000],
            [two, 28_000],
          ]);
        });
      });
    });

    it(`C23 (${vp.name}): thanh toán ngay trong giỏ: TM (mệnh giá + tiền thối), CK, Ghi nợ (bảng đè lên giỏ); không còn màn thanh toán riêng`, () => {
      cy.viewport(vp.w, vp.h);
      cy.openShift('Lan');
      comboOrder('xoiGaTrung', 'tm');
      comboOrder('xoiGaTrung', 'ck');
      comboOrder('xoiGaTrung', 'nợ');
      cards().should('have.length', 3);

      // TM
      cards().first().click();
      cy.get(tid('order-pay-cash')).click();
      cy.get(tid('cart-pay')).should('be.visible');
      cy.location('pathname').should('eq', '/');
      cy.get(tid('pay-total')).should('have.text', '31.000');
      cy.get(tid('cash-quick-50000')).click();
      cy.get(tid('cash-change')).should('have.text', '19.000');
      cy.get(tid('pay-confirm')).click();
      cy.get(tid('toast')).should('contain.text', '31.000');
      cy.newOrder();
      cards().should('have.length', 2);

      // CK
      cards().first().click();
      cy.get(tid('order-pay-transfer')).click();
      cy.get(tid('pay-transfer-confirm')).click();
      cy.get(tid('toast')).should('contain.text', 'chuyển khoản');
      cy.newOrder();
      cards().should('have.length', 1);

      // Ghi nợ: bảng đè lên giỏ
      cards().first().click();
      cy.get(tid('order-pay-debt')).click();
      cy.get(tid('pay-debt')).should('be.visible');
      cy.get(tid('debt-name')).type('Tú');
      cy.get(tid('pay-debt-confirm')).click();
      cy.get(tid('toast')).should('contain.text', 'Đã ghi nợ 31.000 – Tú');
      cy.newOrder();
      cy.get(tid('queue-empty')).should('be.visible');

      cy.waitLive();
      serverOrders().then((os) => {
        expect(os.map((o) => [o.label, o.status, o.payment_method, o.cash_given])).to.deep.eq([
          ['tm', 'paid', 'cash', 50_000],
          ['ck', 'paid', 'transfer', null],
          ['nợ', 'paid', 'debt', null],
        ]);
      });
    });
  }
});
