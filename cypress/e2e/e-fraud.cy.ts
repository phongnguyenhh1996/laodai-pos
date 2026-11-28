import { SEED } from '../../tests/support/seed-ids';

// E. Kịch bản gian lận (mục 10.4). Bước 2: E27; bước 7: E23, E25; bước 8: E21, E22; bước 9: E24; E26 ở bước 10.

const tid = (id: string) => `[data-testid=${id}]`;

/** Bán một combo / món trên tablet và thu đủ tiền mặt. */
function sell(opts: { combo?: keyof typeof SEED.combos; product?: keyof typeof SEED.products; point?: keyof typeof SEED.points }) {
  cy.get(tid('new-order')).click();
  if (opts.point) cy.get(tid(`point-tab-${SEED.points[opts.point]}`)).click();
  if (opts.combo) cy.get(tid(`menu-combo-${SEED.combos[opts.combo]}`)).click();
  if (opts.product) {
    cy.get(tid(`menu-product-${SEED.products[opts.product]}`)).click();
    cy.get(tid('topping-add')).click();
  }
  cy.get(tid('order-pay-exact')).click();
  cy.get(tid('queue-flash')).should('be.visible');
}

/** Bán một combo nhưng bấm "Chuyển khoản" (E24: thực ra khách trả tiền mặt). */
function sellAsTransfer(combo: keyof typeof SEED.combos, point?: keyof typeof SEED.points) {
  cy.get(tid('new-order')).click();
  if (point) cy.get(tid(`point-tab-${SEED.points[point]}`)).click();
  cy.get(tid(`menu-combo-${SEED.combos[combo]}`)).click();
  cy.get(tid('order-pay-transfer')).click();
  cy.get(tid('pay-transfer-confirm')).click();
  cy.get(tid('queue-flash')).should('be.visible');
}

/** Đóng ca đếm mù trên tablet. */
function closeShift(boxes: number, plates: number, cash: string) {
  cy.get(tid('open-close-shift')).click();
  cy.get(tid('close-boxes')).type(String(boxes));
  cy.get(tid('close-plates')).type(String(plates));
  cy.get(tid('close-cash')).type(cash);
  cy.get(tid('close-review')).click();
  cy.get(tid('close-confirm')).click();
  cy.get(tid('shift-closed')).should('be.visible');
}

/** Chủ (điện thoại) mở báo cáo ca duy nhất của tablet A. */
function ownerOpensOnlyShift() {
  cy.task<Array<{ id: string }>>('db:shifts', 'A').then(([shift]) => {
    cy.loginOwner();
    cy.ownerNav('shifts');
    cy.get(tid(`shift-row-${shift.id}`)).click();
    cy.get(tid('shift-report')).should('have.attr', 'data-status', 'closed');
  });
}

interface Ids {
  open: string;
  paid: string;
  deleted: string;
}

