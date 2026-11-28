import { SEED } from '../../tests/support/seed-ids';

// G. Chủ (mục 10.4). Bước 4: G32, G37; bước 9: G33–G36.

const tid = (id: string) => `[data-testid=${id}]`;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

interface Sold {
  id: string;
  code: string;
  total: number;
}

function openSettings(section: string, rowId: string) {
  cy.ownerNav('settings');
  cy.get(tid(`settings-section-${section}`)).click();
  cy.get(tid(`settings-row-${rowId}`)).click();
  cy.get(tid('settings-editor')).should('be.visible');
}

function enterOwnerModeOnTablet() {
  cy.get(tid('open-owner-mode')).click();
  cy.get(tid('owner-password')).type(SEED.owner.password, { log: false });
  cy.get(tid('owner-unlock-submit')).click();
  cy.get(tid('owner-pin-later')).click();
  cy.get(tid('owner-home')).should('be.visible');
}

describe('G. Chủ', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('G32: đổi giá món ⇒ đơn đang mở trên tablet giữ giá cũ, đơn mới dùng giá mới, lịch sử giá có bản ghi mới', () => {
    cy.task<string>('g32:openOrder');

    // Chủ đổi giá trên điện thoại: Xôi gà 25.000 → 28.000
    cy.loginOwner();
    openSettings('products', SEED.products.xoiGa);
    cy.get(tid('price-history-row')).should('not.exist');
    cy.get(tid('field-price')).should('have.value', '25').clear().type('28');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');
    cy.get(tid('field-price')).should('have.value', '28');
    cy.get(tid('price-history-row'))
      .should('have.length', 1)
      .first()
      .should('contain.text', '25.000')
      .and('contain.text', '28.000');
    // Danh sách món hiện giá mới
    cy.get(tid('owner-back')).click();
    cy.get(tid(`settings-row-${SEED.products.xoiGa}`)).should('contain.text', '28.000');

    // Đơn đang mở giữ giá cũ (kể cả khi sửa số lượng); đơn mới với giá cũ bị server từ chối, giá mới thì nhận
    cy.task('g32:afterPriceChange', 28000).should('deep.equal', {
      openSnap: 25000,
      editOld: 'ok',
      editedTotal: 50000,
      newWithOldPrice: 'rejected',
      newWithNewPrice: 'ok',
    });

    // Tablet đồng bộ danh mục: đơn mới sẽ dùng giá mới (combo cũng tính lại theo giá mới)
    // Kích hoạt tablet A: server còn ca của Lan + 2 đơn đang mở ⇒ tablet lấy lại cả ca lẫn đơn,
    // đơn cũ vẫn giá cũ (2 × 25.000), đơn tạo sau khi đổi giá là giá mới (28.000)
    cy.activateTablet('A');
    cy.get(tid('shift-staff')).should('contain.text', 'Lan');
    cy.get('[data-testid^=queue-total-]').then(($t) => expect([...$t].map((t) => t.textContent)).to.deep.eq(['50.000', '28.000']));
    cy.newOrder();
    cy.get(tid(`menu-product-${SEED.products.xoiGa}-price`)).should('contain.text', '28.000');
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}-price`)).should('contain.text', '34.000');
    cy.get(tid(`menu-product-${SEED.products.xoiXeo}-price`)).should('contain.text', '15.000');
  });

  it('G37: bỏ "Cơm gà" khỏi tablet A ⇒ tab Cơm gà biến mất trên tablet A sau khi đồng bộ', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.newOrder();
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('be.visible').click();
    cy.get(tid(`menu-product-${SEED.products.comGa}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.xoiB}`)).should('not.exist');

    // Chủ sửa hồ sơ tablet (ngay trên tablet, chế độ chủ)
    enterOwnerModeOnTablet();
    openSettings('profiles', SEED.tablets.A);
    cy.get(tid(`field-point_ids-${SEED.points.com}`)).should('be.checked').uncheck();
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');
    cy.get(tid(`field-point_ids-${SEED.points.com}`)).should('not.be.checked');
    cy.task('db:profilePoints', 'A').should('deep.equal', [SEED.points.xoiA]);

    // Về màn bán hàng ⇒ tablet đồng bộ danh mục, tab Cơm gà biến mất
    cy.get(tid('owner-exit')).click();
    cy.get(tid('tablet-home')).should('be.visible');
    cy.newOrder();
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('not.exist');
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible').and('have.attr', 'aria-selected', 'true');
    cy.get(tid(`menu-product-${SEED.products.comGa}`)).should('not.exist');

    // Tải lại app vẫn đúng (danh mục đã lưu trên máy)
    cy.reload();
    cy.get(tid('sales-screen')).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('not.exist');
  });

  it('G37 (điện thoại): chủ sửa quầy trên điện thoại; quầy phải còn ít nhất một điểm bán', () => {
    cy.loginOwner();
    openSettings('profiles', SEED.tablets.A);
    cy.get(tid(`field-point_ids-${SEED.points.xoiA}`)).uncheck();
    cy.get(tid(`field-point_ids-${SEED.points.com}`)).uncheck();
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-error')).should('contain.text', 'ít nhất một điểm bán');
    cy.get(tid(`field-point_ids-${SEED.points.xoiA}`)).check();
    cy.get(tid('field-default_boxes')).clear().type('180');
    cy.get(tid('settings-save')).click();
    cy.get(tid('settings-saved')).should('be.visible');
    cy.task('db:profilePoints', 'A').should('deep.equal', [SEED.points.xoiA]);

    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.newOrder();
    cy.get(tid(`point-tab-${SEED.points.xoiA}`)).should('be.visible');
    cy.get(tid(`point-tab-${SEED.points.com}`)).should('not.exist');
  });
  it('G33: sửa đơn đã thanh toán của ca đã đóng ⇒ báo cáo ca "đã điều chỉnh", đối soát thay đổi, Telegram nhận tin', () => {
    cy.task('sim:openShift', { tablet: 'A', staff: 'Lan' });
    cy.task<Sold>('sim:sell', { tablet: 'A', product: 'xoiGa', qty: 2, method: 'cash' }).then((big) => {
      cy.task('sim:sell', { tablet: 'A', product: 'xoiXeo', method: 'cash' });
      // Đếm đủ: 500.000 + 50.000 + 15.000 ⇒ chênh lệch 0
      cy.task<string>('sim:close', { tablet: 'A', boxes: 197, plates: 60, cash: 565_000 }).then((shiftId) => {
        cy.loginOwner();
        cy.ownerNav('orders');
        cy.get(tid('orders-row')).should('have.length', 2);
        cy.get(`[data-testid=orders-row][data-id="${big.id}"]`).click();
        cy.get(tid('order-detail-total')).should('have.text', '50.000');
        cy.get(tid('order-edit')).click();

        // Chưa đổi gì thì không lưu được; ca đã đóng ⇒ báo trước sẽ tính lại
        cy.get(tid('edit-recalc-note')).should('be.visible');
        cy.get(tid('edit-problem')).should('have.text', 'Chưa thay đổi gì');
        cy.get(tid('edit-save')).should('be.disabled');

        // 2 → 1 phần, tiền mặt → chuyển khoản
        cy.get('[data-testid^=edit-line-][data-testid$=-minus]').click();
        cy.get(tid('edit-method-transfer')).click();
        cy.get(tid('edit-total-before')).should('have.text', '50.000');
        cy.get(tid('edit-total-after')).should('have.text', '25.000');
        cy.get(tid('edit-total-diff')).should('have.text', '−25.000');
        cy.get(tid('edit-save')).should('be.enabled').click();

        cy.get(tid('order-edit-saved')).should('be.visible');
        cy.get(tid('order-detail-status')).should('have.text', 'Đã thanh toán');
        cy.get(tid('order-detail-edited')).should('be.visible');
        cy.get(tid('order-detail-total')).should('have.text', '25.000');
        cy.get(tid('order-detail-method')).should('contain.text', 'Chuyển khoản');
        cy.get('[data-testid=log-row][data-action=owner_edit_order]').should('have.length', 1).and('contain.text', '50.000 → 25.000');

        // Telegram: trước / sau + ca đã đóng được tính lại
        cy.telegramWaitFor(`Chủ sửa đơn ${big.code}`).then((m) => {
          expect(m.text).to.contain('Trước: 50.000 · TM');
          expect(m.text).to.contain('Sau: 25.000 · CK');
          expect(m.text).to.contain('Ca đã đóng → đã tính lại: tiền mặt 0 → +50.000');
        });

        // Báo cáo ca: nhãn "đã điều chỉnh", đối soát tính lại (kỳ vọng giảm 50.000 ⇒ dư +50.000)
        cy.get(tid('order-detail-opened-shift')).click();
        cy.location('pathname').should('eq', `/owner/shifts/${shiftId}`);
        cy.get(tid('shift-adjusted')).should('be.visible');
        cy.get(tid('rep-revenue')).should('have.text', '40.000');
        cy.get(tid('rep-revenue-split')).should('have.text', 'TM 15.000 · CK 25.000 · Nợ 0');
        cy.get(tid('rep-cash-expected')).should('have.text', '515.000');
        cy.get(tid('rep-cash-counted')).should('have.text', '565.000');
        cy.get(tid('rep-cash-diff')).should('have.text', '+50.000').and('have.attr', 'data-alert', 'true');
        cy.get(tid('owner-back')).click();
        cy.get(tid(`shift-row-${shiftId}`)).should('contain.text', 'đã điều chỉnh');
        cy.task('db:reconcile', shiftId).its('cash').should('deep.equal', { expected: 515_000, counted: 565_000, diff: 50_000 });

        // Danh sách đơn + báo cáo cũng thấy
        cy.ownerVisit('/owner/orders');
        cy.get(`[data-testid=orders-row][data-id="${big.id}"]`).should('have.attr', 'data-method', 'transfer').find(tid('orders-row-edited')).should('exist');
        cy.ownerVisit('/owner/reports');
        cy.get(tid(`report-shift-${shiftId}-adjusted`)).should('be.visible');
        cy.get(tid(`report-shift-${shiftId}-cash-diff`)).should('have.text', 'Tiền mặt +50.000');
      });
    });
  });

  it('G34: dashboard realtime: tablet thanh toán ⇒ doanh thu trên điện thoại chủ tăng, không cần reload', () => {
    cy.task('sim:openShift', { tablet: 'A', staff: 'Lan' });
    cy.loginOwner();
    cy.window().then((w) => ((w as unknown as { __noReload: boolean }).__noReload = true));
    cy.get(tid('dash-live'), { timeout: 20_000 }).should('have.attr', 'data-state', 'live');
    cy.get(tid('dash-revenue')).should('have.text', '0');
    cy.get(tid('dash-shifts')).should('contain.text', 'Lan').and('contain.text', 'Tablet A');

    // Thời gian chờ ngắn hơn chu kỳ làm mới dự phòng (60 giây) ⇒ chỉ Realtime mới cập nhật kịp
    const live = { timeout: 10_000 };
    cy.task('sim:sell', { tablet: 'A', product: 'xoiGa', method: 'cash' });
    cy.get(tid('dash-revenue'), live).should('have.text', '25.000');
    cy.get(tid(`dash-point-${SEED.points.xoiA}-total`)).should('have.text', '25.000');
    cy.get(tid('dash-orders')).should('have.text', '1 đơn đã thu');

    cy.task('sim:sell', { tablet: 'A', product: 'comGa', point: 'com', method: 'transfer' });
    cy.get(tid('dash-revenue'), live).should('have.text', '60.000');
    cy.get(tid('dash-revenue-split')).should('have.text', 'Tiền mặt 25.000 · CK 35.000 · Ghi nợ 0');
    cy.get(tid(`dash-point-${SEED.points.com}-total`)).should('have.text', '35.000');
    cy.get(tid(`dash-point-${SEED.points.com}-transfer`)).should('have.text', 'CK 35.000');

    // Đơn mới đang chờ cũng hiện ngay
    cy.get(tid('dash-active-count')).should('have.text', '0');
    cy.task('sim:sell', { tablet: 'A', product: 'xoiXeo' });
    cy.get(tid('dash-active-count'), live).should('have.text', '1');

    cy.window().its('__noReload').should('eq', true);
  });

  it('G35: báo cáo theo nhân viên: tỷ lệ TM / CK / Nợ và số lần sửa / xóa khớp dữ liệu', () => {
    cy.task('scenario:staffReport');
    cy.loginOwner();
    cy.ownerNav('reports');
    cy.get(tid('report-today')).should('have.attr', 'aria-pressed', 'true');
    cy.get(tid('report-revenue')).should('have.text', '90.000');
    cy.get(tid('report-revenue-shares')).should('have.text', 'TM 28% · CK 50% · Nợ 22%');

    const staff = (k: keyof typeof SEED.staff, f: string) => tid(`report-staff-${SEED.staff[k]}-${f}`);
    cy.get(staff('Lan', 'total')).should('have.text', '60.000');
    cy.get(staff('Lan', 'shares')).should('have.text', '3 đơn · TM 42% · CK 25% · Nợ 33%');
    cy.get(staff('Lan', 'edits')).should('have.text', 'Sửa 1');
    cy.get(staff('Lan', 'deletes')).should('have.text', 'Xóa 1');

    cy.get(staff('Mai', 'total')).should('have.text', '30.000');
    cy.get(staff('Mai', 'shares')).should('have.text', '1 đơn · CK 100%');
    cy.get(staff('Mai', 'edits')).should('have.text', 'Sửa 2');
    cy.get(staff('Mai', 'deletes')).should('have.text', 'Xóa 1');

    cy.get(staff('Hung', 'total')).should('have.text', '0');
    cy.get(staff('Hung', 'shares')).should('have.text', '0 đơn');
    cy.get(staff('Hung', 'edits')).should('not.exist'); // 0 lần ⇒ không hiện chip

    // Đối chiếu chuyển khoản hôm nay
    cy.get(tid(`report-bank-${today()}-${SEED.points.xoiA}`)).should('have.text', '15.000');
    cy.get(tid(`report-bank-${today()}-${SEED.points.xoiB}`)).should('have.text', '30.000');
    cy.get(tid(`report-bank-${today()}-total`)).should('have.text', '45.000');
    cy.get(tid('report-top-row')).should('have.length', 4); // Xôi gà, xôi xéo, xôi pate, xôi thập cẩm

    // Khoảng ngày khác ⇒ không có số liệu
    cy.get(tid('report-custom')).click();
    cy.get(tid('report-from')).type('2020-01-01');
    cy.get(tid('report-to')).type('2020-01-02');
    cy.location('search').should('contain', 'from=2020-01-01').and('contain', 'to=2020-01-02');
    cy.get(tid('report-revenue')).should('have.text', '0');
    cy.get(staff('Lan', 'total')).should('have.text', '0');
    cy.get(staff('Lan', 'edits')).should('not.exist');
    cy.get(tid('report-today')).click();
    cy.get(staff('Lan', 'total')).should('have.text', '60.000');

    // Màn Đơn lọc theo nhân viên + hình thức cùng số liệu (có lọc nhân viên ⇒ ô lọc thêm tự mở)
    cy.ownerVisit(`/owner/orders?staff=${SEED.staff.Lan}&status=paid`);
    cy.get(tid('orders-tab-paid')).should('have.attr', 'aria-selected', 'true');
    cy.get(tid('orders-row')).should('have.length', 3);
    cy.get(tid('orders-sum')).should('have.text', '60.000');
    cy.get(tid('orders-filter-method')).select('transfer');
    cy.get(tid('orders-row')).should('have.length', 1);
    cy.get(tid('orders-sum')).should('have.text', '15.000');
    cy.get(tid('orders-tab-deleted')).click();
    cy.get(tid('orders-empty')).should('be.visible');
    cy.get(tid('orders-filter-method')).select('');
    cy.get(tid('orders-row')).should('have.length', 1).and('have.attr', 'data-status', 'deleted');
  });

  it('G36: nhật ký: lọc theo nhân viên và loại sự kiện ra đúng kết quả', () => {
    cy.task<Record<string, string>>('scenario:staffReport').then((ids) => {
      cy.loginOwner();
      cy.ownerNav('reports');
      // Từ báo cáo: số lần sửa của Mai ⇒ nhật ký đã lọc sẵn
      cy.get(tid(`report-staff-${SEED.staff.Mai}-edits`)).click();
      cy.location('pathname').should('eq', '/owner/log');
      cy.get(tid('log-filter-type')).should('have.value', 'order_update');
      cy.get(tid('log-filter-staff')).should('have.value', SEED.staff.Mai);
      cy.get(tid('log-row')).should('have.length', 2).each(($r) => {
        expect($r.attr('data-action')).to.eq('order_update');
        expect($r.attr('data-entity')).to.eq(ids.bDel);
        expect($r.find(tid('log-row-actor')).text()).to.eq('Mai – Tablet B');
      });

      cy.get(tid('log-filter-type')).select('order_delete');
      cy.get(`[data-testid=log-row][data-entity="${ids.bDel}"]`).should('contain.text', 'Bấm nhầm');
      cy.get(tid('log-row')).should('have.length', 1);

      cy.get(tid('log-filter-staff')).select(SEED.staff.Lan);
      cy.get(`[data-testid=log-row][data-entity="${ids.del}"]`).should('contain.text', 'ĐÃ RA MÓN');
      cy.get(tid('log-row')).should('have.length', 1);

      // Nhóm "Sửa & xóa đơn" của Lan: xóa (mới nhất) + sửa
      cy.get(tid('log-filter-type')).select('edits');
      cy.get(tid('log-row')).should(($r) => expect([...$r].map((r) => r.dataset.action)).to.deep.eq(['order_delete', 'order_update']));

      // Nhóm "Đơn" của Mai: tạo / sửa / thu / xóa, không lẫn của Lan
      cy.get(tid('log-filter-staff')).select(SEED.staff.Mai);
      cy.get(tid('log-filter-type')).select('orders');
      cy.get(tid('log-row')).should('have.length', 6).then(($r) => {
        const actions = [...$r].map((r) => r.dataset.action);
        expect(actions.filter((a) => a === 'order_create')).to.have.length(2);
        expect(actions.filter((a) => a === 'order_update')).to.have.length(2);
        expect(actions.filter((a) => a === 'order_pay')).to.have.length(1);
        expect(actions.filter((a) => a === 'order_delete')).to.have.length(1);
        expect($r.text()).not.to.contain('Lan');
      });

      // Thu / ghi nợ: nhóm Nợ không có của Mai; Hùng không có gì
      cy.get(tid('log-filter-type')).select('debts');
      cy.get(tid('log-empty')).should('be.visible');
      cy.get(tid('log-filter-type')).select('');
      cy.get(tid('log-filter-staff')).select(SEED.staff.Hung);
      cy.get(tid('log-empty')).should('be.visible');
    });
  });

  it('Đơn: lọc theo ngày, điểm bán, tab Chờ, tìm kiếm; tổng đã thu đổi theo bộ lọc', () => {
    cy.task('sim:openShift', { tablet: 'A', staff: 'Lan' });
    cy.task('sim:sell', { tablet: 'A', product: 'xoiGa', method: 'cash' }); // 25.000, Xôi A
    cy.task('sim:sell', { tablet: 'A', product: 'comGa', point: 'com', method: 'transfer' }); // 35.000, Cơm gà
    cy.task<Sold>('sim:sell', { tablet: 'A', product: 'xoiXeo' }).as('waiting'); // đang chờ
    cy.task<Sold>('sim:sell', { tablet: 'A', product: 'xoiPate', method: 'cash' }).then((o) => cy.task('db:moveOrderDays', { id: o.id, days: 2 })); // 20.000, 2 ngày trước
    const twoDaysAgo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() - 2 * 86_400_000));

    cy.loginOwner();
    cy.ownerNav('orders');
    // Mặc định: hôm nay, mọi điểm
    cy.get(tid('orders-filter-date')).should('have.value', today());
    cy.get(tid('orders-row')).should('have.length', 3);
    cy.get(tid('orders-sum')).should('have.text', '60.000');

    // Tab Chờ: chỉ đơn chưa thu
    cy.get(tid('orders-tab-waiting')).click();
    cy.get<Sold>('@waiting').then((w) => cy.get(tid('orders-row')).should('have.length', 1).and('have.attr', 'data-id', w.id));
    cy.get(tid('orders-tab-all')).click();

    // Điểm Cơm gà
    cy.get(tid('orders-filter-point')).select(SEED.points.com);
    cy.location('search').should('contain', `point=${SEED.points.com}`);
    cy.get(tid('orders-row')).should('have.length', 1).and('have.attr', 'data-method', 'transfer');
    cy.get(tid('orders-sum')).should('have.text', '35.000');
    cy.get(tid('orders-filter-point')).select('');

    // Tìm theo tên món / mã đơn
    cy.get(tid('orders-search')).type('xéo');
    cy.get(tid('orders-row')).should('have.length', 1).and('have.attr', 'data-status', 'open');
    cy.get<Sold>('@waiting').then((w) => {
      cy.get(tid('orders-search')).clear().type(w.code);
      cy.get(tid('orders-row')).should('have.length', 1).and('have.attr', 'data-id', w.id);
    });
    cy.get(tid('orders-search')).clear();

    // Ngày khác: chỉ đơn của ngày đó
    cy.get(tid('orders-filter-date')).type(twoDaysAgo);
    cy.location('search').should('contain', `date=${twoDaysAgo}`);
    cy.get(tid('orders-row')).should('have.length', 1).and('contain.text', 'Xôi pate');
    cy.get(tid('orders-sum')).should('have.text', '20.000');
    cy.get(tid('orders-summary')).should('contain.text', `${twoDaysAgo.slice(8)}/${twoDaysAgo.slice(5, 7)}`);

    // Bỏ ngày ⇒ mọi ngày
    cy.get(tid('orders-filter-date')).clear();
    cy.get(tid('orders-summary')).should('contain.text', 'Mọi ngày');
    cy.get(tid('orders-row')).should('have.length', 4);
    cy.get(tid('orders-sum')).should('have.text', '80.000');
  });
});
