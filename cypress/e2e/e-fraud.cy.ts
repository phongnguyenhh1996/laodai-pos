import { SEED } from '../../tests/support/seed-ids';

// E. Kịch bản gian lận (mục 10.4). Bước 2: E27; bước 7: E23, E25; các kịch bản khác ở bước 8–10.

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
    cy.get(tid('owner-nav-shifts')).click();
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

  it('E23: đếm thiếu tiền: đóng ca nhập ít hơn kỳ vọng 20.000 ⇒ Telegram báo chênh lệch −20.000, nhân viên không thấy', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sell({ combo: 'xoiGaTrung' }); // 31.000
    sell({ combo: 'xoiXeoChaRuoc' }); // 28.000 ⇒ kỳ vọng 500.000 + 59.000 = 559.000
    closeShift(198, 60, '539.000');

    // Nhân viên: chỉ "Đã đóng ca", không có số nào để "đếm cho khớp"
    cy.get('body').invoke('text').then((text) => {
      for (const n of ['559.000', '20.000', '−']) expect(text).not.to.contain(n);
    });
    cy.waitSynced();
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

  it('E25: dùng hộp không có đơn: đóng ca khai còn ít hộp hơn số đơn tương ứng ⇒ báo cáo hiện chênh lệch hộp', () => {
    cy.activateTablet('A');
    cy.openShift('Lan');
    sell({ combo: 'xoiGaTrung' }); // mang về: 1 hộp
    sell({ combo: 'xoiXeoChaRuoc' }); // mang về: 1 hộp
    sell({ point: 'com', product: 'comGa' }); // cơm tại chỗ: 0 hộp, 1 dĩa
    // 200 hộp đầu ca, theo đơn chỉ dùng 2 nhưng còn 190 ⇒ dùng 10, thừa 8 hộp không có đơn
    closeShift(190, 59, '594.000'); // tiền đủ: 500.000 + 31.000 + 28.000 + 35.000
    cy.get('body').should('not.contain.text', 'theo đơn');
    cy.waitSynced();

    cy.telegramWaitFor('Đóng ca – Lan').its('text').should('contain', 'Hộp: dùng 10 / theo đơn 2 → +8').and('contain', 'Dĩa: dùng 1 / theo đơn 1');
    ownerOpensOnlyShift();
    cy.get(tid('rep-boxes-supply')).should('have.text', '200 + 0 = 200');
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
