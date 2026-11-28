import { SEED } from '../../tests/support/seed-ids';

// M. Cài đặt của chủ qua giao diện (SPEC 7.8): thêm topping / combo / nhân viên, tắt món, báo lỗi nhập sai ngay trên màn;
// tablet nhận danh mục mới. Mẫu in (SPEC 12.5): xem trước đổi theo, lưu, in thử tới quầy, có nhật ký.

const tid = (id: string) => `[data-testid=${id}]`;

/** Id của bản ghi vừa lưu: trang sửa chuyển sang /owner/settings/<loại>/<id>. */
function savedId(entity: string): Cypress.Chainable<string> {
  cy.get(tid('settings-saved')).should('be.visible');
  return cy
    .location('pathname')
    .should('match', new RegExp(`^/owner/settings/${entity}/[0-9a-f-]{36}$`))
    .then((p) => p.split('/').pop()!);
}

function newEntity(entity: string) {
  cy.ownerVisit(`/owner/settings/${entity}`);
  cy.get(tid('settings-new')).click();
  cy.get(tid('settings-editor')).should('be.visible');
}

interface Job {
  kind: string;
  source: string;
  status: string;
  tablet_name: string;
}

describe('M. Cài đặt', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('thêm topping, combo, nhân viên; tắt một món; nhập sai bị chặn ⇒ tablet bán được combo mới với đúng giá, nhân viên mới mở ca được', () => {
    cy.viewport(390, 844);
    cy.activateTablet('B');

    // Topping mới của menu Xôi: Pate thêm 7.000, thêm 1 hộp khi mang về
    newEntity('toppings');
    cy.get(tid('field-menu_id')).select(SEED.menus.xoi);
    cy.get(tid('field-name')).type('Pate thêm');
    cy.get(tid('field-price')).type('7');
    cy.get(tid('field-price')).should('have.value', '7');
    cy.get(tid('field-extra_box_takeaway')).check();
    cy.get(tid('settings-save')).click();
    savedId('toppings').as('topping');

    // Combo: xôi xéo + pate thêm ⇒ giá = tổng thành phần 22.000. Thiếu món chính bị chặn.
    newEntity('combos');
    cy.get(tid('field-menu_id')).select(SEED.menus.xoi);
    cy.get(tid('field-name')).type('Xôi xéo pate');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-error')).should('be.visible');
    cy.get(tid('field-product_id')).select(SEED.products.xoiXeo);
    cy.get<string>('@topping').then((t) => cy.get(tid(`field-topping_ids-${t}`)).check());
    cy.get(tid('settings-preview')).should('contain.text', '22.000');
    cy.get(tid('settings-save')).click();
    savedId('combos').as('combo');
    cy.get(tid('owner-back')).click();
    cy.contains('[data-testid^=settings-row-]', 'Xôi xéo pate').should('contain.text', '22.000');

    // Nhân viên mới: SĐT sai bị chặn, sửa lại thì lưu được
    newEntity('staff');
    cy.get(tid('field-name')).type('Tuấn');
    cy.get(tid('field-phone')).type('0901 234');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-error')).should('contain.text', 'Số điện thoại');
    cy.get(tid('field-phone')).clear().type('0901 234 567');
    cy.get(tid('settings-save')).click();
    savedId('staff').as('staff');
    cy.get(tid('field-phone')).should('have.value', '0901 234 567');

    // Tạm ngưng bán Xôi pate
    cy.ownerVisit(`/owner/settings/products/${SEED.products.xoiPate}`);
    cy.get(tid('field-active')).should('be.checked').uncheck();
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');

    // Tablet A nhận danh mục mới
    cy.viewport(1280, 800);
    cy.activateTablet('A');
    cy.get<string>('@staff').then((s) => cy.get(tid(`staff-${s}`)).should('contain.text', 'Tuấn').click());
    cy.get(tid('open-shift')).click();
    cy.get(tid('shift-staff')).should('contain.text', 'Tuấn');
    cy.newOrder();
    cy.get(tid(`menu-product-${SEED.products.xoiPate}`)).should('not.exist');
    cy.get<string>('@combo').then((cb) => {
      cy.get(tid(`menu-combo-${cb}-price`)).should('contain.text', '22.000');
      cy.get(tid(`menu-combo-${cb}`)).click();
    });
    cy.get(tid(`menu-product-${SEED.products.xoiXeo}`)).click();
    cy.get<string>('@topping').then((t) => cy.get(tid(`topping-option-${t}`)).should('contain.text', '+7.000'));
    cy.get(tid('topping-cancel')).click();
    cy.get(tid('order-pay-exact')).click();
    cy.get(tid('toast')).should('be.visible');
    cy.waitLive();
    cy.task<Array<{ total: number; status: string; items: Array<{ product_id: string; toppings: Array<{ name: string }> }> }>>('db:orders', 'A').then(([o]) => {
      expect(o).to.include({ total: 22_000, status: 'paid' });
      expect(o.items).to.have.length(1);
      expect(o.items[0].product_id).to.eq(SEED.products.xoiXeo);
      expect(JSON.stringify(o.items[0].toppings)).to.contain('Pate thêm');
    });
  });

  it('mẫu in: bỏ dòng / đổi chữ ⇒ xem trước đổi ngay; lưu; in thử tới Tablet A; tải lại vẫn giữ; nhật ký "In"', () => {
    cy.activateTablet('A');
    cy.window().then((w) => w.localStorage.setItem('laodai-fake-printer', '1'));
    cy.reload();
    cy.openShift('Lan');
    cy.get(tid('printer-status')).should('have.attr', 'data-state', 'connected');

    cy.ownerVisit('/owner/settings/print-template');
    cy.get(tid('tpl-preview-bill')).should('have.attr', 'data-text').and('contain', 'Không có bill = miễn phí');
    cy.get(tid('print-template-save')).should('be.disabled'); // chưa đổi gì

    cy.get(tid('tpl-bill-no_bill_free')).should('be.checked').uncheck();
    cy.get(tid('tpl-preview-bill')).should('have.attr', 'data-text').and('not.contain', 'Không có bill = miễn phí');
    cy.get(tid('tpl-kitchen-time')).uncheck();
    cy.get(tid('tpl-shop-name')).clear().type('Xôi Lão Đại 2');
    cy.get(tid('tpl-footer-0')).clear().type('Wifi: laodai123');
    cy.get(tid('tpl-preview-bill')).should('have.attr', 'data-text').and('contain', 'Xôi Lão Đại 2').and('contain', 'Wifi: laodai123');

    cy.get(tid('print-template-save')).click();
    cy.get(tid('print-template-flash')).should('contain.text', 'Đã lưu mẫu in');
    cy.get(tid('print-template-save')).should('be.disabled');

    // In thử từ màn mẫu in, gửi tới quầy A: máy in (giả) của tablet A nhận lệnh
    cy.get(tid('tpl-test-print-target')).select(SEED.tablets.A);
    cy.get(tid('tpl-test-print-send')).click();
    cy.get(tid('tpl-test-print-status'), { timeout: 20_000 }).should('have.attr', 'data-status', 'printed');
    cy.task<Job[]>('print:jobs').then((js) => {
      expect(js.map((j) => `${j.kind}:${j.source}:${j.status}:${j.tablet_name}`)).to.deep.eq(['test:owner:printed:Tablet A']);
    });

    // Tải lại: mẫu đã lưu trên server
    cy.ownerReload();
    cy.get(tid('tpl-shop-name')).should('have.value', 'Xôi Lão Đại 2');
    cy.get(tid('tpl-footer-0')).should('have.value', 'Wifi: laodai123');
    cy.get(tid('tpl-bill-no_bill_free')).should('not.be.checked');
    cy.get(tid('tpl-kitchen-time')).should('not.be.checked');

    // Nhật ký nhóm "In": có lần đổi mẫu + lệnh in thử
    cy.ownerVisit('/owner/log?type=print');
    cy.get('[data-testid=log-row][data-action=print_template_update]').should('have.length', 1);
    cy.get('[data-testid=log-row][data-action=print_printed]').should('have.length.at.least', 1);
  });
});
