import './commands';

// Service worker của PWA chặn điều hướng trong Cypress (trang không bao giờ fire `load`).
// E2E giả lập offline ở tầng mạng (cy.goOffline), nên tắt hẳn việc đăng ký SW.
Cypress.on('window:before:load', (win) => {
  if ('serviceWorker' in win.navigator) {
    Object.defineProperty(win.navigator, 'serviceWorker', { value: undefined, configurable: true });
  }
});

beforeEach(() => {
  cy.intercept('/registerSW.js', { body: '', headers: { 'content-type': 'application/javascript' } });
});
