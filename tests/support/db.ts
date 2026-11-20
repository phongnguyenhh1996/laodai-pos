// Tiện ích dùng chung cho test DB (Vitest) và Cypress task: reset + seed, tạo phiên chủ / tablet.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ENV } from './env';
import { SEED } from './seed-ids';

const SEED_SQL = readFileSync(fileURLToPath(new URL('../../supabase/seed.sql', import.meta.url)), 'utf8');

const BUSINESS_TABLES = [
  'print_jobs', 'print_template', 'live_pulse', 'owner_device_pins', 'owner_mode_devices', 'notifications', 'seq_gaps', 'sync_ops', 'audit_log', 'debt_payments', 'order_items', 'orders', 'customers',
  'shift_adjustments', 'shifts', 'price_history', 'combos', 'toppings', 'products', 'tablet_profiles', 'points',
  'menus', 'staff', 'settings',
];

export async function withPg<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ENV.dbUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Xóa sạch dữ liệu nghiệp vụ + người dùng auth rồi chạy lại seed.sql (nhanh hơn `supabase db reset`). */
export async function resetDb(): Promise<void> {
  await withPg(async (c) => {
    await c.query(`truncate ${BUSINESS_TABLES.map((t) => `public.${t}`).join(', ')}, private.config restart identity cascade`);
    await c.query('truncate auth.users cascade');
    await c.query(SEED_SQL);
  });
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return withPg(async (c) => (await c.query<T>(text, params)).rows);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): SupabaseClient {
  return createClient(ENV.url, ENV.anonKey, opts);
}

export function serviceClient(): SupabaseClient {
  return createClient(ENV.url, ENV.serviceKey, opts);
}

export async function ownerClient(): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email: SEED.owner.email, password: SEED.owner.password });
  if (error) throw error;
  return c;
}

/** Tạo (hoặc lấy) user vai trò tablet cho hồ sơ, giống Edge Function activate-tablet. */
export async function tabletSession(profileId: string): Promise<{ access_token: string; refresh_token: string }> {
  const admin = serviceClient();
  const email = `tablet-${profileId}@tablets.laodai.local`;
  const app_metadata = { role: 'tablet', tablet_profile_id: profileId };
  const existing = await sql<{ id: string }>('select id from auth.users where email = $1', [email]);
  if (existing[0]) {
    // Không đổi mật khẩu (sẽ thu hồi phiên của máy khác cùng hồ sơ), chỉ chỉnh app_metadata.
    const { error } = await admin.auth.admin.updateUserById(existing[0].id, { app_metadata });
    if (error) throw error;
  } else {
    const password = `t-${crypto.randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata });
    if (error) throw error;
    await sql('update public.tablet_profiles set auth_user_id = $1 where id = $2', [data.user.id, profileId]);
  }
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr) throw linkErr;
  const c = anonClient();
  const { data, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error) throw error;
  return { access_token: data.session!.access_token, refresh_token: data.session!.refresh_token };
}

export async function tabletClient(profileId: string): Promise<SupabaseClient> {
  const s = await tabletSession(profileId);
  const c = anonClient();
  await c.auth.setSession(s);
  return c;
}
