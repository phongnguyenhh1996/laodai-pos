import { SEED } from '../../tests/support/seed-ids';

// G. Chủ (mục 10.4). Bước 4: G32, G37; G33–G36 bổ sung ở bước 9.

const tid = (id: string) => `[data-testid=${id}]`;

function openSettings(section: string, rowId: string) {
  cy.get(tid('owner-nav-settings')).click();
  cy.get(tid(`settings-section-${section}`)).click();
  cy.get(tid(`settings-row-${rowId}`)).click();
  cy.get(tid('settings-editor')).should('be.visible');
}

function enterOwnerModeOnTablet() {
  cy.get(tid('open-owner-mode')).click();
  cy.get(tid('owner-password')).type(SEED.owner.password, { log: false });
  cy.get(tid('owner-unlock-submit')).click();
  cy.get(tid('owner-home')).should('be.visible');
}

describe('G. Chủ', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('G32: đổi giá món ⇒ đơn đang mở trên tablet giữ giá cũ, đơn mới dùng giá mới, lịch sử giá có bản ghi mới', () => {
    cy.task<string>('g32:openOrder');

    // Chủ đổi giá trên điện thoại: Xôi gà 25.000 → 28.000
    cy.loginOwner();
    openSettings('products', SEED.products.xoiGa);
    cy.get(tid('price-history-row')).should('not.exist');
    cy.get(tid('field-price')).should('have.value', '25000').clear().type('28k');
    cy.get(tid('field-price-parsed')).should('contain.text', '28.000');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');
    cy.get(tid('field-price')).should('have.value', '28000');
    cy.get(tid('price-history-row'))
      .should('have.length', 1)
      .first()
      .should('contain.text', '25.000')
      .and('contain.text', '28.000');
    // Danh sách món hiện giá mới
    cy.get(tid('owner-back')).click();
    cy.get(tid(`settings-row-${SEED.products.xoiGa}`)).should('contain.text', '28.000');

    // Đơn đang mở giữ giá cũ (kể cả khi sửa số lượng); đơn mới với giá cũ bị server từ chối, giá mới thì nhận
    cy.task('g32:afterPriceChange', 28000).should('deep.equal', {
      openSnap: 25000,
      editOld: 'ok',
      editedTotal: 50000,
      newWithOldPrice: 'rejected',
      newWithNewPrice: 'ok',
    });

    // Tablet đồng bộ danh mục: đơn mới sẽ dùng giá mới (combo cũng tính lại theo giá mới)
    // Kích hoạt tablet A: server còn ca của Lan + 2 đơn đang mở ⇒ tablet lấy lại cả ca lẫn đơn,
    // đơn cũ vẫn giá cũ (2 × 25.000), đơn tạo sau khi đổi giá là giá mới (28.000)
    cy.activateTablet('A');
    cy.get(tid('shift-staff')).should('contain.text', 'Lan');
    cy.get('[data-testid^=queue-total-]').then(($t) => expect([...$t].map((t) => t.textContent)).to.deep.eq(['50.000', '28.000']));
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-product-${SEED.products.xoiGa}-price`)).should('contain.text', '28.000');
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}-price`)).should('contain.text', '34.000');
    cy.get(tid(`menu-product-${SEED.products.xoiXeo}-price`)).should('contain.text', '15.000');
  });

  it('G37: bỏ "Cơm gà" khỏi tablet A ⇒ tab Cơm gà biến mất trên tablet A sau khi đồng bộ', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('be.visible').click();
    cy.get(tid(`menu-product-${SEED.products.comGa}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.xoiB}`)).should('not.exist');

    // Chủ sửa hồ sơ tablet (ngay trên tablet, chế độ chủ)
    cy.get(tid('order-back')).click();
    enterOwnerModeOnTablet();
    openSettings('profiles', SEED.tablets.A);
    cy.get(tid(`field-point_ids-${SEED.points.com}`)).should('be.checked').uncheck();
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');
    cy.get(tid(`field-point_ids-${SEED.points.com}`)).should('not.be.checked');
    cy.task('db:profilePoints', 'A').should('deep.equal', [SEED.points.xoiA]);

    // Về màn bán hàng ⇒ tablet đồng bộ danh mục, tab Cơm gà biến mất
    cy.get(tid('owner-exit')).click();
    cy.get(tid('tablet-home')).should('be.visible');
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('not.exist');
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible').and('have.attr', 'aria-selected', 'true');
    cy.get(tid(`menu-product-${SEED.products.comGa}`)).should('not.exist');

    // Tải lại app vẫn đúng (danh mục đã lưu trên máy)
    cy.reload();
    cy.get(tid('order-screen')).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('not.exist');
  });

  it('G37 (điện thoại): chủ sửa hồ sơ tablet trên điện thoại; hồ sơ phải còn ít nhất một điểm bán', () => {
    cy.loginOwner();
    openSettings('profiles', SEED.tablets.A);
    cy.get(tid(`field-point_ids-${SEED.points.xoiA}`)).uncheck();
    cy.get(tid(`field-point_ids-${SEED.points.com}`)).uncheck();
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-error')).should('contain.text', 'ít nhất một điểm bán');
    cy.get(tid(`field-point_ids-${SEED.points.xoiA}`)).check();
    cy.get(tid('field-default_boxes')).clear().type('180');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');
    cy.task('db:profilePoints', 'A').should('deep.equal', [SEED.points.xoiA]);

    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('not.exist');
  });
});
