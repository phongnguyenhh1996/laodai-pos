import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Test DB/RLS/RPC: cần `supabase start` (Docker). Mỗi file tự reset + seed.
export default defineConfig({
  // Test tích hợp dùng thẳng lớp offline của tablet (src/sync).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
