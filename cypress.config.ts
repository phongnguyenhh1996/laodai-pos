import { defineConfig } from 'cypress';
import { resetDb, sql, tabletClient } from './tests/support/db';
import { ENV } from './tests/support/env';
import { TabletSim, item, push, type TestItem } from './tests/support/ops';
import { SEED } from './tests/support/seed-ids';
import { telegramClear, telegramMessages, waitForMessage } from './tests/support/telegram';

// Trạng thái kịch bản G32 giữa các task (tablet giả lập phía server).
let g32: { sim: TabletSim; orderId: string; line: TestItem } | null = null;

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4173',
    viewportWidth: 1280,
    viewportHeight: 800,
    video: true,
    screenshotOnRunFailure: true,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    setupNodeEvents(on, config) {
      // Chỉ URL + anon key (công khai, đã có trong bundle) cho cy.request; service key không ra khỏi Node.
      config.env.SUPABASE_URL = ENV.url;
      config.env.SUPABASE_ANON_KEY = ENV.anonKey;

      on('task', {
        'db:reset': async () => {
          await resetDb();
          return null;
        },
        'telegram:clear': async () => {
          await telegramClear();
          return null;
        },
        'telegram:messages': () => telegramMessages(),
        /** Chờ tới khi có tin chứa đoạn chữ (pg_net + Edge Function chạy bất đồng bộ). */
        'telegram:waitFor': (text: string) => waitForMessage((m) => m.text.includes(text)),
        /** Dữ liệu phía server cho kịch bản gọi API trực tiếp: 1 đơn mở, 1 đơn đã thanh toán, 1 đơn đã xóa. */
        'scenario:tabletOrders': async (tablet: keyof typeof SEED.tablets) => {
          const sim = new TabletSim(await tabletClient(SEED.tablets[tablet]), SEED.tablets[tablet]);
          await sim.openShift('Lan');
          const open = await sim.createOrder([item('xoiGa')]);
          const paid = await sim.createOrder([item('xoiXeo')]);
          const deleted = await sim.createOrder([item('xoiPate')]);
          await sim.pay(paid.id, paid.total);
          await sim.del(deleted.id);
          return { open: open.id, paid: paid.id, deleted: deleted.id };
        },
        /** G32: tablet A có một đơn đang mở (1 Xôi gà, giá lúc tạo 25.000). */
        'g32:openOrder': async () => {
          const sim = new TabletSim(await tabletClient(SEED.tablets.A), SEED.tablets.A);
          await sim.openShift('Lan');
          const line = item('xoiGa');
          const o = await sim.createOrder([line]);
          if (o.result.status !== 'ok') throw new Error(`tạo đơn: ${JSON.stringify(o.result)}`);
          g32 = { sim, orderId: o.id, line };
          return o.id;
        },
        /** G32 sau khi chủ đổi giá: đơn đang mở giữ giá cũ, đơn mới phải dùng giá mới. */
        'g32:afterPriceChange': async (newPrice: number) => {
          if (!g32) throw new Error('chưa chạy g32:openOrder');
          const { sim, orderId, line } = g32;
          const [snap] = await sql<{ unit_price_snap: number }>(
            'select unit_price_snap from order_items where order_id = $1 and removed_at is null',
            [orderId],
          );
          const editOld = await sim.update(orderId, [{ ...line, qty: 2 }]);
          const [edited] = await sql<{ total: number }>('select total from orders where id = $1', [orderId]);
          const late = sim.createOrderOp([item('xoiGa')]);
          late.op.performed_at = new Date().toISOString();
          const newWithOldPrice = await push(sim.c, late.op);
          const newWithNewPrice = await sim.createOrder([{ ...item('xoiGa'), unit_price_snap: newPrice }]);
          return {
            openSnap: snap.unit_price_snap,
            editOld: editOld.status,
            editedTotal: edited.total,
            newWithOldPrice: newWithOldPrice.status,
            newWithNewPrice: newWithNewPrice.result.status,
          };
        },
        /** Các ca của tablet trên server (cũ trước), kèm tên nhân viên. */
        'db:shifts': (tablet: keyof typeof SEED.tablets) =>
          sql(
            `select s.id, st.name as staff_name, s.status, s.open_boxes, s.open_plates, s.open_float,
                    s.close_boxes_left, s.close_plates_left, s.close_cash_counted
               from shifts s join staff st on st.id = s.staff_id
              where s.tablet_profile_id = $1 order by s.opened_at`,
            [SEED.tablets[tablet]],
          ),
        /** Số mặc định đầu ca của hồ sơ tablet. */
        'db:profileDefaults': async (tablet: keyof typeof SEED.tablets) => {
          const [r] = await sql('select default_boxes, default_plates, default_float from tablet_profiles where id = $1', [SEED.tablets[tablet]]);
          return r;
        },
        /** Đơn của tablet trên server (theo device_seq), kèm dòng đơn còn hiệu lực. */
        'db:orders': (tablet: keyof typeof SEED.tablets) =>
          sql(
            `select o.id, o.device_seq, o.code, o.point_id, o.dine_type, o.status, o.total, o.label,
                    o.payment_method, o.cash_given, o.opened_shift_id, o.paid_shift_id,
                    o.served_at is not null as served, o.delete_reason,
                    coalesce((select json_agg(json_build_object('product_id', i.product_id, 'qty', i.qty,
                                'unit_price_snap', i.unit_price_snap, 'toppings', i.toppings_snap) order by i.sort)
                                from order_items i where i.order_id = o.id and i.removed_at is null), '[]') as items
               from orders o where o.tablet_profile_id = $1 order by o.device_seq`,
            [SEED.tablets[tablet]],
          ),
        /** Đóng ca đang mở của tablet bằng tablet giả lập phía server (khi máy thật đã bị xóa để giả lập điện thoại chủ). */
        'sim:closeShift': async ({ tablet, boxes, plates, cash }: { tablet: keyof typeof SEED.tablets; boxes: number; plates: number; cash: number }) => {
          const [s] = await sql<{ id: string }>("select id from shifts where tablet_profile_id = $1 and status = 'open'", [SEED.tablets[tablet]]);
          if (!s) throw new Error('không có ca đang mở');
          const sim = new TabletSim(await tabletClient(SEED.tablets[tablet]), SEED.tablets[tablet]);
          sim.shiftId = s.id;
          const r = await sim.closeShift(boxes, plates, cash);
          if (r.status !== 'ok') throw new Error(`đóng ca: ${JSON.stringify(r)}`);
          return s.id;
        },
        /** Hồ sơ tablet đang lưu trên server. */
        'db:profilePoints': async (tablet: keyof typeof SEED.tablets) => {
          const [r] = await sql<{ point_ids: string[] }>('select point_ids from tablet_profiles where id = $1', [SEED.tablets[tablet]]);
          return r.point_ids;
        },
      });
      return config;
    },
  },
});
