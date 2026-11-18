import { SEED } from '../../tests/support/seed-ids';

// A. Kích hoạt & phân quyền (mục 10.4)

const OWNER_IDLE_MS = 2 * 60_000;
const SALE_PATHS = ['/', '/queue', '/order/new', '/shift/close', '/debt'];

describe('A. Kích hoạt & phân quyền', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('A1: tablet chưa kích hoạt thì mọi đường dẫn bán hàng đều chuyển về màn hình kích hoạt', () => {
    for (const path of SALE_PATHS) {
      cy.visitFresh(path);
      cy.get('[data-testid=activate-screen]').should('be.visible');
      cy.location('pathname').should('eq', '/activate');
      cy.get('[data-testid=tablet-home]').should('not.exist');
    }
  });

  it('A2: kích hoạt tablet A bằng tài khoản chủ ⇒ màn chọn nhân viên, Telegram "Tablet A vừa được đăng nhập"', () => {
    cy.visitFresh('/activate');
    cy.get('[data-testid=activate-email]').type(SEED.owner.email);
    cy.get('[data-testid=activate-password]').type(SEED.owner.password, { log: false });
    cy.get('[data-testid=activate-login]').click();
    // Chủ thấy đủ quầy để chọn
    cy.get(`[data-testid=activate-profile-${SEED.tablets.A}]`).should('be.visible');
    cy.get(`[data-testid=activate-profile-${SEED.tablets.B}]`).should('be.visible');
    cy.get(`[data-testid=activate-profile-${SEED.tablets.A}]`).click();

    cy.location('pathname').should('eq', '/');
    cy.get('[data-testid=tablet-name]').should('contain.text', 'Tablet A');
    cy.get('[data-testid=staff-picker]').should('be.visible');
    for (const id of Object.values(SEED.staff)) cy.get(`[data-testid=staff-${id}]`).should('be.visible');

    // Phiên chính trên máy là phiên tablet, không còn phiên chủ
    cy.storedAccessToken().then((t) => {
      const claims = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      expect(claims.app_metadata).to.include({ role: 'tablet', tablet_profile_id: SEED.tablets.A });
    });

    cy.telegramWaitFor('Tablet A vừa được đăng nhập').its('text').should('match', /🔐 Tablet A vừa được đăng nhập – \d\d:\d\d/);

    // Tải lại vẫn là tablet A (không phải kích hoạt lại)
    cy.reload();
    cy.get('[data-testid=tablet-name]').should('contain.text', 'Tablet A');
  });

  it('A3: sau khi kích hoạt, gõ URL trang chủ (/owner/...) thì bị yêu cầu nhập mật khẩu', () => {
    cy.activateTablet('A');
    for (const path of ['/owner', '/owner/shifts', '/owner/reports']) {
      cy.visit(path);
      cy.get('[data-testid=owner-unlock]').should('be.visible');
      cy.get('[data-testid=owner-home]').should('not.exist');
      cy.get('[data-testid=owner-email]').should('not.exist'); // chỉ hỏi mật khẩu
    }

    // Sai mật khẩu: vẫn khóa, không báo "vào chế độ chủ"
    cy.get('[data-testid=owner-password]').type('sai-mat-khau');
    cy.get('[data-testid=owner-unlock-submit]').click();
    cy.get('[data-testid=owner-error]').should('be.visible');
    cy.get('[data-testid=owner-home]').should('not.exist');

    // Nút Chế độ chủ trên màn bán hàng cũng dẫn tới màn nhập mật khẩu
    cy.visit('/');
    cy.get('[data-testid=open-owner-mode]').click();
    cy.get('[data-testid=owner-unlock]').should('be.visible');
    cy.telegramMessages().then((msgs) => expect(msgs.map((m) => m.text).join('\n')).not.to.contain('Vào chế độ chủ'));
  });

  it('A4: vào chế độ chủ bằng mật khẩu ⇒ Telegram; 2 phút không thao tác ⇒ tự về màn bán hàng', () => {
    cy.activateTablet('A');
    cy.visit('/owner');
    cy.get('[data-testid=owner-password]').type(SEED.owner.password, { log: false });
    cy.get('[data-testid=owner-unlock-submit]').click();
    cy.get('[data-testid=owner-home]').should('be.visible');
    cy.telegramWaitFor('Vào chế độ chủ trên Tablet A');

    cy.clock();
    // Bấm vào dòng chữ trung tính (không phải link) ⇒ chỉ là "thao tác", không điều hướng
    cy.get('[data-testid=owner-device]').click(); // thao tác ⇒ đồng hồ không thao tác bắt đầu lại (giờ giả)
    cy.tick(OWNER_IDLE_MS - 10_000);
    cy.get('[data-testid=owner-device]').click(); // còn thao tác ⇒ chưa thoát
    cy.tick(OWNER_IDLE_MS - 1_000);
    cy.get('[data-testid=owner-home]').should('be.visible');
    cy.tick(1_000);
    cy.get('[data-testid=tablet-home]').should('be.visible');
    cy.location('pathname').should('eq', '/');
    cy.get('[data-testid=owner-home]').should('not.exist');
    cy.clock().invoke('restore');

    // Vào lại phải nhập mật khẩu lần nữa
    cy.get('[data-testid=open-owner-mode]').click();
    cy.get('[data-testid=owner-unlock]').should('be.visible');
    cy.get('[data-testid=owner-home]').should('not.exist');
  });

  it('A4b: tải lại trang khi đang ở chế độ chủ ⇒ mất phiên chủ tạm, phải nhập lại mật khẩu', () => {
    cy.activateTablet('A');
    cy.visit('/owner');
    cy.get('[data-testid=owner-password]').type(SEED.owner.password, { log: false });
    cy.get('[data-testid=owner-unlock-submit]').click();
    cy.get('[data-testid=owner-home]').should('be.visible');
    cy.reload();
    cy.get('[data-testid=owner-unlock]').should('be.visible');
    // Phiên chính vẫn là phiên tablet
    cy.storedAccessToken().then((t) => {
      const claims = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      expect(claims.app_metadata.role).to.eq('tablet');
    });
  });

  it('A5: trình duyệt khác chưa kích hoạt (điện thoại nhân viên) không vào được màn bán hàng', () => {
    cy.activateTablet('A');

    // Máy khác: không có gì trên máy
    for (const path of SALE_PATHS) {
      cy.visitFresh(path);
      cy.get('[data-testid=activate-screen]').should('be.visible');
      cy.get('[data-testid=tablet-home]').should('not.exist');
    }

    // Nhân viên không có mật khẩu chủ: không kích hoạt được
    cy.get('[data-testid=activate-email]').type(SEED.owner.email);
    cy.get('[data-testid=activate-password]').type('doan-bua');
    cy.get('[data-testid=activate-login]').click();
    cy.get('[data-testid=activate-error]').should('be.visible');
    cy.get('[data-testid=activate-profiles]').should('not.exist');

    // Chép được dữ liệu kích hoạt nhưng không có phiên tablet: vẫn không vào được
    cy.activateTablet('A');
    cy.window().then((win) => win.localStorage.removeItem('laodai-auth'));
    cy.visit('/queue');
    cy.get('[data-testid=activate-screen]').should('be.visible');
    cy.get('[data-testid=tablet-home]').should('not.exist');
  });

  it('điện thoại chủ đi cùng luồng với tablet: đăng nhập → chọn quầy; chế độ chủ luôn hỏi mật khẩu', () => {
    cy.viewport(390, 844);
    // Máy mới vào thẳng /owner: không có form đăng nhập riêng, về màn đăng nhập + chọn quầy
    cy.visitFresh('/owner');
    cy.location('pathname').should('eq', '/activate');
    cy.get('[data-testid=activate-screen]').should('be.visible');

    cy.loginOwner();
    cy.get('[data-testid=owner-device]').should('contain.text', 'Tablet B');
    // Tải lại: vẫn là máy của quầy B nhưng chế độ chủ phải nhập lại mật khẩu
    cy.reload();
    cy.get('[data-testid=owner-unlock]').should('be.visible');
    cy.get('[data-testid=owner-email]').should('not.exist');
    cy.visit('/');
    cy.get('[data-testid=tablet-name]').should('contain.text', 'Tablet B');
  });

  it('Telegram mock sẵn sàng và rỗng sau reset', () => {
    cy.telegramMessages().should('have.length', 0);
  });
});
