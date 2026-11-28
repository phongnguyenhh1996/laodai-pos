import { SEED } from '../../tests/support/seed-ids';

// I. In phiếu bếp & bill (SPEC mục 12, plan bước 7) với máy in giả (bản build E2E: VITE_FAKE_PRINTER=1).

const tid = (id: string) => `[data-testid=${id}]`;

interface Job {
  id: string;
  kind: 'kitchen' | 'bill' | 'test';
  source: 'auto' | 'staff' | 'owner';
  status: string;
  error: string | null;
  order_code: string | null;
  tablet_name: string;
  detail: { edit?: { added: Array<{ name: string; qty: number }> } } | null;
}

const summary = (js: Job[]) => js.map((j) => `${j.kind}:${j.source}:${j.status}`);

/** cy.task không tự thử lại ⇒ hỏi lại tới khi lệnh in trên server đúng như mong đợi (tối đa ~15 giây). */
function waitJobs(expected: string[], tries = 30): Cypress.Chainable<Job[]> {
  return cy.task<Job[]>('print:jobs', undefined, { log: false }).then((js) => {
    if (JSON.stringify(summary(js)) === JSON.stringify(expected) || tries <= 0) {
      expect(summary(js)).to.deep.eq(expected);
      return cy.wrap(js, { log: false });
    }
    cy.wait(500, { log: false });
    return waitJobs(expected, tries - 1);
  });
}

/** Tablet A có máy in (giả), đã mở ca. */
function tabletWithPrinter() {
  cy.activateTablet('A');
  cy.window().then((w) => w.localStorage.setItem('laodai-fake-printer', '1'));
  cy.reload();
  cy.openShift('Lan');
  cy.get(tid('printer-status')).should('have.attr', 'data-state', 'connected');
  cy.waitLive();
}

function comboOrder() {
  cy.newOrder();
  cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
  cy.get(tid('order-save')).click();
  cy.get(tid('queue-screen')).should('be.visible');
}

describe('I. In phiếu', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('tạo đơn ⇒ phiếu bếp; sửa ⇒ ĐÃ SỬA; nút in lại; thanh toán ⇒ bill; tablet không có nút in bill', () => {
    tabletWithPrinter();
    comboOrder();
    waitJobs(['kitchen:auto:printed']);
    cy.window().its('__laodaiFakePrinter.writes.length').should('be.greaterThan', 0);

    cy.get('[data-testid^=queue-card-]').first().click();
    cy.get(tid(`menu-product-${SEED.products.xoiXeo}`)).click();
    cy.get(tid('topping-add')).click();
    // Đơn đang chọn tự lưu; các lần tự lưu được gom thành MỘT phiếu "ĐÃ SỬA" (chờ yên vài giây).
    waitJobs(['kitchen:auto:printed', 'kitchen:auto:printed']).then((js) => {
      expect(js[1].detail?.edit?.added).to.deep.eq([{ name: 'Xôi xéo', qty: 1, toppings: [] }]);
    });

    // Nút in lại phiếu bếp nằm ở đầu giỏ của đơn đang chọn.
    cy.get(tid('order-reprint')).click();
    waitJobs(['kitchen:auto:printed', 'kitchen:auto:printed', 'kitchen:staff:printed']);

    cy.get(tid('order-pay-exact')).click();
    cy.newOrder();
    waitJobs(['kitchen:auto:printed', 'kitchen:auto:printed', 'kitchen:staff:printed', 'bill:auto:printed']);
    cy.get('[data-testid*=bill]').should('not.exist');
  });

  it('tắt công tắc ⇒ không tự in, in tay vẫn được; máy in lỗi ⇒ không chặn, báo đỏ, báo cáo ca đếm bill lỗi / không in', () => {
    cy.task('print:autoFlags', { tablet: 'A', flags: { auto_print_kitchen: false } });
    tabletWithPrinter();
    comboOrder();
    cy.wait(1000);
    waitJobs([]);
    cy.get('[data-testid^=queue-card-]').first().click();
    cy.get(tid('order-reprint')).click();
    waitJobs(['kitchen:staff:printed']);

    // Hết giấy: thanh toán vẫn xong, tablet báo đỏ, server ghi lỗi.
    cy.window().then((w) => {
      (w as unknown as { __laodaiFakePrinter: { fail: string | null } }).__laodaiFakePrinter.fail = 'Hết giấy';
    });
    cy.get(tid('order-pay-exact')).click();
    cy.newOrder();
    cy.get(tid('print-error')).should('contain.text', 'Hết giấy');
    cy.get(tid('print-error-retry')).should('not.exist'); // bill: tablet không in lại được
    waitJobs(['kitchen:staff:printed', 'bill:auto:failed']).then((js) => {
      cy.ownerVisit('/owner/shifts');
      cy.get('[data-testid^=shift-row-]').first().click();
      cy.get(tid('rep-bill-issues')).should('contain.text', `${js[1].order_code} (lỗi)`);
    });
  });

  it('chủ in lại bill từ xa: tablet có máy in nhận lệnh; không có máy nào ⇒ hết hạn sau 2 phút', () => {
    tabletWithPrinter();
    comboOrder();
    cy.get('[data-testid^=queue-card-]').first().click();
    cy.get(tid('order-pay-exact')).click();
    waitJobs(['kitchen:auto:printed', 'bill:auto:printed']).then((js) => {
      // Chủ vào chế độ chủ ngay trên tablet (phiên tạm); dịch vụ in của máy vẫn nghe lệnh của quầy.
      cy.task<Array<{ id: string; code: string }>>('db:orders', 'A').then((os) => {
        const o = os.find((x) => x.code === js[1].order_code)!;
        cy.ownerVisit(`/owner/orders/${o.id}`);
        cy.get(tid('reprint-bill-target')).should('contain.text', 'Tablet A (quầy bán)');
        cy.get(tid('reprint-bill-send')).click();
        cy.get(tid('reprint-bill-status'), { timeout: 20_000 }).should('have.attr', 'data-status', 'printed');
        waitJobs(['kitchen:auto:printed', 'bill:auto:printed', 'bill:owner:printed']);

        // Gửi tới quầy B (không có máy nào mở) ⇒ chờ, quá 2 phút ⇒ hết hạn, không in muộn.
        cy.get(tid('reprint-kitchen-target')).select('Tablet B');
        cy.get(tid('reprint-kitchen-send')).click();
        cy.get(tid('reprint-kitchen-status')).should('have.attr', 'data-status', 'pending');
        cy.task('print:age', 121);
        cy.get(tid('reprint-kitchen-status'), { timeout: 15_000 }).should('have.attr', 'data-status', 'expired');
      });
    });
  });
});
