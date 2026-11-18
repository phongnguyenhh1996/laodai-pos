/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';

/** Phiên bản của bản build: commit (Vercel cấp sẵn) + giờ build. Ghi vào bundle và /version.json. */
function appVersion(): string {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  const at = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${sha}-${at}`;
}
const APP_VERSION = appVersion();

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    {
      // App tự hỏi /version.json (không cache) để biết có bản mới, không phụ thuộc service worker.
      name: 'laodai-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) });
      },
    },
    VitePWA({
      // 'prompt': bản mới chờ sẵn, nhân viên bấm "Tải lại" trên banner (UpdateBanner) — không tự reload giữa lúc lên đơn.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Laodai POS',
        short_name: 'Laodai',
        lang: 'vi',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f3f5f8',
        theme_color: '#c2410c',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html', globPatterns: ['**/*.{js,css,html,svg,woff2}'] },
    }),
  ],
  build: { target: 'chrome90' },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/pos/**'],
      exclude: ['**/*.test.ts', '**/index.ts', 'src/domain/types.ts', 'src/domain/fixtures.ts', 'src/pos/types.ts'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
