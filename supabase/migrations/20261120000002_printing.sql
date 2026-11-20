-- In phiếu bếp & bill thanh toán (SPEC mục 12).
--
-- - 3 công tắc in tự động theo quầy (`tablet_profiles`).
-- - Một mẫu in chung (`print_template`, singleton jsonb), chủ sửa qua RPC, có nhật ký.
-- - `print_jobs`: MỌI lần in (tự in, nhân viên in lại phiếu bếp, chủ in lại từ xa, in thử) đều là một dòng.
--   In tại chỗ: máy tạo lệnh và nhận luôn (`claimed`). In từ xa: chủ tạo `pending`, tablet của quầy nghe Realtime,
--   máy đầu tiên nhận được lệnh (`print_job_claim`, khóa dòng ⇒ chỉ một máy in), quá 2 phút thì `expired`.
-- - Nội dung in (`doc`) do server dựng từ đơn hiện tại lúc nhận lệnh, KHÔNG có hình thức thanh toán, tiền đưa / thối,
--   nợ, tên nhân viên. Tablet không đọc được đơn đã thanh toán ⇒ bill in lại từ xa vẫn lấy được nội dung qua lệnh in.
-- - Không báo Telegram, chỉ ghi `audit_log`.

-- ---------------------------------------------------------------- công tắc theo quầy

alter table public.tablet_profiles
  add column auto_print_kitchen boolean not null default true,
  add column auto_reprint_kitchen_on_edit boolean not null default true,
  add column auto_print_bill boolean not null default true;

-- ---------------------------------------------------------------- mẫu in

create function private.default_print_template() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'shop_name', 'Lão Đại',
    'phone', '',
    'address', '',
    'footer', '[]'::jsonb,
    'code_size', 'large',
    'bill', jsonb_build_object(
      'shop_name', true, 'point', true, 'phone', true, 'address', true, 'time', true, 'dine', true,
      'label', true, 'unit_price', true, 'thanks', true, 'no_bill_free', true),
    'kitchen', jsonb_build_object('queue_no', true, 'dine', true, 'label', true, 'time', true, 'toppings', true))
$$;

create table public.print_template (
  id boolean primary key default true check (id),
  template jsonb not null default private.default_print_template() check (jsonb_typeof(template) = 'object'),
  updated_at timestamptz not null default now()
);
insert into public.print_template (id) values (true);

-- ---------------------------------------------------------------- lệnh in

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('kitchen', 'bill', 'test')),
  order_id uuid references public.orders (id),
  -- Số lần đơn đã được sửa lúc tạo lệnh (phiếu bếp "ĐÃ SỬA" thuộc phiên bản nào).
  order_rev int not null default 0,
  tablet_profile_id uuid not null references public.tablet_profiles (id),
  source text not null check (source in ('auto', 'staff', 'owner')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'printed', 'failed', 'expired')),
  device_id text check (length(device_id) between 8 and 64),
  -- Phiếu bếp "ĐÃ SỬA": giờ sửa + món thêm / bớt (máy tính lúc sửa, server chỉ lưu lại để xem trong nhật ký).
  detail jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  error text,
  check ((kind = 'test') = (order_id is null)),
  check (status <> 'pending' or claimed_at is null),
  check (status not in ('claimed', 'printed', 'failed') or (device_id is not null and claimed_at is not null))
);
create index on public.print_jobs (tablet_profile_id, status);
create index on public.print_jobs (order_id) where order_id is not null;
create index on public.print_jobs (created_at desc);

alter table public.print_template enable row level security;
alter table public.print_template force row level security;
alter table public.print_jobs enable row level security;
alter table public.print_jobs force row level security;
revoke all on public.print_template, public.print_jobs from anon, authenticated;
grant select on public.print_template, public.print_jobs to authenticated;

-- Mẫu in: tablet cần để vẽ phiếu.
create policy template_read on public.print_template for select to authenticated
  using (private.is_owner() or private.is_tablet());
-- Lệnh in: tablet chỉ thấy lệnh của quầy mình (không có nội dung đơn, chỉ mã lệnh + trạng thái).
create policy job_read on public.print_jobs for select to authenticated
  using (private.is_owner() or tablet_profile_id = private.my_tablet_profile_id());

create trigger forbid_delete before delete on public.print_template for each row execute function private.forbid_delete();
create trigger forbid_delete before delete on public.print_jobs for each row execute function private.forbid_delete();

