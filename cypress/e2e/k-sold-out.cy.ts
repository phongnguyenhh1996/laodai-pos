import { SEED } from '../../tests/support/seed-ids';

// K. Hết món (SPEC 4.8), chạy thật với Supabase: báo hết theo điểm bán, khóa món / topping / combo trên giao diện,
// máy khác cùng quầy báo hết thì máy này thấy ngay (live_pulse), nhật ký "Hết món", không báo Telegram.

const tid = (id: string) => `[data-testid=${id}]`;
const P = SEED.products;
const T = SEED.toppings;
const C = SEED.combos;
const xoiA = SEED.points.xoiA;

describe('K. Hết món', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('báo hết món + topping ở Xôi A ⇒ khóa món, topping, combo; máy khác báo hết ⇒ thấy ngay; bán lại; nhật ký có, Telegram không', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.waitLive();
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${xoiA}`)).should('have.attr', 'aria-selected', 'true');

    // Chế độ đánh dấu: bấm món / topping = báo hết, không thêm vào giỏ
    cy.get(tid('soldout-toggle')).click();
    cy.get(tid('soldout-banner')).should('contain.text', 'Xôi A');
    cy.get(tid(`menu-product-${P.xoiGa}`)).click();
    cy.get(tid(`menu-product-${P.xoiGa}`)).should('have.attr', 'data-sold-out', 'true');
    cy.get(tid(`menu-topping-${T.trung}`)).click();
    cy.get(tid(`menu-topping-${T.trung}`)).should('have.attr', 'data-sold-out', 'true');
    cy.get(tid('topping-sheet')).should('not.exist');
    cy.get(tid('soldout-toggle')).click(); // Xong
    cy.get(tid('soldout-banner')).should('not.exist');

    // Món hết: không bấm được, nhãn "Hết"; combo có món / topping hết bị khóa; combo khác vẫn bán
    cy.get(tid(`menu-product-${P.xoiGa}`)).should('be.disabled');
    cy.get(tid(`menu-product-${P.xoiGa}-soldout`)).should('have.text', 'Hết');
    cy.get(tid(`menu-combo-${C.xoiGaTrung}`)).should('be.disabled');
    cy.get(tid(`menu-combo-${C.xoiXeoChaRuoc}`)).should('be.enabled');
    cy.get(tid(`menu-product-${P.xoiXeo}`)).click();
    cy.get(tid(`topping-option-${T.trung}`)).should('be.disabled').and('contain.text', 'Hết');
    cy.get(tid(`topping-option-${T.cha}`)).should('be.enabled');
    cy.get(tid('topping-cancel')).click();

    // Server ghi theo điểm bán: quầy B (Xôi B, cùng menu) vẫn bán
    cy.task('db:soldOutToday', 'A').should('deep.equal', [`${xoiA}:product:${P.xoiGa}`, `${xoiA}:topping:${T.trung}`].sort());
    cy.task('db:soldOutToday', 'B').should('deep.equal', []);

    // Máy khác cùng quầy báo hết xôi xéo ⇒ máy này khóa ngay, không cần tải lại
    cy.task('sim:soldOut', { tablet: 'A', point: 'xoiA', kind: 'product', item: 'xoiXeo', soldOut: true });
    cy.get(tid(`menu-product-${P.xoiXeo}`), { timeout: 10_000 }).should('be.disabled');
    cy.get(tid(`menu-combo-${C.xoiXeoChaRuoc}`)).should('be.disabled');

    // Tab Cơm gà không bị ảnh hưởng
    cy.get(tid(`point-tab-${SEED.points.com}`)).click();
    cy.get(tid(`menu-product-${P.comGa}`)).should('be.enabled').and('not.have.attr', 'data-sold-out');
    cy.get(tid(`point-tab-${xoiA}`)).click();

    // Bán lại xôi gà: món mở lại, combo xôi gà + trứng vẫn khóa vì trứng còn hết
    cy.get(tid('soldout-toggle')).click();
    cy.get(tid(`menu-product-${P.xoiGa}`)).click();
    cy.get(tid(`menu-product-${P.xoiGa}`)).should('not.have.attr', 'data-sold-out');
    cy.get(tid('soldout-toggle')).click();
    cy.get(tid(`menu-product-${P.xoiGa}`)).should('be.enabled');
    cy.get(tid(`menu-combo-${C.xoiGaTrung}`)).should('be.disabled');
    cy.task('db:soldOutToday', 'A').should('deep.equal', [`${xoiA}:product:${P.xoiXeo}`, `${xoiA}:topping:${T.trung}`].sort());

    // Tải lại app: vẫn đúng (đọc lại từ server)
    cy.reload();
    cy.get(tid('order-screen')).should('be.visible');
    cy.get(tid(`menu-product-${P.xoiXeo}`)).should('be.disabled');
    cy.get(tid(`menu-product-${P.xoiGa}`)).should('be.enabled');

    // Nhật ký lọc "Hết món": 3 lần báo hết + 1 lần bán lại, đều của Lan – Tablet A
    cy.ownerVisit('/owner/log?type=sold_out');
    cy.get(tid('log-row')).should('have.length', 4).then(($r) => {
      const actions = [...$r].map((r) => r.dataset.action);
      expect(actions.filter((a) => a === 'sold_out_set')).to.have.length(3);
      expect(actions.filter((a) => a === 'sold_out_clear')).to.have.length(1);
      expect([...$r.find(tid('log-row-actor'))].map((a) => a.textContent)).to.deep.eq(Array(4).fill('Lan – Tablet A'));
    });

    // Không báo Telegram
    cy.telegramMessages().then((msgs) => expect(msgs.map((m) => m.text).join('\n')).not.to.match(/Hết|hết món|bán lại/));
  });
});
