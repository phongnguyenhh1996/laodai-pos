/// <reference types="cypress" />

// Lệnh tùy biến theo mục 10.4. Các lệnh cần UI (activateTablet, openShift, loginOwner, goOffline...)
// được bổ sung ở bước tương ứng của mục 8.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      resetAll(): Chainable<null>;
      telegramMessages(): Chainable<Array<{ chat_id: string; text: string; at: string }>>;
      /** Xóa IndexedDB của app (giả lập tablet chưa kích hoạt / dữ liệu bị xóa). */
      clearLocalDb(): Chainable<null>;
    }
  }
}

Cypress.Commands.add('resetAll', () => {
  cy.task('db:reset');
  return cy.task('telegram:clear');
});

Cypress.Commands.add('telegramMessages', () => cy.task('telegram:messages'));

Cypress.Commands.add('clearLocalDb', () =>
  cy.window().then(
    (win) =>
      new Cypress.Promise<null>((resolve) => {
        const req = win.indexedDB.deleteDatabase('laodai-pos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
      }),
  ),
);

export {};
