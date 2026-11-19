// Vào chế độ chủ bằng mã PIN của thiết bị: tablet đã kích hoạt gửi khóa thiết bị + PIN
// ⇒ kiểm tra (owner_pin_verify, đếm số lần sai) ⇒ cấp một phiên chủ mới cho client giữ trong bộ nhớ.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };

  // 1. Người gọi phải là tablet đã kích hoạt (PIN chỉ dùng được trên máy bán hàng).
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const anonDb = createClient(url, anon, opts);
  const { data: who } = await anonDb.auth.getUser(jwt);
  if (who.user?.app_metadata?.role !== 'tablet') return json({ error: 'forbidden' }, 403);

  const { token, pin } = await req.json().catch(() => ({}));
  if (typeof token !== 'string' || typeof pin !== 'string') return json({ error: 'token, pin required' }, 400);

  // 2. Kiểm tra PIN (server đếm số lần sai, quá 5 lần thì xóa PIN của máy).
  const admin = createClient(url, service, opts);
  const { data: v, error: vErr } = await admin.rpc('owner_pin_verify', { p_token: token, p_pin: pin });
  if (vErr) return json({ error: vErr.message }, 500);
  if (v.status === 'not_found') return json({ error: 'pin_not_found' }, 404);
  if (v.status === 'locked') return json({ error: 'pin_locked' }, 423);
  if (v.status !== 'ok') return json({ error: 'wrong_pin', remaining: v.remaining }, 401);

  // 3. Cấp phiên chủ mới (magic link tạo phía server, không gửi email); phiên chủ ở máy khác giữ nguyên.
  const { data: u, error: uErr } = await admin.auth.admin.getUserById(v.owner_id);
  const email = u?.user?.email;
  if (uErr || !email || u.user.app_metadata?.role !== 'owner') return json({ error: 'owner not found' }, 500);
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return json({ error: linkErr?.message ?? 'generate link failed' }, 500);
  const { data: s, error: sErr } = await anonDb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (sErr || !s.session) return json({ error: sErr?.message ?? 'sign-in failed' }, 500);

  return json({ session: { access_token: s.session.access_token, refresh_token: s.session.refresh_token } });
});