describe('E. Kịch bản gian lận', () => {
  beforeEach(() => {
    cy.resetAll();
  });

  it('E21: ra món, thu tiền rồi xóa đơn ⇒ Telegram có trạng thái "đã ra món"; báo cáo ca liệt kê bao bì của đơn bị xóa sau khi ra món', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    cy.get(tid('order-serve')).click();
    cy.get('[data-testid^=queue-code-]').invoke('text').then((code) => {
      cy.get('[data-testid^=queue-open-]').click();
      cy.get(tid('order-delete')).click();
      cy.get(tid('delete-reason-customer_left')).click();
      cy.get(tid('queue-empty')).should('be.visible');
      cy.waitLive();

      // Telegram ngay khi xóa: nội dung đơn + trạng thái lúc xóa + link mở thẳng chi tiết đơn
      cy.telegramWaitFor(`🗑 Xóa đơn ${code}`).then((m) => {
        expect(m.text).to.contain('Lý do: Khách bỏ về');
        expect(m.text).to.contain('Trạng thái lúc xóa: ⚠️ ĐÃ RA MÓN');
        expect(m.text).to.contain('1× Xôi gà (+Trứng) — 31.000');
        const link = /🔗 (\S+)/.exec(m.text)![1];
        const path = new URL(link).pathname;
        expect(path).to.match(/^\/owner\/orders\//);

        closeShift(199, 60, '500');
        cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', `Bao bì của đơn bị xóa sau khi ra món: ${code} (1 hộp)`);

        // Chủ mở link trong tin: chi tiết đơn + nhật ký của đơn
        cy.loginOwner();
        cy.ownerVisit(path);
        cy.get(tid('order-detail-status')).should('have.text', 'Đã xóa');
        cy.get(tid('order-detail-times')).should('contain.text', 'Khách bỏ về').and('contain.text', 'Ra món');
        cy.get('[data-testid=log-row][data-action=order_delete]').should('contain.text', 'Lý do: Khách bỏ về · đã ra món → đã xóa');
        cy.get('[data-testid=log-row]').then(($r) => expect([...$r].map((r) => r.dataset.action)).to.deep.eq(['order_delete', 'order_serve', 'order_create']));

        // Báo cáo ca: mục bao bì của đơn bị xóa sau khi ra món
        cy.task<Array<{ id: string }>>('db:shifts', 'A').then(([shift]) => {
          cy.ownerVisit(`/owner/shifts/${shift.id}`);
          cy.get(tid('rep-deleted')).should('contain.text', 'Đơn đã xóa (1 ra món)').find('b').should('have.text', '1');
          cy.get(tid('rep-deleted-after-served')).should('have.text', `${code} (1 hộp)`);
        });
      });
    });
  });

  it('E22: bớt món sau khi ra món (2 phần → 1) ⇒ nhật ký có bản trước / sau, báo cáo đếm số lần sửa của nhân viên đó', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    cy.get(tid('new-order')).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click();
    cy.get(tid(`menu-combo-${SEED.combos.xoiGaTrung}`)).click(); // 2 phần
    cy.get(tid('order-total')).should('have.text', '62.000');
    cy.get(tid('order-serve')).click();
    cy.get('[data-testid^=queue-open-]').click();
    cy.get('[data-testid$=-minus]').click();
    cy.get(tid('order-total')).should('have.text', '31.000');
    cy.get(tid('order-back')).click(); // đơn đã lưu tự lưu khi rời màn
    cy.get(tid('queue-screen')).should('be.visible');
    cy.waitLive();
    // Sửa món chỉ ghi nhật ký, không báo Telegram
    cy.telegramMessages().then((ms) => expect(ms.map((m) => m.text).join('\n')).not.to.contain('Sửa'));

    cy.task<Array<{ id: string }>>('db:shifts', 'A').then(([shift]) => {
      cy.loginOwner();
      cy.ownerVisit(`/owner/shifts/${shift.id}`);
      cy.get(tid('rep-edits')).should('contain.text', 'Sửa đơn đang mở').find('b').should('have.text', '1');
      cy.get(tid('rep-edits')).click();
      // Nhật ký lọc sẵn: sửa & xóa của Lan
      cy.location('search').should('contain', 'type=edits').and('contain', `staff=${SEED.staff.Lan}`);
      cy.get(tid('log-filter-type')).should('have.value', 'edits');
      cy.get(tid('log-filter-staff')).should('have.value', SEED.staff.Lan);
      cy.get(tid('log-row')).should('have.length', 1).first().as('row');
      cy.get('@row').should('have.attr', 'data-action', 'order_update');
      cy.get('@row').find(tid('log-row-actor')).should('contain.text', 'Lan – Tablet A');
      cy.get('@row').find(tid('log-row-line')).then(($l) =>
        expect([...$l].map((l) => l.textContent)).to.deep.eq(['Món: 2× Xôi gà (Trứng) → 1× Xôi gà (Trứng)', 'Tổng: 62.000 → 31.000']),
      );
      // Lọc theo nhân viên khác ⇒ không có
      cy.get(tid('log-filter-staff')).select(SEED.staff.Mai);
      cy.get(tid('log-empty')).should('be.visible');
      // Mọi loại của Lan hôm nay: mở ca, tạo, ra món, sửa
      cy.get(tid('log-filter-staff')).select(SEED.staff.Lan);
      cy.get(tid('log-filter-type')).select('');
      cy.get(tid('log-filter-date')).type(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()));
      cy.get(tid('log-row')).then(($r) =>
        expect([...$r].map((r) => r.dataset.action)).to.deep.eq(['order_update', 'order_serve', 'order_create', 'shift_open']),
      );
      cy.get(tid('log-filter-date')).clear().type('2020-01-01');
      cy.get(tid('log-empty')).should('be.visible');
    });
  });

  it('E23: đếm thiếu tiền: đóng ca nhập ít hơn kỳ vọng 20.000 ⇒ Telegram báo chênh lệch −20.000, nhân viên không thấy', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sell({ combo: 'xoiGaTrung' }); // 31.000
    sell({ combo: 'xoiXeoChaRuoc' }); // 28.000 ⇒ kỳ vọng 500.000 + 59.000 = 559.000
    closeShift(198, 60, '539');

    // Nhân viên: chỉ "Đã đóng ca", không có số nào để "đếm cho khớp"
    cy.get('body').invoke('text').then((text) => {
      for (const n of ['559.000', '20.000', '−']) expect(text).not.to.contain(n);
    });
    cy.waitLive();
    // Kể cả gọi API trực tiếp bằng token tablet cũng không đọc được kỳ vọng / chênh lệch
    cy.storedAccessToken().then((token) => {
      cy.task<Array<{ id: string }>>('db:shifts', 'A').then(([shift]) => {
        const api = Cypress.env('SUPABASE_URL') as string;
        const headers = { apikey: Cypress.env('SUPABASE_ANON_KEY') as string, Authorization: `Bearer ${token}` };
        cy.request({ method: 'POST', url: `${api}/rest/v1/rpc/reconcile_shift`, headers, body: { p_shift: shift.id }, failOnStatusCode: false })
          .its('status')
          .should('be.gte', 400);
        cy.request({ url: `${api}/rest/v1/shifts?select=*&id=eq.${shift.id}`, headers }).its('body').should('have.length', 0);
      });
    });

    // Chủ: Telegram + báo cáo ca
    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'Tiền mặt: đếm 539.000 / kỳ vọng 559.000 → −20.000');
    ownerOpensOnlyShift();
    cy.get(tid('rep-cash-expected')).should('have.text', '559.000');
    cy.get(tid('rep-cash-counted')).should('have.text', '539.000');
    cy.get(tid('rep-cash-diff')).should('have.text', '−20.000').and('have.attr', 'data-alert', 'true');
  });

  it('E24: ghi chuyển khoản nhưng thực ra nhận tiền mặt ⇒ tổng CK theo ngày / điểm hiển thị đúng để chủ so với app ngân hàng', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    cy.activateTablet('A');
    cy.openShift('Lan');
    sellAsTransfer('xoiGaTrung'); // 31.000: khách đưa tiền mặt, Lan bấm "chuyển khoản"
    sell({ combo: 'xoiXeoChaRuoc' }); // 28.000 tiền mặt
    sellAsTransfer('comGaCanh', 'com'); // 40.000 chuyển khoản thật
    cy.waitLive();

    // Chủ: dashboard tách CK theo điểm
    cy.loginOwner();
    cy.get(tid('dash-revenue')).should('have.text', '99.000');
    cy.get(tid('dash-revenue-split')).should('have.text', 'Tiền mặt 28.000 · CK 71.000 · Ghi nợ 0');
    cy.get(tid(`dash-point-${SEED.points.xoiA}-transfer`)).should('have.text', 'CK 31.000');
    cy.get(tid(`dash-point-${SEED.points.com}-transfer`)).should('have.text', 'CK 40.000');

    // Báo cáo: đối chiếu chuyển khoản theo ngày / điểm
    cy.ownerNav('reports');
    cy.get(tid(`report-bank-day-${today}`)).should('be.visible');
    cy.get(tid(`report-bank-${today}-${SEED.points.xoiA}`)).should('have.text', '31.000');
    cy.get(tid(`report-bank-${today}-${SEED.points.com}`)).should('have.text', '40.000');
    cy.get(tid(`report-bank-${today}-total`)).should('have.text', '71.000');
    cy.get(tid(`report-bank-${today}-debt`)).should('not.exist');
    cy.get(tid(`report-staff-${SEED.staff.Lan}-shares`)).should('contain.text', 'TM 28% · CK 72%');

    // App ngân hàng chỉ có 40.000 ⇒ chủ lọc đơn CK của Xôi A hôm nay: ra đúng đơn bị ghi sai và người thu
    cy.ownerVisit(`/owner/orders?method=transfer&point=${SEED.points.xoiA}`);
    cy.get(tid('orders-row')).should('have.length', 1).first().as('row');
    cy.get('@row').find(tid('orders-row-total')).should('have.text', '31.000');
    cy.get('@row').find(tid('orders-row-who')).should('contain.text', 'Thu: Lan');
    cy.get(tid('orders-sum')).should('have.text', '31.000');
  });

  it('E25: dùng hộp không có đơn: đóng ca khai còn ít hộp hơn số đơn tương ứng ⇒ báo cáo hiện chênh lệch hộp', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sell({ combo: 'xoiGaTrung' }); // mang về: 1 hộp
    sell({ combo: 'xoiXeoChaRuoc' }); // mang về: 1 hộp
    sell({ point: 'com', product: 'comGa' }); // cơm tại chỗ: 0 hộp, 1 dĩa
    // 200 hộp đầu ca, theo đơn chỉ dùng 2 nhưng còn 190 ⇒ dùng 10, thừa 8 hộp không có đơn
    closeShift(190, 59, '594'); // tiền đủ: 500.000 + 31.000 + 28.000 + 35.000
    cy.get('body').should('not.contain.text', 'theo đơn');
    cy.waitLive();

    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'Hộp: dùng 10 / theo đơn 2 → +8').and('contain', 'Dĩa: dùng 1 / theo đơn 1');
    ownerOpensOnlyShift();
    cy.get(tid('rep-boxes-supply')).should('have.text', '200 + 0');
    cy.get(tid('rep-boxes-left')).should('have.text', '190');
    cy.get(tid('rep-boxes')).should('have.text', '10 / 2');
    cy.get(tid('rep-boxes-diff')).should('have.text', '+8').and('have.attr', 'data-alert', 'true');
    cy.get(tid('rep-plates')).should('have.text', '1 / 1');
    cy.get(tid('rep-plates-diff')).should('have.text', '0').and('not.have.attr', 'data-alert');
    cy.get(tid('rep-cash-diff')).should('have.text', '0');
  });

  it('E27: gọi API trực tiếp bằng token tablet để đọc đơn đã thanh toán ⇒ 0 dòng hoặc 401/403', () => {
    cy.task<Ids>('scenario:tabletOrders', 'A').then((ids) => {
      cy.activateTablet('A');
      cy.storedAccessToken().then((token) => {
        const api = Cypress.env('SUPABASE_URL') as string;
        const headers = { apikey: Cypress.env('SUPABASE_ANON_KEY') as string, Authorization: `Bearer ${token}` };
        const get = (path: string) => cy.request({ url: `${api}/rest/v1/${path}`, headers, failOnStatusCode: false });
        const noRows = (r: Cypress.Response<unknown[]>) => {
          if (r.status === 200) expect(r.body, r.requestHeaders?.url as string).to.have.length(0);
          else expect(r.status).to.be.oneOf([401, 403]);
        };

        // Token hợp lệ: thấy đúng đơn đang mở của mình (đối chứng)
        get('orders?select=id,status').then((r) => {
          expect(r.status).to.eq(200);
          expect((r.body as Array<{ id: string }>).map((o) => o.id)).to.deep.eq([ids.open]);
        });

        // Không lấy được doanh thu dưới bất kỳ dạng nào
        get('orders?select=*&status=eq.paid').then(noRows);
        get(`orders?select=*&id=eq.${ids.paid}`).then(noRows);
        get(`orders?select=*&id=eq.${ids.deleted}`).then(noRows);
        get(`order_items?select=*&order_id=in.(${ids.paid},${ids.deleted})`).then(noRows);
        get('audit_log?select=*').then(noRows);
        get('notifications?select=*').then(noRows);
        get('debt_payments?select=*').then(noRows);

        // RPC báo cáo của chủ bị từ chối
        cy.request({
          method: 'POST',
          url: `${api}/rest/v1/rpc/owner_report`,
          headers,
          body: { p_from: '2020-01-01', p_to: '2100-01-01' },
          failOnStatusCode: false,
        })
          .its('status')
          .should('be.gte', 400);

        // Không sửa được đơn đã thanh toán qua UPDATE trực tiếp
        cy.request({
          method: 'PATCH',
          url: `${api}/rest/v1/orders?id=eq.${ids.paid}`,
          headers: { ...headers, Prefer: 'return=representation' },
          body: { total: 1 },
          failOnStatusCode: false,
        }).then((r) => {
          if (r.status < 300) expect(r.body).to.have.length(0);
          else expect(r.status).to.be.gte(400);
        });
      });
    });
  });
});
