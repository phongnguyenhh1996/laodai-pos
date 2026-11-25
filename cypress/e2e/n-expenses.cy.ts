// N. Khoản chi giữa ca (SPEC 4.9, 5, 6; kế hoạch docs/plans/khoan-chi-giua-ca.md mục 6).
// Tablet A: tiền lẻ đầu ca 500.000.

const tid = (id: string) => `[data-testid=${id}]`;

interface DbShift {
  id: string;
  status: string;
}

function recordExpense(thousands: string, note: string) {
  cy.get(tid('expense-amount')).clear().type(thousands);
  cy.get(tid('expense-note')).clear().type(note);
  cy.get(tid('expense-save')).click();
  cy.get(tid('expense-confirm-sheet')).should('contain.text', `Chi ${thousands}.000đ – ${note}?`);
  cy.get(tid('expense-confirm')).click();
  cy.get(tid('expense-done')).should('contain.text', `Đã ghi chi ${thousands}.000đ – ${note}`);
}

describe('N. Khoản chi giữa ca', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('N1: chi 20k "mua đá" ⇒ đếm mù đúng số đã trừ khớp; chủ thấy chênh lệch 0 + khoản chi; chủ sửa khoản của ca đã đóng ⇒ "đã điều chỉnh"', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('open-expenses')).click();
    recordExpense('20', 'mua đá');
    cy.get(tid('expense-row')).should('have.length', 1).and('contain.text', 'mua đá');
    cy.get(tid('expense-total')).should('have.text', '20.000đ');
    cy.telegramWaitFor('💸 Chi 20.000 – mua đá · Lan · Tablet A');

    // Đóng ca: két còn 480.000 ⇒ khớp.
    cy.get(tid('open-close-shift')).click();
    cy.get(tid('close-boxes')).type('0');
    cy.get(tid('close-plates')).type('0');
    cy.get(tid('close-cash')).type('480');
    cy.get(tid('close-review')).click();
    cy.get(tid('close-confirm')).click();
    cy.get(tid('shift-closed')).should('be.visible');
    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'đếm 480.000 / kỳ vọng 480.000').and('contain', 'Chi: 1 khoản · 20.000');

    cy.task<DbShift[]>('db:shifts', 'A').then(([shift]) => {
      cy.loginOwner();
      cy.ownerVisit(`/owner/shifts/${shift.id}`);
      cy.get(tid('rep-cash-expenses')).should('have.text', '−20.000');
      cy.get(tid('rep-cash-diff')).should('have.text', '0');
      cy.get(tid('shift-expense-row')).should('have.length', 1).and('contain.text', 'mua đá').and('contain.text', 'Lan');
      cy.get(tid('shift-adjusted')).should('not.exist');

      // Chủ sửa 20.000 → 25.000 ⇒ kỳ vọng giảm 5.000, đếm dư +5.000, "đã điều chỉnh".
      cy.get(tid('shift-expense-edit')).click();
      cy.get(tid('shift-expense-editing')).should('contain.text', 'Ca đã đóng');
      cy.get(tid('shift-expense-edit-amount')).clear().type('25');
      cy.get(tid('shift-expense-save')).click();
      cy.get(tid('shift-adjusted')).should('be.visible');
      cy.get(tid('rep-cash-expenses')).should('have.text', '−25.000');
      cy.get(tid('rep-cash-diff')).should('have.text', '+5.000');
      cy.task('db:reconcile', shift.id).its('cash').should('deep.equal', { expected: 475_000, counted: 480_000, diff: 5_000 });
      cy.telegramWaitFor('✏️ Sửa chi: 20.000 – mua đá → 25.000 – mua đá').its('text').should('contain', 'tiền mặt 0 → +5.000');

      // Báo cáo hôm nay có thẻ Khoản chi cộng theo ghi chú.
      cy.ownerVisit('/owner/reports');
      cy.get(tid('report-expenses-total')).should('have.text', '25.000');
      cy.get(tid('report-expense-group')).should('have.length', 1).and('contain.text', 'mua đá').and('contain.text', '1 lần');
    });
  });

  it('N2: ghi chú gần đây xuất hiện ở lần sau; bấm chỉ điền ghi chú, không điền số tiền', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('open-expenses')).click();
    cy.get(tid('expense-recent')).should('not.exist');
    recordExpense('20', 'mua đá');
    cy.get(tid('expense-recent')).should('have.length', 1).and('have.text', 'mua đá');

    cy.reload();
    cy.get(tid('expense-recent')).contains('mua đá').click();
    cy.get(tid('expense-note')).should('have.value', 'mua đá');
    cy.get(tid('expense-amount')).should('have.value', '');
    cy.get(tid('expense-save')).should('have.text', 'Chi tiền');
  });

  it('N3: nhân viên hủy khoản của mình (có hỏi lại); khoản "Chủ ghi" không có nút hủy', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('open-expenses')).click();
    recordExpense('50', 'ghi nhầm');
    cy.get(tid('expense-void')).click();
    cy.get(tid('expense-void-sheet')).should('contain.text', 'ghi nhầm').and('contain.text', '50.000đ');
    cy.get(tid('expense-void-confirm')).click();
    cy.get(tid('expense-row')).should('have.attr', 'data-voided', 'true');
    cy.get(tid('expense-total')).should('have.text', '0đ');
    cy.telegramWaitFor('↩️ Hủy chi 50.000 – ghi nhầm · Lan');

    cy.waitLive();
    cy.task('owner:expense', { tablet: 'A', amount: 10_000, note: 'mua chanh' });
    cy.get('[data-testid=expense-row][data-owner=true]').should('contain.text', 'Chủ ghi').find(tid('expense-void')).should('not.exist');
    cy.get(tid('expense-total')).should('have.text', '10.000đ');
    cy.task('db:expenses').should('deep.equal', [
      { amount: 50_000, note: 'ghi nhầm', actor_kind: 'staff', voided: true },
      { amount: 10_000, note: 'mua chanh', actor_kind: 'owner', voided: false },
    ]);
  });

  it('N4: điện thoại: thanh đáy có Chi tiền; nhân viên không thấy doanh thu / kỳ vọng trên màn Chi tiền', () => {
    cy.viewport(390, 844);
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).should('contain.text', 'Đơn');
    cy.get(tid('open-expenses')).should('be.visible').click();
    cy.get(tid('expense-screen')).should('be.visible');
    cy.get('body').invoke('text').should('not.match', /kỳ vọng|doanh thu|chênh/i);
    cy.get(tid('expense-back')).click();
    cy.get(tid('queue-screen')).should('be.visible');
  });
});
