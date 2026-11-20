import type { CapacitorConfig } from '@capacitor/cli';

/**
 * App Android cho tablet quầy (SPEC 12.1): mở thẳng web production trên Vercel, nên push `main` thì tablet tự cập nhật.
 * Chỉ khi đổi phần native (plugin máy in, quyền, cấu hình này) mới phải build + cài lại APK.
 * Build thử với bản local: CAP_SERVER_URL=http://192.168.1.10:5173 npm run android:sync
 */
const config: CapacitorConfig = {
  appId: 'vn.laodai.pos',
  appName: 'Laodai POS',
  webDir: 'dist',
  server: {
    url: process.env.CAP_SERVER_URL ?? 'https://laodai-pos.vercel.app',
    cleartext: Boolean(process.env.CAP_SERVER_URL?.startsWith('http://')),
    androidScheme: 'https',
  },
  android: {
    // WebView cũ (Chrome 90+) vẫn chạy được.
    minWebViewVersion: 90,
  },
};

export default config;
