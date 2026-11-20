/// <reference types="cypress" />
import { SEED } from '../../tests/support/seed-ids';

// Lệnh tùy biến theo mục 10.4.

type TabletKey = keyof typeof SEED.tablets;
type StaffKey = keyof typeof SEED.staff;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      resetAll(): Chainable<null>;
      telegramMessages(): Chainable<Array<{ chat_id: string; text: string; at: string }>>;
      /** Chờ tin Telegram chứa `text` (tối đa 15 giây). */
      telegramWaitFor(text: string): Chainable<{ chat_id: string; text: string; at: string }>;
      /** Mở trang như trên một máy mới tinh: không dữ liệu kích hoạt, không phiên đăng nhập. */
      visitFresh(path: string): Chainable<Cypress.AUTWindow>;
      /** Kích hoạt máy hiện tại thành tablet A/B qua giao diện (chủ đăng nhập → chọn quầy). */
      activateTablet(tablet: TabletKey): Chainable<null>;
      /**
       * Chủ dùng điện thoại: cùng luồng như mọi máy (viewport 390×844, máy mới) ⇒ đăng nhập, chọn quầy B,
       * rồi vào chế độ chủ bằng mật khẩu.
       */
      loginOwner(): Chainable<null>;
      /** Mở trang chủ `path`: chế độ chủ là phiên tạm nên mỗi lần tải trang phải nhập lại mật khẩu. */
      ownerVisit(path: string): Chainable<null>;
      /** Mở mục chế độ chủ `owner-nav-<key>`; trên điện thoại các mục ngoài thanh tab nằm trong màn "Thêm". */
      ownerNav(key: string): Chainable<null>;
      /** Tải lại trang đang ở chế độ chủ rồi nhập lại mật khẩu. */
      ownerReload(): Chainable<null>;
      /** Token phiên chính đang lưu trên máy (tablet: phiên vai trò `tablet`). */
      storedAccessToken(): Chainable<string>;
      /** Trên màn mở ca của tablet: chọn tên → Mở ca ⇒ hàng đợi. */
      openShift(staff: StaffKey): Chainable<null>;
      /** Tablet đang kết nối realtime với server (chỉ báo "Đã kết nối"). Mọi thao tác đã hiện trên màn đều đã nằm trên server. */
      waitLive(): Chainable<null>;
    }
  }
}

Cypress.Commands.add('resetAll', () => {
  cy.task('db:reset');
  return cy.task('telegram:clear');
});

Cypress.Commands.add('telegramMessages', () => cy.task('telegram:messages'));

Cypress.Commands.add('telegramWaitFor', (text: string) => cy.task('telegram:waitFor', text, { timeout: 30_000 }));

Cypress.Commands.add('visitFresh', (path: string) =>
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.clear();
      win.indexedDB.deleteDatabase('laodai-pos'); // dữ liệu của bản offline cũ (nếu có)
    },
  }),
);

Cypress.Commands.add('activateTablet', (tablet: TabletKey) => {
  cy.visitFresh('/activate');
  cy.get('[data-testid=activate-email]').type(SEED.owner.email);
  cy.get('[data-testid=activate-password]').type(SEED.owner.password, { log: false });
  cy.get('[data-testid=activate-login]').click();
  cy.get(`[data-testid=activate-profile-${SEED.tablets[tablet]}]`).click();
  cy.get('[data-testid=tablet-home]').should('be.visible');
  cy.location('pathname').should('eq', '/');
  return cy.wrap(null, { log: false });
});

function unlockOwnerMode() {
  cy.get('[data-testid=owner-unlock]').should('be.visible');
  cy.get('[data-testid=owner-password]').type(SEED.owner.password, { log: false });
  cy.get('[data-testid=owner-unlock-submit]').click();
  cy.get('[data-testid=owner-pin-later]').click(); // máy chưa có PIN ⇒ hỏi cài PIN: để sau
  cy.get('[data-testid=owner-unlock]').should('not.exist');
  return cy.wrap(null, { log: false });
}

Cypress.Commands.add('ownerVisit', (path: string) => {
  cy.visit(path);
  return unlockOwnerMode();
});

Cypress.Commands.add('ownerReload', () => {
  cy.reload();
  return unlockOwnerMode();
});

Cypress.Commands.add('ownerNav', (key: string) => {
  cy.get('body').then(($b) => {
    if ($b.find(`[data-testid=owner-nav-${key}]`).length === 0) cy.get('[data-testid=owner-nav-more]').click();
  });
  cy.get(`[data-testid=owner-nav-${key}]`).click();
  return cy.wrap(null, { log: false });
});

Cypress.Commands.add('loginOwner', () => {
  cy.viewport(390, 844);
  cy.activateTablet('B');
  cy.ownerVisit('/owner');
  cy.get('[data-testid=owner-home]').should('be.visible');
  return cy.wrap(null, { log: false });
});

Cypress.Commands.add('storedAccessToken', () =>
  cy.window().then((win) => {
    const raw = win.localStorage.getItem('laodai-auth');
    expect(raw, 'phiên đã lưu').to.be.a('string');
    return JSON.parse(raw!).access_token as string;
  }),
);

Cypress.Commands.add('openShift', (staff: StaffKey) => {
  cy.get(`[data-testid=staff-${SEED.staff[staff]}]`).click();
  cy.get('[data-testid=open-shift]').click();
  cy.get('[data-testid=queue-screen]').should('be.visible');
  cy.get('[data-testid=shift-staff]').should('contain.text', staff);
  return cy.wrap(null, { log: false });
});

Cypress.Commands.add('waitLive', () => {
  cy.get('[data-testid=conn-status]', { timeout: 20_000 }).should('have.attr', 'data-state', 'live');
  return cy.wrap(null, { log: false });
});

export {};
