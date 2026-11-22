-- Sao lưu hằng đêm (gói Supabase miễn phí không có khôi phục theo thời điểm).
-- pg_cron 03:00 / 03:30 giờ VN → pg_net → Edge Function nightly-backup → zip JSON mọi bảng public
-- → gửi file vào chat Telegram (backup_chat_id, trống ⇒ telegram_chat_id). 04:00 chưa gửi được ⇒ báo lỗi.
-- Khôi phục: scripts/db-restore.mjs (README › Khôi phục từ bản sao lưu).

-- Chat nhận file sao lưu; để trống ⇒ dùng chat chính.
alter table public.settings add column backup_chat_id text;

-- Mỗi lần chạy một dòng: chống gửi trùng trong ngày + lý do lỗi cho tin cảnh báo.
create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'sent', 'failed')),
  bytes int,
  tables jsonb,
  error text
);
create index on public.backup_runs (business_date);
alter table public.backup_runs enable row level security;
alter table public.backup_runs force row level security;
revoke all on public.backup_runs from anon, authenticated;
grant select on public.backup_runs to authenticated;
create policy owner_read on public.backup_runs for select to authenticated using (private.is_owner());

-- ---------------------------------------------------------------- đọc dữ liệu để sao lưu

-- Bảng được sao lưu: mọi bảng thường trong public, trừ dữ liệu tạm
-- và owner_device_pins (gắn với tài khoản auth, không mang sang dự án mới: chủ đặt lại PIN).
create function private.backup_table_names() returns setof text
language sql stable as $$
  select c.relname::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname not in ('live_pulse', 'print_jobs', 'sync_ops', 'owner_device_pins')
  order by 1
$$;

-- Thông tin đầu bản sao lưu: ngày, số dòng từng bảng, migration của DB nguồn.
create function public.backup_manifest() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t text; n bigint; v_tables jsonb := '{}'; v_migrations jsonb := '[]';
begin
  for t in select * from private.backup_table_names() loop
    execute format('select count(*) from public.%I', t) into n;
    v_tables := v_tables || jsonb_build_object(t, n);
  end loop;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('version', version, 'name', name) order by version), '[]')
               from supabase_migrations.schema_migrations$q$ into v_migrations;
  end if;
  return jsonb_build_object(
    'format', 1,
    'created_at', now(),
    'business_date', private.business_date(now()),
    'tables', v_tables,
    'migrations', v_migrations);
end $$;

-- Một trang dữ liệu của một bảng (thứ tự theo khóa chính ⇒ phân trang ổn định).
create function public.backup_table_page(p_table text, p_offset int, p_limit int) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_order text; r jsonb;
begin
  if p_table not in (select * from private.backup_table_names()) then
    raise exception 'bảng không được sao lưu: %', p_table using errcode = '22023';
  end if;
  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum))
    into v_order
  from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from (select * from public.%I order by %s offset $1 limit $2) t',
    p_table, coalesce(v_order, 'ctid'))
    into r using p_offset, p_limit;
  return r;
end $$;

revoke execute on function public.backup_manifest(), public.backup_table_page(text, int, int) from public, anon, authenticated;
grant execute on function public.backup_manifest(), public.backup_table_page(text, int, int) to service_role;

-- ---------------------------------------------------------------- lịch chạy

-- 03:00 và 03:30 giờ VN: hôm nay chưa gửi được ⇒ gọi Edge Function (lần 2 = thử lại).
create function private.backup_tick(p_now timestamptz default now()) returns text
language plpgsql security definer set search_path = public, private, net as $$
declare
  d date := private.business_date(p_now);
  v_url text := (select value from private.config where key = 'functions_url');
begin
  if exists (select 1 from public.backup_runs where business_date = d and status = 'sent') then return 'done'; end if;
  if v_url is null then return 'no_url'; end if;
  perform net.http_post(
    url := v_url || '/nightly-backup',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 120000);
  return 'called';
end $$;

-- 04:00 giờ VN: vẫn chưa gửi được ⇒ một tin cảnh báo vào chat chính (qua notifications / telegram-dispatch).
create function private.backup_watchdog(p_now timestamptz default now()) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  d date := private.business_date(p_now);
  v_attempts int;
  v_error text;
begin
  if exists (select 1 from public.backup_runs where business_date = d and status = 'sent') then return null; end if;
  if exists (select 1 from public.notifications where kind = 'backup_failed' and business_date = d) then return null; end if;
  select count(*) into v_attempts from public.backup_runs where business_date = d;
  select coalesce(error, case status when 'running' then 'chạy quá lâu, không xong' end) into v_error
  from public.backup_runs where business_date = d order by started_at desc limit 1;
  return private.notify('backup_failed', jsonb_build_object(
    'date', d,
    'attempts', v_attempts,
    'error', coalesce(v_error, 'không chạy (không thấy lần sao lưu nào)')), p_now);
end $$;

-- Giờ UTC: 20:00 / 20:30 = 03:00 / 03:30 VN, 21:00 = 04:00 VN.
select cron.schedule('laodai-nightly-backup', '0,30 20 * * *', $$select private.backup_tick()$$);
select cron.schedule('laodai-backup-watchdog', '0 21 * * *', $$select private.backup_watchdog()$$);
