import { defineConfig } from 'cypress';
import { resetDb } from './tests/support/db';
import { telegramClear, telegramMessages } from './tests/support/telegram';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4173',
    viewportWidth: 1280,
    viewportHeight: 800,
    video: true,
    screenshotOnRunFailure: true,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    setupNodeEvents(on) {
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
      });
    },
  },
});
