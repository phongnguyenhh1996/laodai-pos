import { SEED } from '../../tests/support/seed-ids';

// B. Ca (mục 10.4), bước 5.

const tid = (id: string) => `[data-testid=${id}]`;

interface DbShift {
  id: string;
  staff_name: string;
  status: string;
  open_boxes: number;
  open_plates: number;
  open_float: number;
  close_boxes_left: number | null;
  close_plates_left: number | null;
  close_cash_counted: number | null;
}

interface DbOrder {
  id: string;
  status: string;
  opened_shift_id: string;
  paid_shift_id: string | null;
  payment_method: string | null;
}

/** Bán một combo và thu đủ tiền mặt (3 chạm). */
function sellCombo(combo: keyof typeof SEED.combos) {
  cy.get(tid('new-order')).click();
  cy.get(tid(`menu-combo-${SEED.combos[combo]}`)).click();
  cy.get(tid('order-pay-exact')).click();
  cy.get(tid('queue-flash')).should('be.visible');
}

/** Chủ (điện thoại) mở báo cáo ca đang mở / vừa đóng của tablet. */
function ownerOpensShift(shiftId: string) {
  cy.get(tid('owner-nav-shifts')).click();
  cy.get(tid(`shift-row-${shiftId}`)).click();
  cy.get(tid('shift-report')).should('be.visible');
}

