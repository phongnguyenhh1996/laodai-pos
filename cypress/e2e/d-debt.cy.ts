import { SEED } from '../../tests/support/seed-ids';

// D. Ghi nợ & thu nợ (mục 10.4), bước 6.

const tid = (id: string) => `[data-testid=${id}]`;
const GV = SEED.customers.dungGv;
const PB = SEED.customers.dungPhuongB;

interface DbOrder {
  id: string;
  status: string;
  payment_method: string | null;
  total: number;
}

/** Bán 1 combo Xôi gà + trứng (31.000) rồi mở tab Ghi nợ. */
function sellOnDebt() {
  cy.get(tid('new-order')).click();
  cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
  cy.get(tid('order-pay')).click();
  cy.get(tid('pay-method-debt')).click();
}

describe('D. Ghi nợ & thu nợ', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('D17: ghi nợ: gõ "dung" thì gợi ý "Dũng (giáo viên)"; chọn khách đó ⇒ Telegram nhận tin', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sellOnDebt();
    cy.get(tid('pay-debt-confirm')).should('be.disabled');
    cy.get(tid('debt-name')).type('dung');
    cy.get(tid(`customer-suggest-${GV}`)).should('contain.text', 'Dũng (giáo viên)');
    cy.get(tid(`customer-suggest-${PB}`)).should('contain.text', 'Dũng (phường B)');
    cy.get(tid(`customer-suggest-${GV}`)).click();
    cy.get(tid('customer-chosen-label')).should('have.text', 'Dũng (giáo viên)');
    cy.get(tid('pay-debt-confirm')).click();
    cy.get(tid('queue-flash')).should('contain.text', 'Đã ghi nợ 31.000 – Dũng (giáo viên)');
    cy.get('[data-testid^=queue-card-]').should('not.exist');

    cy.waitLive();
    cy.telegramWaitFor('📒 Ghi nợ 31.000 – Dũng (giáo viên)').its('text').should('contain', 'Dư nợ: 31.000').and('contain', 'Lan');
    cy.task<DbOrder[]>('db:orders', 'A').its(0).should('include', { status: 'paid', payment_method: 'debt', total: 31_000 });
    cy.task('db:balance', GV).should('eq', 31_000);
    cy.task('db:customers').should('have.length', 2); // không tạo khách trùng
  });

  it('D18: ghi nợ cho tên mới kèm mô tả ⇒ hệ thống tự tạo khách mới; SĐT để trống vẫn lưu được', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sellOnDebt();
    cy.get(tid('debt-name')).type('Tú');
    cy.get(tid('customer-suggestions')).should('not.exist');
    cy.get(tid('debt-desc')).type('bán vé số');
    cy.get(tid('debt-phone')).should('have.value', '');
    cy.get(tid('pay-debt-confirm')).click();
    cy.get(tid('queue-flash')).should('contain.text', 'Tú (bán vé số)');

    // Khách mới có ngay trên tablet (trước cả khi đồng bộ) để thu nợ
    cy.get(tid('open-debt')).click();
    cy.get(tid('debt-search')).type('tu');
    cy.get('[data-testid^=customer-suggest-]').should('have.length', 1).and('contain.text', 'Tú (bán vé số)').and('contain.text', '31.000');

    cy.waitLive();
    cy.task<Array<{ id: string; name: string; description: string | null; phone: string | null; created_by_shift_id: string | null }>>('db:customers').then((cs) => {
      expect(cs).to.have.length(3);
      const tu = cs.find((c) => c.name === 'Tú')!;
      expect(tu).to.include({ description: 'bán vé số', phone: null });
      expect(tu.created_by_shift_id).to.be.a('string');
      cy.task('db:balance', tu.id).should('eq', 31_000);
    });
    cy.telegramWaitFor('Ghi nợ 31.000 – Tú (bán vé số)');
  });

  it('D19: thu nợ 50.000 tiền mặt ⇒ dư nợ giảm đúng, tiền kỳ vọng của ca tăng 50.000', () => {
    cy.task('scenario:debts', [
      { customer: 'dungGv', product: 'xoiGa' }, // 25.000
      { customer: 'dungGv', product: 'xoiTc' }, // 30.000
      { customer: 'dungGv', product: 'xoiXeo' }, // 15.000
      { customer: 'dungGv', product: 'xoiXeo' }, // 15.000 ⇒ 85.000
    ]);
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.waitLive();
    cy.task<Array<{ id: string }>>('db:shifts', 'A').then(([shift]) => {
      cy.task<{ cash: { expected: number } }>('db:reconcile', shift.id).its('cash.expected').should('eq', 500_000);

      cy.get(tid('open-debt')).click();
      cy.get(tid(`customer-suggest-${GV}`)).should('contain.text', '85.000').click();
      cy.get(tid('customer-balance')).should('have.text', '85.000');
      cy.get(tid('debt-amount')).type('50000');
      cy.get(tid('debt-method-cash')).should('have.attr', 'aria-pressed', 'true');
      cy.get(tid('debt-confirm')).click();
      cy.get(tid('debt-done')).should('contain.text', 'Đã thu nợ 50.000 (tiền mặt)');
      cy.get(tid('customer-balance')).should('have.text', '35.000');

      cy.waitLive();
      cy.task('db:balance', GV).should('eq', 35_000);
      cy.task<{ cash: { expected: number }; debt_collected: { cash: number } }>('db:reconcile', shift.id).then((r) => {
        expect(r.cash.expected).to.eq(550_000);
        expect(r.debt_collected.cash).to.eq(50_000);
      });
      cy.telegramWaitFor('💵 Thu nợ 50.000 (TM) – Dũng (giáo viên)').its('text').should('contain', 'Dư nợ còn: 35.000');

      // Sau khi đồng bộ, danh mục tải lại: vẫn 35.000 (không trừ hai lần)
      cy.reload();
      cy.get(tid('debt-screen')).should('be.visible');
      cy.get(tid(`customer-suggest-${GV}`)).should('contain.text', '35.000');
    });
  });

  it('D20: chủ chuyển khoản nợ từ "Dũng (phường B)" sang "Dũng (giáo viên)" ⇒ dư nợ của hai khách cập nhật đúng', () => {
    cy.task<string[]>('scenario:debts', [
      { customer: 'dungPhuongB', product: 'xoiGa' }, // 25.000
      { customer: 'dungPhuongB', product: 'xoiXeo' }, // 15.000
      { customer: 'dungPhuongB', product: 'xoiPate' }, // 20.000 (giữ lại)
      { customer: 'dungGv', product: 'xoiTc' }, // 30.000
    ]).then(([o1, o2, o3]) => {
      cy.loginOwner();
      cy.ownerNav('debts');
      cy.get(tid('debt-total')).should('have.text', '90.000');
      cy.get(tid(`debt-row-${PB}`)).should('contain.text', 'phường B').and('contain.text', '60.000');
      cy.get(tid(`debt-row-${GV}`)).should('contain.text', 'giáo viên').and('contain.text', '30.000');

      cy.get(tid(`debt-row-${PB}`)).click();
      cy.get(tid('debt-balance')).should('have.text', '60.000');
      cy.get(tid(`debt-pick-${o1}`)).check();
      cy.get(tid(`debt-pick-${o2}`)).check();
      cy.get(`${tid('transfer-select')} option[value="${PB}"]`).should('not.exist'); // không chuyển cho chính mình
      cy.get(tid('transfer-select')).select(GV);
      cy.get(tid('transfer-submit')).should('contain.text', 'Chuyển 40.000 sang Dũng (giáo viên)').click();
      cy.get(tid('transfer-done')).should('contain.text', 'Đã chuyển 40.000 sang Dũng (giáo viên)');
      cy.get(tid('debt-balance')).should('have.text', '20.000');
      cy.get(tid(`debt-order-${o1}`)).should('not.exist');
      cy.get(tid(`debt-order-${o3}`)).should('exist');

      cy.get(tid('owner-back')).click();
      cy.get(tid('debt-total')).should('have.text', '90.000'); // tổng nợ không đổi
      cy.get(tid(`debt-row-${GV}`)).should('contain.text', '70.000').click();
      cy.get(tid('debt-balance')).should('have.text', '70.000');
      cy.get(tid(`debt-order-${o1}`)).should('exist');
      cy.get(tid(`debt-order-${o2}`)).should('exist');
    });
    cy.task('db:balance', PB).should('eq', 20_000);
    cy.task('db:balance', GV).should('eq', 70_000);

    // Chủ ghi thu nợ trên điện thoại (không thuộc ca nào)
    cy.get(tid('owner-debt-amount')).type('70k');
    cy.get(tid('owner-debt-submit')).should('contain.text', '70.000').click();
    cy.get(tid('debt-balance')).should('have.text', '0');
    cy.get(tid('debt-payment-row')).should('have.length', 1).and('contain.text', 'Chủ');
    cy.task('db:balance', GV).should('eq', 0);
  });
});