-- Đổi mẫu ⇒ tablet tải lại danh mục (mẫu in nằm trong danh mục của tablet).
create trigger live_pulse after insert or update on public.print_template
  for each statement execute function private.pulse_catalog();

-- Chủ thấy trạng thái lệnh theo thời gian thực; tablet nghe lệnh mới của quầy mình (RLS vẫn áp dụng).
alter publication supabase_realtime add table public.print_jobs;

-- ---------------------------------------------------------------- nội dung in

-- Đơn → nội dung in. Không có: hình thức thanh toán, tiền khách đưa, khách nợ, nhân viên.
create function private.print_doc(p_order uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'order_id', o.id,
    'code', o.code,
    'status', o.status,
    'dine_type', o.dine_type,
    'label', o.label,
    'table_no', o.table_no,
    'point_name', p.name,
    'created_at', o.created_at,
    'paid_at', o.paid_at,
    'edited_at', (select max(a.at) from public.audit_log a
                   where a.entity = 'order' and a.entity_id = o.id and a.action = 'order_update'),
    'total', o.total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', i.name_snap, 'qty', i.qty, 'unit_price', i.unit_price_snap,
               'toppings', coalesce((select jsonb_agg(jsonb_build_object('name', t ->> 'name', 'price', (t ->> 'price')::int))
                                       from jsonb_array_elements(i.toppings_snap) t), '[]'::jsonb))
             order by i.sort, i.id)
        from public.order_items i where i.order_id = o.id and i.removed_at is null), '[]'::jsonb))
  from public.orders o join public.points p on p.id = o.point_id
  where o.id = p_order
$$;

create function private.order_rev(p_order uuid) returns int
language sql stable as $$
  select count(*)::int from public.audit_log
   where entity = 'order' and entity_id = p_order and action in ('order_update', 'owner_edit_order')
$$;

create function private.print_job_json(j public.print_jobs) returns jsonb
language sql stable as $$
  select to_jsonb(j) || jsonb_build_object(
    'order_code', (select code from public.orders where id = j.order_id),
    'tablet_name', (select name from public.tablet_profiles where id = j.tablet_profile_id))
$$;

-- Lệnh đã nhận ⇒ trả lệnh + nội dung in + mẫu hiện tại (mẫu đọc lúc in, bản in lại theo mẫu mới nhất).
create function private.claimed_result(j public.print_jobs) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'status', 'claimed',
    'job', private.print_job_json(j),
    'doc', case when j.order_id is not null then private.print_doc(j.order_id) end,
    'template', (select template from public.print_template limit 1))
$$;

create function private.print_audit(p_action text, j public.print_jobs, p_actor text) returns void
language sql as $$
  select private.audit(p_action, 'print_job', j.id, null, private.print_job_json(j), now(), p_actor,
    (select id from public.shifts where tablet_profile_id = j.tablet_profile_id and status = 'open' limit 1),
    j.tablet_profile_id, j.error)
$$;

create function private.valid_device(p_device text) returns text
language plpgsql immutable as $$
begin
  if p_device is null or length(p_device) not between 8 and 64 then
    raise exception 'Mã thiết bị không hợp lệ' using errcode = '22023';
  end if;
  return p_device;
end $$;

-- ---------------------------------------------------------------- tạo lệnh

