import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)) });

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Thiếu biến môi trường ${k} (chạy \`npx supabase start\` rồi xem .env.example)`);
  return v;
}

export const ENV = {
  get url() { return need('VITE_SUPABASE_URL'); },
  get anonKey() { return need('VITE_SUPABASE_ANON_KEY'); },
  get serviceKey() { return need('SUPABASE_SERVICE_ROLE_KEY'); },
  get dbUrl() { return need('SUPABASE_DB_URL'); },
  get telegramMock() { return process.env.TELEGRAM_MOCK_URL ?? 'http://localhost:8787'; },
};