describe('B. Ca', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('B6: mở ca chỉ cần chọn tên rồi bấm Mở ca; ca nhận đúng số mặc định của tablet A; Telegram nhận tin "mở ca"', () => {
    cy.activateTablet('A');
    cy.get(tid('open-shift')).should('be.disabled');
    cy.get(`${tid('open-shift-screen')} input`).should('not.exist'); // không nhập gì thêm
    cy.openShift('Lan');

    cy.waitSynced();
    cy.task<DbShift[]>('db:shifts', 'A').then((shifts) => {
      expect(shifts).to.have.length(1);
      cy.task<Record<string, number>>('db:profileDefaults', 'A').then((d) => {
        expect(d).to.deep.eq({ default_boxes: 200, default_plates: 60, default_float: 500_000 });
        expect(shifts[0]).to.include({
          staff_name: 'Lan',
          status: 'open',
          open_boxes: d.default_boxes,
          open_plates: d.default_plates,
          open_float: d.default_float,
        });
      });
    });
    cy.telegramWaitFor('🟢 Lan mở ca – Tablet A').its('text').should('match', /^🟢 Lan mở ca – Tablet A – \d\d:\d\d/);

    // Tải lại app: ca vẫn mở
    cy.reload();
    cy.get(tid('queue-screen')).should('be.visible');
    cy.get(tid('shift-staff')).should('contain.text', 'Lan');
  });

  it('B7: chủ (điện thoại) bổ sung 50 hộp giữa ca ⇒ báo cáo ca phản ánh đúng', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sellCombo('xoiGaTrung'); // 31.000 tiền mặt, 1 hộp
    cy.waitSynced();

    cy.task<DbShift[]>('db:shifts', 'A').then(([shift]) => {
      cy.loginOwner();
      ownerOpensShift(shift.id);
      cy.get(tid('shift-report')).should('have.attr', 'data-status', 'open');
      cy.get(tid('rep-boxes-supply')).should('have.text', '200 + 0 = 200');
      cy.get(tid('rep-cash-expected')).should('have.text', '531.000');

      // +50 hộp
      cy.get(tid('adjust-kind-boxes')).click();
      cy.get(tid('adjust-qty')).type('50');
      cy.get(tid('adjust-note')).type('mang thêm');
      cy.get(tid('adjust-submit')).click();
      cy.get(tid('adjustment-row')).should('have.length', 1).first().should('contain.text', '+50 hộp').and('contain.text', 'mang thêm');
      cy.get(tid('rep-boxes-supply')).should('have.text', '200 + 50 = 250');
      // +200k tiền lẻ ⇒ tiền kỳ vọng tăng đúng 200.000
      cy.get(tid('adjust-kind-cash')).click();
      cy.get(tid('adjust-qty')).type('200k');
      cy.get(tid('adjust-submit')).should('contain.text', '200.000').click();
      cy.get(tid('adjustment-row')).should('have.length', 2);
      cy.get(tid('rep-cash-adj')).should('have.text', '200.000');
      cy.get(tid('rep-cash-expected')).should('have.text', '731.000');
      // Số âm / chữ bị từ chối
      cy.get(tid('adjust-kind-boxes')).click();
      cy.get(tid('adjust-qty')).type('-5');
      cy.get(tid('adjust-submit')).click();
      cy.get(tid('adjust-error')).should('be.visible');
      cy.get(tid('adjustment-row')).should('have.length', 2);

      // Cuối ca còn 248 hộp: dùng 250 − 248 = 2, theo đơn 1 ⇒ +1
      cy.task('sim:closeShift', { tablet: 'A', boxes: 248, plates: 60, cash: 731_000 });
      cy.reload();
      cy.get(tid('shift-report')).should('have.attr', 'data-status', 'closed');
      cy.get(tid('rep-boxes-supply')).should('have.text', '200 + 50 = 250');
      cy.get(tid('rep-boxes-left')).should('have.text', '248');
      cy.get(tid('rep-boxes')).should('have.text', '2 / 1');
      cy.get(tid('rep-boxes-diff')).should('have.text', '+1');
      cy.get(tid('rep-cash-diff')).should('have.text', '0');
      cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'Hộp: dùng 2 / theo đơn 1 → +1').and('contain', 'kỳ vọng 731.000');
    });
  });

  it('B8: đóng ca còn 1 đơn mở: không bị chặn; ca sau trên cùng tablet thấy và thu được đơn đó; báo cáo ghi người mở và người thu', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid('order-label')).type('chuyển ca');
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    cy.get(tid('order-save')).click();
    cy.get('[data-testid^=queue-card-]').should('have.length', 1);

    // Lan đóng ca: không bị chặn dù còn đơn mở
    cy.get(tid('open-close-shift')).click();
    cy.get(tid('close-boxes')).type('199');
    cy.get(tid('close-plates')).type('60');
    cy.get(tid('close-cash')).type('500000');
    cy.get(tid('close-review')).click();
    cy.get(tid('close-confirm')).click();
    cy.get(tid('shift-closed')).should('be.visible');
    cy.get(tid('shift-closed-done')).click();

    // Mai mở ca: đơn của Lan vẫn ở hàng đợi, thu được
    cy.openShift('Mai');
    cy.get('[data-testid^=queue-card-]').should('have.length', 1).first().should('contain.text', 'chuyển ca');
    cy.get('[data-testid^=queue-open-]').first().click();
    cy.get(tid('order-pay')).click();
    cy.get(tid('cash-quick-50000')).click();
    cy.get(tid('pay-confirm')).click();
    cy.get(tid('queue-empty')).should('be.visible');
    cy.waitSynced();

    cy.task<DbShift[]>('db:shifts', 'A').then(([lan, mai]) => {
      expect(lan).to.include({ staff_name: 'Lan', status: 'closed' });
      expect(mai).to.include({ staff_name: 'Mai', status: 'open' });
      cy.task<DbOrder[]>('db:orders', 'A').then(([o]) => {
        expect(o).to.include({ status: 'paid', opened_shift_id: lan.id, paid_shift_id: mai.id, payment_method: 'cash' });

        // Báo cáo ca của Mai: đơn do Lan mở, Mai thu; tiền tính cho Mai
        cy.loginOwner();
        ownerOpensShift(mai.id);
        cy.get(tid(`shift-order-${o.id}-who`)).should('have.text', 'Mở: Lan · Thu: Mai');
        cy.get(tid('rep-revenue')).should('have.text', '31.000');
        cy.get(tid('rep-cash-expected')).should('have.text', '531.000');
        // Báo cáo ca của Lan: đơn còn mở lúc đóng ca, hộp tính theo ca mở đơn, không có doanh thu
        cy.get(tid('owner-back')).click();
        cy.get(tid(`shift-row-${lan.id}`)).click();
        cy.get(tid(`shift-order-${o.id}-who`)).should('have.text', 'Mở: Lan · Thu: Mai');
        cy.get(tid('rep-revenue')).should('have.text', '0');
        cy.get(tid('rep-boxes')).should('have.text', '1 / 1');
      });
    });
    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'Đơn còn mở: 1');
  });

  it('B9: sau khi đóng ca màn hình chỉ có dòng "Đã đóng ca"; DOM không chứa số tiền kỳ vọng hay chênh lệch', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sellCombo('xoiGaTrung'); // 31.000
    sellCombo('xoiXeoChaRuoc'); // 28.000 ⇒ kỳ vọng 500.000 + 59.000 = 559.000
    cy.get(tid('open-close-shift')).click();
    cy.get(tid('close-boxes')).type('198');
    cy.get(tid('close-plates')).type('60');
    cy.get(tid('close-cash')).type('540.000'); // thiếu 19.000
    cy.get(tid('close-review')).click();
    cy.get(tid('close-confirm')).click();

    cy.get(tid('shift-closed')).should('be.visible').and('contain.text', 'Đã đóng ca');
    cy.get('body').invoke('text').then((text) => {
      for (const n of ['559.000', '559000', '19.000', '19000', '59.000', '31.000', '28.000']) expect(text).not.to.contain(n);
      expect(text).not.to.match(/kỳ vọng|chênh|doanh thu|−/i);
    });
    cy.get(tid('shift-closed')).find('p').should('have.length', 1).and('have.text', 'Đã đóng ca');

    // Không có gì để mở ra xem lại: về màn chọn nhân viên
    cy.get(tid('shift-closed-done')).click();
    cy.get(tid('staff-picker')).should('be.visible');
    cy.waitSynced();
    cy.task<DbShift[]>('db:shifts', 'A').its(0).should('include', { status: 'closed', close_cash_counted: 540_000, close_boxes_left: 198 });
    // Chênh lệch chỉ tới tay chủ
    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'đếm 540.000 / kỳ vọng 559.000 → −19.000');
  });

  it('kích hoạt lại tablet khi ca còn mở (máy mới / dữ liệu bị xóa) ⇒ lấy lại ca + đơn đang mở, đóng được ca', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid('order-label')).type('còn mở');
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    cy.get(tid('order-serve')).click();
    cy.waitSynced();

    // Chủ kích hoạt lại trên máy trống
    cy.activateTablet('A');
    cy.get(tid('queue-screen')).should('be.visible');
    cy.get(tid('shift-staff')).should('contain.text', 'Lan');
    cy.get(`${tid('queue-pay')} [data-testid^=queue-card-]`).should('have.length', 1).and('contain.text', 'còn mở');

    cy.get('[data-testid^=queue-pay-btn-]').click();
    cy.get(tid('cash-exact')).click();
    cy.get(tid('pay-confirm')).click();
    cy.get(tid('open-close-shift')).click();
    cy.get(tid('close-boxes')).type('199');
    cy.get(tid('close-plates')).type('60');
    cy.get(tid('close-cash')).type('531000');
    cy.get(tid('close-review')).click();
    cy.get(tid('close-confirm')).click();
    cy.get(tid('shift-closed')).should('be.visible');
    cy.waitSynced();
    cy.task<DbShift[]>('db:shifts', 'A').then((shifts) => {
      expect(shifts).to.have.length(1);
      expect(shifts[0]).to.include({ staff_name: 'Lan', status: 'closed', close_cash_counted: 531_000 });
    });
    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'đếm 531.000 / kỳ vọng 531.000');
  });
});