-- Chủ: in lại bill / phiếu bếp, in thử. Gửi tới quầy `p_profile` (pending), hoặc in tại chỗ (`p_device` ⇒ nhận luôn).
-- Tablet: in tại chỗ (luôn nhận luôn). Phiếu bếp: đơn của quầy mình còn trong hàng đợi.
--   Bill: chỉ tự in ngay sau khi thanh toán, mỗi đơn một lần (tablet không in lại được bill — chống dùng bill cũ).
create function public.print_job_create(
  p_kind text,
  p_order uuid default null,
  p_profile uuid default null,
  p_device text default null,
  p_source text default null,
  p_detail jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_owner boolean := private.is_owner();
  v_profile uuid := private.my_tablet_profile_id();
  v_source text;
  o public.orders;
  j public.print_jobs;
begin
  if p_kind is null or p_kind not in ('kitchen', 'bill', 'test') then
    raise exception 'Loại phiếu không hợp lệ' using errcode = '22023';
  end if;
  if (p_kind = 'test') <> (p_order is null) then raise exception 'Thiếu đơn' using errcode = '22023'; end if;
  if p_detail is not null and jsonb_typeof(p_detail) <> 'object' then
    raise exception 'Chi tiết không hợp lệ' using errcode = '22023';
  end if;
  if p_order is not null then
    select * into o from public.orders where id = p_order;
    if not found then raise exception 'Không có đơn' using errcode = 'P0002'; end if;
    if o.status = 'deleted' then raise exception 'Đơn đã xóa' using errcode = '22023'; end if;
  end if;

  if v_owner then
    v_source := 'owner';
    v_profile := coalesce(p_profile, o.tablet_profile_id);
    if v_profile is null or not exists (select 1 from public.tablet_profiles where id = v_profile) then
      raise exception 'Chọn quầy để in' using errcode = '22023';
    end if;
    if p_kind = 'bill' and o.status <> 'paid' then raise exception 'Đơn chưa thanh toán' using errcode = '22023'; end if;
  elsif v_profile is not null then
    perform private.valid_device(p_device);
    if p_kind = 'test' then raise exception 'forbidden' using errcode = '42501'; end if;
    if o.tablet_profile_id <> v_profile then raise exception 'forbidden' using errcode = '42501'; end if;
    if p_kind = 'kitchen' then
      v_source := coalesce(p_source, 'staff');
      if v_source not in ('auto', 'staff') then raise exception 'Nguồn không hợp lệ' using errcode = '22023'; end if;
      -- Sửa rồi thu tiền ngay: phiếu "ĐÃ SỬA" vẫn in được trong ít phút sau khi thanh toán.
      if not (o.status in ('open', 'served') or (o.status = 'paid' and o.paid_at > now() - interval '10 minutes')) then
        raise exception 'Đơn không còn trong hàng đợi' using errcode = '22023';
      end if;
    else
      v_source := 'auto';
      if o.status <> 'paid' or o.paid_at < now() - interval '10 minutes' then
        raise exception 'Chỉ chủ in lại được bill' using errcode = '42501';
      end if;
      if exists (select 1 from public.print_jobs where order_id = o.id and kind = 'bill' and source <> 'owner') then
        raise exception 'Chỉ chủ in lại được bill' using errcode = '42501';
      end if;
    end if;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.print_jobs (kind, order_id, order_rev, tablet_profile_id, source, status, device_id, detail, claimed_at)
  values (p_kind, p_order, case when p_order is null then 0 else private.order_rev(p_order) end, v_profile, v_source,
          case when p_device is null then 'pending' else 'claimed' end,
          case when p_device is null then null else private.valid_device(p_device) end,
          p_detail, case when p_device is null then null else now() end)
  returning * into j;

  if v_owner then perform private.print_audit('print_request', j, 'owner'); end if;
  if j.status = 'claimed' then return private.claimed_result(j); end if;
  return jsonb_build_object('status', 'pending', 'job', private.print_job_json(j));
end $$;

-- ---------------------------------------------------------------- nhận lệnh từ xa

-- Nguyên tử: khóa dòng, chỉ `pending` → `claimed` một lần. Quá 2 phút ⇒ hết hạn, không in muộn.
create function public.print_job_claim(p_job uuid, p_device text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_profile uuid := private.my_tablet_profile_id();
  j public.print_jobs;
begin
  perform private.valid_device(p_device);
  select * into j from public.print_jobs where id = p_job for update;
  if not found or v_profile is null or j.tablet_profile_id <> v_profile then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if j.status <> 'pending' then return jsonb_build_object('status', 'taken'); end if;
  if j.created_at < now() - interval '2 minutes' then
    update public.print_jobs set status = 'expired', finished_at = now() where id = j.id returning * into j;
    perform private.print_audit('print_expired', j, 'system');
    return jsonb_build_object('status', 'expired');
  end if;
  -- Đơn bị xóa sau khi chủ bấm in ⇒ không in.
  if j.order_id is not null and exists (select 1 from public.orders where id = j.order_id and status = 'deleted') then
    update public.print_jobs set status = 'failed', claimed_at = now(), finished_at = now(), device_id = p_device,
                                 error = 'Đơn đã xóa'
     where id = j.id returning * into j;
    perform private.print_audit('print_failed', j, 'system');
    return jsonb_build_object('status', 'taken');
  end if;
  update public.print_jobs set status = 'claimed', claimed_at = now(), device_id = p_device
   where id = j.id returning * into j;
  return private.claimed_result(j);
end $$;

-- ---------------------------------------------------------------- báo kết quả

create function public.print_job_finish(p_job uuid, p_device text, p_ok boolean, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_profile uuid := private.my_tablet_profile_id();
  j public.print_jobs;
begin
  select * into j from public.print_jobs where id = p_job for update;
  if not found or not (private.is_owner() or (v_profile is not null and j.tablet_profile_id = v_profile)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if j.status <> 'claimed' or j.device_id is distinct from p_device then
    raise exception 'Lệnh in không thuộc máy này' using errcode = '22023';
  end if;
  update public.print_jobs set
    status = case when p_ok then 'printed' else 'failed' end,
    finished_at = now(),
    error = case when p_ok then null else left(coalesce(nullif(trim(p_error), ''), 'Lỗi máy in'), 200) end
  where id = j.id returning * into j;
  perform private.print_audit(case when p_ok then 'print_printed' else 'print_failed' end, j,
                              case when private.is_owner() then 'owner' else 'staff' end);
  return private.print_job_json(j);
end $$;

-- ---------------------------------------------------------------- hết hạn

create function private.expire_print_jobs() returns int
language plpgsql security definer set search_path = public, private as $$
declare j public.print_jobs; n int := 0;
begin
  for j in
    update public.print_jobs set status = 'expired', finished_at = now()
     where status = 'pending' and created_at < now() - interval '2 minutes'
    returning *
  loop
    perform private.print_audit('print_expired', j, 'system');
    n := n + 1;
  end loop;
  -- Máy nhận lệnh rồi tắt app giữa chừng: không treo `claimed` mãi.
  for j in
    update public.print_jobs set status = 'failed', finished_at = now(), error = 'Máy in không báo kết quả'
     where status = 'claimed' and claimed_at < now() - interval '5 minutes'
    returning *
  loop
    perform private.print_audit('print_failed', j, 'system');
    n := n + 1;
  end loop;
  return n;
end $$;

select cron.schedule('laodai-expire-print-jobs', '* * * * *', $$select private.expire_print_jobs()$$);

-- ---------------------------------------------------------------- mẫu in (chủ)

create function public.owner_set_print_template(p_template jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_before jsonb; v_after jsonb;
begin
  perform private.require_owner();
  if p_template is null or jsonb_typeof(p_template) <> 'object' then
    raise exception 'Mẫu in không hợp lệ' using errcode = '22023';
  end if;
  if coalesce(p_template ->> 'code_size', 'large') not in ('large', 'xlarge') then
    raise exception 'Cỡ mã đơn không hợp lệ' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_template -> 'footer', '[]')) <> 'array' or jsonb_array_length(coalesce(p_template -> 'footer', '[]')) > 3 then
    raise exception 'Tối đa 3 dòng chân trang' using errcode = '22023';
  end if;
  select template into v_before from public.print_template for update;
  v_after := private.default_print_template() || p_template;
  update public.print_template set template = v_after, updated_at = now() where id;
  perform private.audit('print_template_update', 'print_template', null, v_before, v_after, now(), 'owner', null, null);
  return v_after;
end $$;

-- ---------------------------------------------------------------- báo cáo ca

-- Đơn thanh toán trong ca mà không có lệnh bill nào in thành công: 'failed' (đã thử in, lỗi) hoặc 'none' (không in).
create function public.owner_shift_print_issues(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  perform private.require_owner();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'order_id', o.id, 'code', o.code, 'paid_at', o.paid_at,
             'status', case when exists (select 1 from public.print_jobs j
                                          where j.order_id = o.id and j.kind = 'bill' and j.status in ('failed', 'expired'))
                            then 'failed' else 'none' end)
           order by o.paid_at)
      from public.orders o
     where o.status = 'paid' and o.paid_shift_id = p_shift
       and not exists (select 1 from public.print_jobs j where j.order_id = o.id and j.kind = 'bill' and j.status = 'printed')
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- quyền

revoke execute on function public.print_job_create(text, uuid, uuid, text, text, jsonb), public.print_job_claim(uuid, text),
  public.print_job_finish(uuid, text, boolean, text), public.owner_set_print_template(jsonb),
  public.owner_shift_print_issues(uuid) from public, anon;
grant execute on function public.print_job_create(text, uuid, uuid, text, text, jsonb), public.print_job_claim(uuid, text),
  public.print_job_finish(uuid, text, boolean, text), public.owner_set_print_template(jsonb),
  public.owner_shift_print_issues(uuid) to authenticated;
