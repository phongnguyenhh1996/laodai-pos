// Sao lưu hằng đêm: chụp mọi bảng public thành zip JSON rồi gửi file vào chat Telegram.
// Được gọi bởi pg_cron (private.backup_tick, 03:00 + 03:30 giờ VN). Không nhận tham số:
// mỗi ngày gửi tối đa một bản thành công ⇒ người ngoài gọi cũng chỉ làm chủ nhận lại đúng file của mình.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { strToU8, zipSync } from 'npm:fflate@0.8.2';
import { TELEGRAM_FILE_LIMIT, backupCaption, backupFileName, readSnapshot, snapshotFiles } from '../_shared/backup.ts';

const TELEGRAM_API_BASE = Deno.env.get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
/** Lần chạy trước còn "running" trong khoảng này ⇒ coi như đang chạy, không chạy chồng. */
const RUNNING_GRACE_MS = 10 * 60_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: date, error: dateErr } = await db.rpc('backup_manifest').then((r) => ({
    data: (r.data as { business_date?: string } | null)?.business_date,
    error: r.error,
  }));
  if (dateErr || !date) return Response.json({ error: dateErr?.message ?? 'no manifest' }, { status: 500 });

  const { data: runs } = await db.from('backup_runs').select('status, started_at').eq('business_date', date);
  if (runs?.some((r) => r.status === 'sent')) return Response.json({ status: 'already_sent' });
  if (runs?.some((r) => r.status === 'running' && Date.now() - Date.parse(r.started_at) < RUNNING_GRACE_MS)) {
    return Response.json({ status: 'running' });
  }

  const { data: run, error: runErr } = await db.from('backup_runs').insert({ business_date: date }).select('id').single();
  if (runErr || !run) return Response.json({ error: runErr?.message ?? 'cannot start' }, { status: 500 });

  try {
    const snap = await readSnapshot((fn, args) => db.rpc(fn, args));
    const files = snapshotFiles(snap);
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
    if (zip.byteLength > TELEGRAM_FILE_LIMIT) throw new Error(`file ${zip.byteLength} byte vượt giới hạn 50MB của Telegram`);

    const { data: st } = await db.from('settings').select('telegram_chat_id, backup_chat_id').maybeSingle();
    const chat = st?.backup_chat_id || st?.telegram_chat_id;
    if (!chat) throw new Error('chưa cài đặt chat Telegram (backup_chat_id / telegram_chat_id)');

    const form = new FormData();
    form.append('chat_id', chat);
    form.append('caption', backupCaption(snap.manifest, zip.byteLength));
    form.append('document', new Blob([zip], { type: 'application/zip' }), backupFileName(date));
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);

    await db
      .from('backup_runs')
      .update({ status: 'sent', finished_at: new Date().toISOString(), bytes: zip.byteLength, tables: snap.manifest.tables })
      .eq('id', run.id);
    return Response.json({ status: 'sent', bytes: zip.byteLength, tables: snap.manifest.tables });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from('backup_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error: msg }).eq('id', run.id);
    return Response.json({ status: 'failed', error: msg }, { status: 502 });
  }
});
