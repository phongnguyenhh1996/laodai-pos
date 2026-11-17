// Gửi một thông báo (bảng notifications) lên nhóm Telegram.
// Được gọi bởi trigger pg_net khi có thông báo mới, và bởi cron gửi lại tin lỗi.
// Chỉ nhận { id }: nội dung luôn đọc từ DB bằng service role ⇒ người gọi không chèn được nội dung giả.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { formatNotification, type Notification } from '../_shared/format.ts';

const TELEGRAM_API_BASE = Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const { id } = await req.json().catch(() => ({ id: null }));
  if (typeof id !== 'string') return Response.json({ error: 'id required' }, { status: 400 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: n, error } = await db.from('notifications').select('*').eq('id', id).maybeSingle();
  if (error || !n) return Response.json({ error: error?.message ?? 'not found' }, { status: 404 });
  if (n.sent_at) return Response.json({ status: 'already_sent' });

  const { data: settings } = await db.from('settings').select('telegram_chat_id, app_url').maybeSingle();
  const text = formatNotification({ kind: n.kind, payload: n.payload } as Notification, {
    appUrl: settings?.app_url ?? '',
  });

  try {
    if (!settings?.telegram_chat_id) throw new Error('telegram_chat_id chưa cài đặt');
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.telegram_chat_id, text, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
    await db.from('notifications').update({ sent_at: new Date().toISOString(), attempts: n.attempts + 1, error: null }).eq('id', id);
    return Response.json({ status: 'sent' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('notifications').update({ attempts: n.attempts + 1, error: msg }).eq('id', id);
    return Response.json({ status: 'failed', error: msg }, { status: 502 });
  }
});
