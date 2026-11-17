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
