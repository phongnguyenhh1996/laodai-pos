import { SEED } from '../../tests/support/seed-ids';

// H. Tổng kết ngày (mục 10.4), bước 8.

const tid = (id: string) => `[data-testid=${id}]`;

describe('H. Tổng kết ngày', () => {
  beforeEach(() => {
    cy.resetAll();
    cy.task('summary:prepare');
  });

  it('H38: tới giờ tổng kết (gọi thẳng hàm cron) ⇒ Telegram nhận đủ doanh thu theo điểm, hình thức thanh toán, số đơn xóa và chênh lệch của từng ca', () => {
    // Tablet B (giả lập phía server): Mai ghi nợ 20.000 cho Dũng (giáo viên), đóng ca (hộp: dùng 0 / theo đơn 1)
    cy.task('scenario:debts', [{ customer: 'dungGv', product: 'xoiPate' }]);

    // Tablet A: Lan bán Xôi A (TM 31.000), Cơm gà (CK 40.000), xóa 1 đơn đã ra món, đóng ca đếm thiếu 10.000
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    cy.get(tid('order-pay-exact')).click();
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.com}`)).click();
    cy.get(tid(`menu-combo-${SEED.combos.comGaCanh}`)).click();
    cy.get(tid('order-pay-transfer')).click();
    cy.get(tid('pay-transfer-confirm')).click();
    cy.get(tid('new-order')).click();
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiXeoChaRuoc}`)).click();
    cy.get(tid('order-serve')).click();
    cy.get('[data-testid^=queue-open-]').click();
    cy.get(tid('order-delete')).click();
    cy.get(tid('delete-reason-mistake')).click();
    cy.get(tid('open-close-shift')).click();
    cy.get(tid('close-boxes')).type('199'); // dùng 1 = theo đơn 1 (cơm tại chỗ dùng dĩa)
    cy.get(tid('close-plates')).type('59');
    cy.get(tid('close-cash')).type('521'); // kỳ vọng 531.000
    cy.get(tid('close-review')).click();
    cy.get(tid('close-confirm')).click();
    cy.waitLive();

    // Chưa tới giờ: không gửi. Tới giờ: gửi đúng một lần.
    cy.task('cron:tick', '23:58').should('eq', null);
    cy.task('cron:tick', '23:59').should('be.a', 'string');
    cy.task('cron:tick', '23:59').should('eq', null);

    cy.telegramWaitFor('📊 Tổng kết ngày').then((m) => {
      const t = m.text;
      expect(t).to.contain('Doanh thu: 91.000 (TM 31.000 · CK 40.000 · Nợ 20.000)');
      expect(t).to.contain('• Xôi A: 31.000');
      expect(t).to.contain('• Xôi B: 20.000');
      expect(t).to.contain('• Cơm gà: 40.000');
      expect(t).to.contain('Xóa: 1 đơn (1 đã ra món)');
      expect(t).to.contain('• Mai – Tablet B: TM 0 · Hộp −1 · Dĩa 0');
      expect(t).to.contain('• Lan – Tablet A: TM −10.000 · Hộp 0 · Dĩa 0');
      expect(t).to.match(/🔗 \S+\/owner\/reports\?date=\d{4}-\d\d-\d\d/);
      cy.telegramMessages().then((ms) => expect(ms.filter((x) => x.text.includes('📊 Tổng kết ngày'))).to.have.length(1));
    });
  });
});
