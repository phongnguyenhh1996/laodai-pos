// E. Kịch bản gian lận (mục 10.4). Bước 2: E27; các kịch bản khác bổ sung ở bước 5–9.

interface Ids {
  open: string;
  paid: string;
  deleted: string;
}

describe('E. Kịch bản gian lận', () => {
  beforeEach(() => {
    cy.resetAll();
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
