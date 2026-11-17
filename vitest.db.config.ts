import { defineConfig } from 'vitest/config';

// Test DB/RLS/RPC: cần `supabase start` (Docker). Mỗi file tự reset + seed.
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
