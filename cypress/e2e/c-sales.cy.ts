import { SEED } from '../../tests/support/seed-ids';

// C. Bán hàng (mục 10.4), bước 5.

const tid = (id: string) => `[data-testid=${id}]`;
const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/;

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

    cy.waitSynced();
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

    cy.waitSynced();
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

    cy.waitSynced();
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
    // Giờ giả lùi 11 phút để mọi thao tác (kể cả sau khi tua 10 phút) vẫn ở quá khứ với server.
    // Mở ca cũng theo giờ giả: server không nhận đơn tạo trước giờ mở ca.
    cy.clock(Date.now() - 11 * 60_000, ['Date']);
    cy.openShift('Lan');
    comboOrder('xoiGaTrung', 'một');
    cy.tick(60_000);
    comboOrder('xoiXeoChaRuoc', 'hai');
    cy.tick(60_000);
    comboOrder('xoiGaTrung', 'ba');
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

    cy.waitSynced();
    serverOrders().then((os) => {
      expect(os.map((o) => [o.label, o.status, o.served])).to.deep.eq([
        ['một', 'served', true],
        ['hai', 'open', false],
        ['ba', 'open', false],
      ]);
    });
  });

  it('C15: mã đơn đúng dạng 3 ký tự; số thứ tự trong hàng đợi đánh lại sau khi thanh toán một đơn', () => {
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
    cy.get(tid('cash-quick-50000')).click();
    cy.get(tid('cash-change')).should('have.text', '22.000');
    cy.get(tid('pay-confirm')).click();

    cards().should('have.length', 2);
    cards().then(($c) => {
      expect([...$c].map((c) => c.querySelector('[data-testid^=queue-label-]')?.textContent)).to.deep.eq(['một', 'ba']);
      expect([...$c].map((c) => c.dataset.position)).to.deep.eq(['1', '2']);
    });
    cy.get('[data-testid^=queue-pos-]').then(($p) => expect([...$p].map((p) => p.textContent)).to.deep.eq(['1', '2']));

    cy.waitSynced();
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

      cy.waitSynced();
      serverOrders().then((os) => expect(os[0]).to.include({ id, status: 'paid', payment_method: 'transfer' }));
      // Đã sync ⇒ đơn bị xóa hẳn khỏi IndexedDB của tablet
      cy.window().then(
        (win) =>
          new Cypress.Promise<number>((resolve, reject) => {
            const req = win.indexedDB.open('laodai-pos');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const db = req.result;
              const count = db.transaction('orders').objectStore('orders').count();
              count.onsuccess = () => {
                db.close();
                resolve(count.result);
              };
            };
          }),
      ).should('eq', 0);
    });
  });
});
