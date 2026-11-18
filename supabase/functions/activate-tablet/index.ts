// Kích hoạt tablet: chủ đã đăng nhập trên tablet chọn hồ sơ ⇒ cấp phiên vai trò `tablet` cho hồ sơ đó.
// Client sau đó hủy phiên chủ trên máy và dùng phiên tablet.
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
  const authHeader = req.headers.get('Authorization') ?? '';
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };

  // 1. Người gọi phải là chủ
  const ownerDb = createClient(url, anon, { ...opts, global: { headers: { Authorization: authHeader } } });
  const { data: who } = await ownerDb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (who.user?.app_metadata?.role !== 'owner') return json({ error: 'forbidden' }, 403);

  const { tablet_profile_id } = await req.json().catch(() => ({}));
  if (typeof tablet_profile_id !== 'string') return json({ error: 'tablet_profile_id required' }, 400);

  // 2. Ghi nhật ký + báo Telegram, lấy hồ sơ và device_seq lớn nhất (RPC kiểm quyền chủ)
  const { data: act, error: actErr } = await ownerDb.rpc('activate_tablet_profile', { p_profile: tablet_profile_id });
  if (actErr) return json({ error: actErr.message }, 400);

  // 3. Lấy (hoặc tạo) user vai trò tablet của hồ sơ.
  //    KHÔNG đổi mật khẩu user đã có: đổi mật khẩu thu hồi mọi phiên cũ ⇒ các máy khác dùng chung
  //    hồ sơ bị đăng xuất và phải kích hoạt lại.
  const admin = createClient(url, service, opts);
  const app_metadata = { role: 'tablet', tablet_profile_id };
  const { data: profile } = await admin.from('tablet_profiles').select('auth_user_id').eq('id', tablet_profile_id).single();

  let email: string | null = null;
  const existingId = profile?.auth_user_id as string | null;
  if (existingId) {
    const { data, error } = await admin.auth.admin.getUserById(existingId);
    if (!error && data.user?.email) {
      email = data.user.email;
      const meta = data.user.app_metadata ?? {};
      if (meta.role !== 'tablet' || meta.tablet_profile_id !== tablet_profile_id) {
        // Chỉ sửa app_metadata (không đụng mật khẩu ⇒ không thu hồi phiên).
        const { error: upErr } = await admin.auth.admin.updateUserById(existingId, { app_metadata });
        if (upErr) return json({ error: upErr.message }, 500);
      }
    }
  }
  if (!email) {
    email = `tablet-${tablet_profile_id}@tablets.laodai.local`;
    const password = crypto.randomUUID() + crypto.randomUUID();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata });
    if (error) return json({ error: error.message }, 500);
    await admin.from('tablet_profiles').update({ auth_user_id: data.user.id }).eq('id', tablet_profile_id);
  }

  // 4. Cấp thêm một phiên mới cho tablet (magic link tạo phía server, không gửi email),
  //    các phiên của máy khác cùng hồ sơ vẫn giữ nguyên.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return json({ error: linkErr?.message ?? 'generate link failed' }, 500);
  const tabletAuth = createClient(url, anon, opts);
  const { data: s, error: sErr } = await tabletAuth.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (sErr || !s.session) return json({ error: sErr?.message ?? 'sign-in failed' }, 500);

  return json({
    session: { access_token: s.session.access_token, refresh_token: s.session.refresh_token },
    profile: act.profile,
    last_device_seq: act.last_device_seq,
  });
});
