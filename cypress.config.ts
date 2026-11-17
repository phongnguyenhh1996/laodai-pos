import { defineConfig } from 'cypress';
import { resetDb, tabletClient } from './tests/support/db';
import { ENV } from './tests/support/env';
import { TabletSim, item } from './tests/support/ops';
import { SEED } from './tests/support/seed-ids';
import { telegramClear, telegramMessages, waitForMessage } from './tests/support/telegram';

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
      });
      return config;
    },
  },
});
