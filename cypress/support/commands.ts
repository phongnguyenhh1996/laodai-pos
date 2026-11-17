/// <reference types="cypress" />
import { SEED } from '../../tests/support/seed-ids';

// Lệnh tùy biến theo mục 10.4. Các lệnh cần UI của bước sau (openShift, goOffline...)
// được bổ sung ở bước tương ứng của mục 8.

type TabletKey = keyof typeof SEED.tablets;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      resetAll(): Chainable<null>;
      telegramMessages(): Chainable<Array<{ chat_id: string; text: string; at: string }>>;
      /** Chờ tin Telegram chứa `text` (tối đa 15 giây). */
      telegramWaitFor(text: string): Chainable<{ chat_id: string; text: string; at: string }>;
      /** Xóa IndexedDB của app (giả lập tablet chưa kích hoạt / dữ liệu bị xóa). */
      clearLocalDb(): Chainable<null>;
      /** Mở trang như trên một máy mới tinh: không IndexedDB, không phiên đăng nhập. */
      visitFresh(path: string): Chainable<Cypress.AUTWindow>;
      /** Kích hoạt máy hiện tại thành tablet A/B qua giao diện (chủ đăng nhập → chọn hồ sơ). */
      activateTablet(tablet: TabletKey): Chainable<null>;
      /** Chủ đăng nhập trên điện thoại (viewport 390×844, máy chưa kích hoạt). */
      loginOwner(): Chainable<null>;
      /** Token phiên chính đang lưu trên máy (tablet: phiên vai trò `tablet`). */
      storedAccessToken(): Chainable<string>;
    }
  }
}

Cypress.Commands.add('resetAll', () => {
  cy.task('db:reset');
  return cy.task('telegram:clear');
});

Cypress.Commands.add('telegramMessages', () => cy.task('telegram:messages'));

Cypress.Commands.add('telegramWaitFor', (text: string) => cy.task('telegram:waitFor', text, { timeout: 30_000 }));

Cypress.Commands.add('clearLocalDb', () =>
  cy.window().then(
    (win) =>
      new Cypress.Promise<null>((resolve) => {
        const req = win.indexedDB.deleteDatabase('laodai-pos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
      }),
  ),
);

Cypress.Commands.add('visitFresh', (path: string) =>
  cy.visit(path, {
    onBeforeLoad(win) {
      win.localStorage.clear();
      win.indexedDB.deleteDatabase('laodai-pos');
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

Cypress.Commands.add('loginOwner', () => {
  cy.viewport(390, 844);
  cy.visitFresh('/owner');
  cy.get('[data-testid=owner-email]').type(SEED.owner.email);
  cy.get('[data-testid=owner-password]').type(SEED.owner.password, { log: false });
  cy.get('[data-testid=owner-login-submit]').click();
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

export {};
