import { SEED } from '../../tests/support/seed-ids';

// J. Smoke toàn bộ màn chế độ chủ: mỗi trang hiện đúng, tải xong dữ liệu, không báo lỗi, không có console.error —
// ở cả điện thoại (390×844) lẫn tablet / máy tính (1280×800). Bắt lỗi vỡ màn khi đổi giao diện.
// Chuyển trang bằng history (không tải lại) vì chế độ chủ là phiên tạm: tải lại là phải nhập mật khẩu.

const tid = (id: string) => `[data-testid=${id}]`;

interface Page {
  path: string;
  /** testId của khung trang (OwnerLayout). */
  page: string;
  /** Phần tử chỉ có khi dữ liệu đã tải xong. */
  content?: string;
}

const ENTITIES = ['menus', 'points', 'products', 'toppings', 'combos', 'staff', 'profiles'];

function pages(ids: Record<string, string>, shiftId: string): Page[] {
  return [
    { path: '/owner', page: 'owner-home', content: tid('dashboard') },
    { path: '/owner/orders', page: 'orders-page', content: tid('orders-list') },
    { path: `/owner/orders/${ids.cash}`, page: 'order-detail', content: tid('reprint-bill-send') },
    { path: `/owner/orders/${ids.tr}/edit`, page: 'order-edit' },
    { path: '/owner/reports', page: 'report-page', content: tid('report-revenue') },
    { path: '/owner/shifts', page: 'shift-list', content: `[data-testid^=shift-row-]` },
    { path: `/owner/shifts/${shiftId}`, page: 'shift-detail', content: tid('shift-report') },
    { path: '/owner/debts', page: 'debt-list', content: tid('debt-total') },
    { path: `/owner/debts/${SEED.customers.dungGv}`, page: 'debt-customer', content: tid('debt-balance') },
    { path: '/owner/payroll', page: 'payroll-list', content: tid('payroll-totals') },
    { path: `/owner/payroll/${SEED.staff.Lan}`, page: 'payroll-staff', content: tid('payroll-calendar') },
    { path: '/owner/log', page: 'log-page', content: tid('log-row') },
    { path: '/owner/settings', page: 'settings-home', content: tid('settings-section-products') },
    ...ENTITIES.flatMap((e) => [
      { path: `/owner/settings/${e}`, page: 'settings-list', content: `[data-testid^=settings-row-]` },
      { path: `/owner/settings/${e}/new`, page: 'settings-editor', content: tid('settings-save') },
    ]),
    { path: `/owner/settings/products/${SEED.products.xoiGa}`, page: 'settings-editor', content: tid('price-history') },
    { path: `/owner/settings/staff/${SEED.staff.Lan}`, page: 'settings-editor', content: tid('field-day_rate') },
    { path: `/owner/settings/profiles/${SEED.tablets.A}`, page: 'settings-editor', content: tid('field-count_cans') },
    { path: '/owner/settings/print-template', page: 'print-template', content: tid('tpl-preview') },
    { path: '/owner/device', page: 'owner-device-page' },
    { path: '/owner/more', page: 'owner-more', content: tid('owner-nav-settings') },
  ];
}

/** Đổi đường dẫn trong app (React Router nghe popstate), không tải lại trang. */
function go(path: string) {
  cy.window({ log: false }).then((w) => {
    w.history.pushState({}, '', path);
    w.dispatchEvent(new PopStateEvent('popstate'));
  });
  cy.location('pathname').should('eq', path.split('?')[0]);
}

function checkAll(list: Page[], consoleErrors: string[]) {
  for (const p of list) {
    go(p.path);
    cy.get(tid(p.page)).should('be.visible');
    cy.get(tid('splash')).should('not.exist');
    if (p.content) cy.get(p.content).should('exist');
    cy.get('[role=alert]').should('not.exist');
    cy.then(() => expect(consoleErrors, `console.error ở ${p.path}`).to.deep.eq([]));
  }
}

describe('J. Màn chế độ chủ (smoke)', () => {
  const consoleErrors: string[] = [];

  beforeEach(() => {
    consoleErrors.length = 0;
    cy.on('window:before:load', (win) => {
      const orig = win.console.error.bind(win.console);
      win.console.error = (...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
        orig(...args);
      };
    });
    cy.resetAll();
    // Đủ loại dữ liệu cho mọi màn: đơn TM / CK / nợ / đã xóa, một ca đã đóng, nhật ký.
    cy.task<Record<string, string>>('scenario:staffReport').as('ids');
    cy.task('sim:close', { tablet: 'B', boxes: 100, plates: 0, cash: 300_000 });
    cy.task<Array<{ id: string; status: string }>>('db:shifts', 'B').then((ss) => cy.wrap(ss.find((s) => s.status === 'closed')!.id).as('shiftId'));
  });

  it('điện thoại 390×844: mọi màn hiện đủ, không lỗi', function () {
    cy.loginOwner();
    checkAll(pages(this.ids, this.shiftId), consoleErrors);
  });

  it('tablet / máy tính 1280×800: mọi màn hiện đủ, không lỗi', function () {
    cy.viewport(1280, 800);
    cy.activateTablet('A');
    cy.ownerVisit('/owner');
    cy.get(tid('owner-home')).should('be.visible');
    checkAll(pages(this.ids, this.shiftId), consoleErrors);
  });
});
