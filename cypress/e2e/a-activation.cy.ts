// A. Kích hoạt & phân quyền (bước 2 sẽ bổ sung A2–A5)

const freshDevice = { onBeforeLoad: (win: Window) => void win.indexedDB.deleteDatabase('laodai-pos') };

describe('A. Kích hoạt & phân quyền', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('A1: tablet chưa kích hoạt thì mọi đường dẫn bán hàng đều chuyển về màn hình kích hoạt', () => {
    for (const path of ['/', '/queue', '/order/new', '/shift/close', '/debt']) {
      cy.visit(path, freshDevice);
      cy.get('[data-testid=activate-screen]').should('be.visible');
      cy.location('pathname').should('eq', '/activate');
      cy.get('[data-testid=tablet-home]').should('not.exist');
    }
  });

  it('Telegram mock sẵn sàng và rỗng sau reset', () => {
    cy.telegramMessages().should('have.length', 0);
  });
});
