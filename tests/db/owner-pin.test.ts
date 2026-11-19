import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV } from '../support/env';
import { anonClient, ownerClient, resetDb, serviceClient, sql, tabletClient, tabletSession } from '../support/db';
import { SEED } from '../support/seed-ids';

// Mã PIN chế độ chủ theo thiết bị: cài bằng phiên chủ, mở bằng Edge Function owner-pin-unlock từ tablet.

const role = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).app_metadata?.role;

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

async function unlock(tabletJwt: string | null, body: unknown) {
  const res = await fetch(`${ENV.url}/functions/v1/owner-pin-unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ENV.anonKey, ...(tabletJwt ? { Authorization: `Bearer ${tabletJwt}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  const s = await fetch(`${ENV.url}/functions/v1/owner-pin-unlock`, { method: 'OPTIONS' }).then((r) => r.status).catch(() => 0);
  if (s === 0 || s === 404 || s === 503) throw new Error('Edge Functions chưa chạy: khởi động lại `npx supabase start`');
});

beforeEach(async () => {
  await resetDb();
});

describe('mã PIN chế độ chủ', () => {
  it('chỉ chủ cài được; PIN phải 6 số; server chỉ lưu băm (không lưu khóa thiết bị / PIN gốc)', async () => {
    const tab = await tabletClient(SEED.tablets.A);
    const denied = await tab.rpc('owner_set_device_pin', { p_token: TOKEN_A, p_pin: '123456', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    expect(denied.error?.message).toMatch(/forbidden/);

    const owner = await ownerClient();
    const bad = await owner.rpc('owner_set_device_pin', { p_token: TOKEN_A, p_pin: '1234', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    expect(bad.error?.message).toMatch(/6 chữ số/);

    const ok = await owner.rpc('owner_set_device_pin', { p_token: TOKEN_A, p_pin: '123456', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    expect(ok.error).toBeNull();
    const [row] = await sql<{ token_hash: string; pin_hash: string }>('select token_hash, pin_hash from owner_device_pins');
    expect(row.token_hash).not.toContain(TOKEN_A);
    expect(row.pin_hash).not.toContain('123456');

    // Không ai đọc bảng trực tiếp, kể cả chủ
    const direct = await owner.from('owner_device_pins').select('*');
    expect(direct.error?.message ?? direct.data).toBeTruthy();
    expect(direct.data ?? []).toEqual([]);
    // Hàm kiểm PIN chỉ dành cho service role
    const verify = await tab.rpc('owner_pin_verify', { p_token: TOKEN_A, p_pin: '123456' });
    expect(verify.error).not.toBeNull();
    expect((await sql(`select 1 from audit_log where action = 'owner_pin_set'`)).length).toBe(1);
  });

  it('mỗi máy một PIN riêng; đúng PIN trên đúng máy ⇒ phiên chủ; PIN máy này không mở được máy kia', async () => {
    const owner = await ownerClient();
    await owner.rpc('owner_set_device_pin', { p_token: TOKEN_A, p_pin: '111111', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    await owner.rpc('owner_set_device_pin', { p_token: TOKEN_B, p_pin: '222222', p_device: 'device-bbbb', p_profile: SEED.tablets.B });
    const jwt = (await tabletSession(SEED.tablets.A)).access_token;

    const a = await unlock(jwt, { token: TOKEN_A, pin: '111111' });
    expect(a.status).toBe(200);
    const session = a.body.session as { access_token: string; refresh_token: string };
    expect(role(session.access_token)).toBe('owner');
    // Phiên chủ dùng được thật
    const c = anonClient();
    await c.auth.setSession(session);
    expect((await c.rpc('owner_list_device_pins')).data).toHaveLength(2);

    expect((await unlock(jwt, { token: TOKEN_A, pin: '222222' })).status).toBe(401);
    expect((await unlock(jwt, { token: TOKEN_B, pin: '222222' })).status).toBe(200);
  });

  it('phải gọi từ tablet đã kích hoạt', async () => {
    const owner = await ownerClient();
    await owner.rpc('owner_set_device_pin', { p_token: TOKEN_A, p_pin: '111111', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    expect((await unlock(null, { token: TOKEN_A, pin: '111111' })).status).toBe(403);
    const ownerJwt = (await owner.auth.getSession()).data.session!.access_token;
    expect((await unlock(ownerJwt, { token: TOKEN_A, pin: '111111' })).status).toBe(403);
  });

  it('sai 5 lần liền ⇒ xóa PIN của máy (phải nhập mật khẩu); đúng giữa chừng thì đếm lại từ đầu', async () => {
    const owner = await ownerClient();
    await owner.rpc('owner_set_device_pin', { p_token: TOKEN_A, p_pin: '111111', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    const jwt = (await tabletSession(SEED.tablets.A)).access_token;

    expect((await unlock(jwt, { token: TOKEN_A, pin: '000000' })).body).toEqual({ error: 'wrong_pin', remaining: 4 });
    expect((await unlock(jwt, { token: TOKEN_A, pin: '111111' })).status).toBe(200);
    for (const remaining of [4, 3, 2, 1]) {
      expect((await unlock(jwt, { token: TOKEN_A, pin: '000000' })).body).toEqual({ error: 'wrong_pin', remaining });
    }
    const locked = await unlock(jwt, { token: TOKEN_A, pin: '000000' });
    expect(locked).toEqual({ status: 423, body: { error: 'pin_locked' } });
    expect((await unlock(jwt, { token: TOKEN_A, pin: '111111' })).status).toBe(404);
    expect((await sql('select 1 from owner_device_pins')).length).toBe(0);
    expect((await sql(`select 1 from audit_log where action = 'owner_pin_locked'`)).length).toBe(1);
  });

  it('cài lại trên cùng máy thay PIN cũ; chủ xóa PIN của máy khác ⇒ máy đó không mở bằng PIN được nữa', async () => {
    const owner = await ownerClient();
    await owner.rpc('owner_set_device_pin', { p_token: TOKEN_A, p_pin: '111111', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    await owner.rpc('owner_set_device_pin', { p_token: TOKEN_B, p_pin: '333333', p_device: 'device-aaaa', p_profile: SEED.tablets.A });
    const jwt = (await tabletSession(SEED.tablets.A)).access_token;
    expect((await unlock(jwt, { token: TOKEN_A, pin: '111111' })).status).toBe(404);
    expect((await unlock(jwt, { token: TOKEN_B, pin: '333333' })).status).toBe(200);

    const { data: list } = await owner.rpc('owner_list_device_pins');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ device_id: 'device-aaaa', tablet_name: 'Tablet A' });
    expect(list[0].last_used_at).not.toBeNull();

    expect((await owner.rpc('owner_remove_device_pin', { p_id: list[0].id })).data).toBe(true);
    expect((await unlock(jwt, { token: TOKEN_B, pin: '333333' })).status).toBe(404);
    expect((await sql(`select 1 from audit_log where action = 'owner_pin_removed'`)).length).toBe(1);
    // Service role không bị chặn khi kiểm PIN không tồn tại
    expect((await serviceClient().rpc('owner_pin_verify', { p_token: TOKEN_B, p_pin: '333333' })).data).toEqual({ status: 'not_found' });
  });
});
