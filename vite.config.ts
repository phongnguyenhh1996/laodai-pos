/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Laodai POS',
        short_name: 'Laodai',
        lang: 'vi',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#fafaf9',
        theme_color: '#b45309',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallback: '/index.html' },
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
      include: ['src/domain/**', 'src/sync/**'],
      exclude: ['**/*.test.ts', '**/index.ts', 'src/domain/types.ts', 'src/domain/fixtures.ts'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
