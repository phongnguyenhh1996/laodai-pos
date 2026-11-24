import { SEED } from '../../tests/support/seed-ids';

// L. Lương (SPEC 7.7) trên điện thoại chủ: ngày công từ ca, đặt lương ngày, đánh "có làm" / "nghỉ" trên lịch,
// thưởng / ứng / hủy dòng / trả đủ, số liệu bảng lương và danh sách khớp nhau.

const tid = (id: string) => `[data-testid=${id}]`;
const LAN = SEED.staff.Lan;

/** Ngày kinh doanh hôm nay (giờ VN) và hai ngày khác trong cùng tháng, không trùng hôm nay. */
function days() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const ym = today.slice(0, 7);
  const others = ['01', '02', '03'].map((d) => `${ym}-${d}`).filter((d) => d !== today);
  return { today, work: others[0], off: others[1] };
}

describe('L. Lương', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('ca hôm nay = 1 ngày công; đặt lương ngày; đánh có làm (+1) / nghỉ (không đổi); thưởng, ứng, hủy, trả đủ', () => {
    const d = days();
    cy.task('sim:openShift', { tablet: 'A', staff: 'Lan' });
    cy.task('sim:close', { tablet: 'A', boxes: 200, plates: 60, cash: 500_000 });

    cy.loginOwner();
    cy.ownerNav('payroll');
    cy.get(tid(`payroll-row-${LAN}`)).should('contain.text', '1 ngày công').and('contain.text', 'Chưa đặt lương ngày').click();
    cy.get(tid('payroll-staff')).should('be.visible');
    cy.get(tid('payroll-rate')).should('contain.text', 'chưa đặt lương');
    cy.get(tid('payslip-shifts')).should('have.text', '1 ca');
    cy.get(tid('payslip-days')).should('have.text', '1 ngày');
    cy.get(tid(`payroll-day-${d.today}`)).should('have.attr', 'data-worked');

    // Đặt lương ngày ở hồ sơ nhân viên (CCCD sai bị chặn ngay trên màn)
    cy.get(tid('payroll-edit-rate')).click();
    cy.get(tid('settings-editor')).should('be.visible');
    cy.get(tid('field-day_rate')).clear().type('300');
    cy.get(tid('field-id_number')).clear().type('123');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-error')).should('contain.text', 'Căn cước công dân');
    cy.get(tid('field-id_number')).clear().type('079 096 001 234');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');

    // Lưu xong thay chỗ trong lịch sử ⇒ lùi một bước là về bảng lương của Lan, số mới
    cy.go('back');
    cy.get(tid('payroll-staff')).should('be.visible');
    cy.get(tid('payroll-rate')).should('contain.text', '300.000 / ngày');
    cy.get(tid('payslip-base')).should('have.text', '300.000');

    // Ngày không có ca: đánh "có làm" ⇒ +1 ngày công
    cy.get(tid(`payroll-day-${d.work}`)).click();
    cy.get(tid('payroll-daymark-kind-work')).click();
    cy.get(tid('payroll-daymark-reason')).type('Làm bù không mở ca');
    cy.get(tid('payroll-daymark-save')).click();
    cy.get(tid('payroll-daymark-status')).should('contain.text', 'Đã đánh có làm').and('contain.text', 'Làm bù không mở ca');
    cy.get(tid(`payroll-day-${d.work}`)).should('have.attr', 'data-mark', 'work');
    cy.get(tid('payslip-days')).should('have.text', '2 ngày (có ca 1, đánh có làm 1)');
    cy.get(tid('payslip-base')).should('have.text', '600.000');

    // Đánh "nghỉ" ⇒ ghi nhận, không đổi lương
    cy.get(tid(`payroll-day-${d.off}`)).click();
    cy.get(tid('payroll-daymark-kind-off')).click();
    cy.get(tid('payroll-daymark-save')).click();
    cy.get(tid(`payroll-day-${d.off}`)).should('have.attr', 'data-mark', 'off');
    cy.get(tid('payslip-days')).should('have.text', '2 ngày (có ca 1, đánh có làm 1)');

    // Bỏ đánh dấu nghỉ
    cy.get(tid('payroll-daymark-remove')).click();
    cy.get(tid(`payroll-day-${d.off}`)).should('not.have.attr', 'data-mark');

    // Thưởng 50k, ứng 100k
    cy.get(tid('payroll-kind-bonus')).click();
    cy.get(tid('payroll-amount')).type('50');
    cy.get(tid('payroll-submit')).should('contain.text', '50.000').click();
    cy.get(tid('payslip-bonus')).should('have.text', '50.000');
    cy.get(tid('payslip-total')).should('have.text', '650.000');
    cy.get(tid('payroll-kind-advance')).click();
    cy.get(tid('payroll-amount')).type('100');
    cy.get(tid('payroll-note')).type('ứng tiền xe');
    cy.get(tid('payroll-submit')).click();
    cy.get(tid('payslip-advance')).should('have.text', '100.000');
    cy.get(tid('payslip-remaining')).should('have.text', '550.000');

    // Số tiền 0 bị chặn
    cy.get(tid('payroll-submit')).click();
    cy.get(tid('payroll-form-error')).should('contain.text', 'Nhập số tiền');

    // Hủy dòng ứng (ghi nhầm) ⇒ còn phải trả về 650.000, dòng vẫn còn trong sổ (gạch)
    cy.get('[data-testid=payroll-entry][data-kind=advance]').find(tid('payroll-entry-void')).click();
    cy.get('[data-testid=payroll-entry][data-kind=advance]').should('have.attr', 'data-voided', 'true');
    cy.get(tid('payslip-advance')).should('not.exist');
    cy.get(tid('payslip-remaining')).should('have.text', '650.000');

    // Trả đủ
    cy.get(tid('payroll-pay-all')).should('contain.text', '650.000').click();
    cy.get(tid('payslip-payment')).should('have.text', '650.000');
    cy.get(tid('payslip-remaining')).should('have.text', '0');
    cy.get(tid('payroll-pay-all')).should('not.exist');

    // Danh sách tháng khớp bảng lương
    cy.get(tid('owner-back')).click();
    cy.get(tid('payroll-list')).should('be.visible');
    cy.get(tid(`payroll-row-${LAN}-total`)).should('contain.text', '650.000');
    cy.get(tid(`payroll-row-${LAN}-remaining`)).should('have.text', '0');
    cy.get(tid('payroll-total')).should('contain.text', '650.000');
    cy.get(tid('payroll-paid')).should('contain.text', '650.000');
    cy.get(tid(`payroll-row-${LAN}`)).should('contain.text', '300.000 / ngày');
    cy.get(tid(`payroll-row-${SEED.staff.Mai}`)).should('contain.text', '0 ngày công');

    // Nhật ký nhóm "Chủ" có các thao tác lương
    cy.ownerNav('log');
    cy.get(tid('log-filter-type')).select('owner');
    cy.get(tid('log-row')).then(($r) => {
      const actions = [...$r].map((r) => r.dataset.action);
      expect(actions).to.include.members(['payroll_add', 'payroll_void', 'day_work_add', 'day_off_add', 'day_off_remove']);
    });
  });
});
