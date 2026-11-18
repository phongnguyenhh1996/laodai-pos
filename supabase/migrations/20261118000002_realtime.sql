-- Bỏ chế độ offline: tablet ghi thẳng lên server (vẫn qua `sync_push`, idempotent theo op_id để gửi lại an toàn)
-- và nghe thay đổi qua Realtime. Nhiều máy dùng chung một hồ sơ tablet thấy cùng một ca + cùng hàng đợi.
--
-- 1. Server cấp `device_seq` và mã đơn (không còn sinh ở máy ⇒ hai máy không bao giờ trùng số / trùng mã).
-- 2. `performed_at` không bắt buộc: thiếu thì lấy giờ server (đồng hồ các máy lệch nhau không làm lệch hàng đợi).
-- 3. `sync_push` trả luôn dữ liệu vừa ghi (đơn / ca) để máy cập nhật ngay, không chờ tải lại.
-- 4. `live_pulse`: mỗi thay đổi của đơn / ca / danh mục tăng số `rev` của một khóa; tablet đăng ký Realtime trên bảng này.
--    (Không nghe thẳng `orders`: RLS giấu đơn đã thanh toán với tablet nên máy khác không nhận được sự kiện "đã thanh toán".)

-- ---------------------------------------------------------------- mã đơn do server cấp

-- Mã ngẫu nhiên 3 ký tự, không trùng với mã đã dùng trong ngày của hồ sơ tablet.
-- Gọi bên trong sync_push (đã khóa theo hồ sơ tablet) ⇒ hai máy cùng hồ sơ không lấy trùng mã.
create function private.new_order_code(p_profile uuid, p_at timestamptz) returns text
language plpgsql volatile as $$
declare
  a constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  n constant int := length(a);
  d date := private.business_date(p_at);
  c text;
begin
  for i in 1..200 loop
    c := substr(a, 1 + floor(random() * n)::int, 1) || substr(a, 1 + floor(random() * n)::int, 1)
      || substr(a, 1 + floor(random() * n)::int, 1);
    if not exists (select 1 from public.orders
                    where tablet_profile_id = p_profile and code = c and private.business_date(created_at) = d) then
      return c;
    end if;
  end loop;
  -- Gần hết mã trong ngày: chọn trong các mã còn trống.
  select x into c from (
    select substr(a, i, 1) || substr(a, j, 1) || substr(a, k, 1) x
      from generate_series(1, n) i, generate_series(1, n) j, generate_series(1, n) k
  ) s
  where not exists (select 1 from public.orders
                     where tablet_profile_id = p_profile and code = s.x and private.business_date(created_at) = d)
  order by random() limit 1;
  if c is null then perform private.reject('order_codes_exhausted'); end if;
  return c;
end $$;

create or replace function private.op_create_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o jsonb := p -> 'order';
  v_id uuid := private.as_uuid(o ->> 'id', 'order');
  v_point uuid := private.as_uuid(o ->> 'point_id', 'point');
  v_shift public.shifts := private.require_shift(p_profile, private.as_uuid(o ->> 'opened_shift_id', 'shift'));
  v_total int := private.as_int(o ->> 'total', 'total', 0);
  v_seq int;
  v_code text;
  v_address text;
  v_menu uuid;
  v_calc int;
begin
  if exists (select 1 from public.orders where id = v_id) then perform private.reject('order_exists'); end if;
  if v_shift.status <> 'open' then perform private.reject('shift_not_open'); end if;
  if not exists (select 1 from public.tablet_profiles where id = p_profile and v_point = any(point_ids)) then
    perform private.reject('point_not_allowed');
  end if;
  select menu_id into v_menu from public.points where id = v_point and active;
  if v_menu is null then perform private.reject('point_inactive'); end if;
  v_address := private.order_address(o);
  if v_shift.opened_at > p_at + interval '5 minutes' then perform private.reject('bad_shift'); end if;

  -- Số thứ tự + mã đơn: server cấp (sync_push giữ khóa theo hồ sơ tablet ⇒ không trùng giữa các máy).
  v_seq := coalesce((select max(device_seq) from public.orders where tablet_profile_id = p_profile), 0) + 1;
  v_code := private.new_order_code(p_profile, p_at);

  insert into public.orders (id, device_seq, tablet_profile_id, point_id, code, label, table_no, dine_type, address,
                             status, opened_shift_id, created_at, total)
  values (v_id, v_seq, p_profile, v_point, v_code, left(nullif(trim(o ->> 'label'), ''), 40),
          left(nullif(trim(o ->> 'table_no'), ''), 10), o ->> 'dine_type', v_address, 'open', v_shift.id, p_at, v_total);

  v_calc := private.write_items(v_id, v_menu, p -> 'items', p_at);
  if v_calc <> v_total then perform private.reject('total_mismatch'); end if;

  perform private.audit('order_create', 'order', v_id, null, private.order_json(v_id), p_at, 'staff', v_shift.id, p_profile);
  if v_address is not null then perform private.notify_delivery(v_id, v_shift.id, false, p_at); end if;
end $$;

-- ---------------------------------------------------------------- dữ liệu trả về sau mỗi thao tác

-- Đơn còn mở sau create/update/serve, hoặc ca vừa mở. Thanh toán / xóa / đóng ca: không trả gì
-- (tablet chỉ cần bỏ đơn khỏi hàng đợi, không được thấy lại đơn đã thanh toán).
create function private.op_data(p_profile uuid, p_kind text, p_entity uuid) returns jsonb
language sql stable as $$
  select coalesce(case
    when p_kind in ('create_order', 'update_order', 'serve_order') then (
      select jsonb_build_object('order', private.order_json(o.id))
        from public.orders o
       where o.id = p_entity and o.tablet_profile_id = p_profile and o.status in ('open', 'served'))
    when p_kind = 'open_shift' then (
      select jsonb_build_object('shift', jsonb_build_object(
               'id', s.id, 'tablet_profile_id', s.tablet_profile_id, 'staff_id', s.staff_id, 'staff_name', st.name,
               'opened_at', s.opened_at, 'open_boxes', s.open_boxes, 'open_plates', s.open_plates, 'open_float', s.open_float))
        from public.shifts s join public.staff st on st.id = s.staff_id
       where s.id = p_entity and s.tablet_profile_id = p_profile and s.status = 'open')
  end, '{}'::jsonb)
$$;

create or replace function public.sync_push(op jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_profile uuid := private.my_tablet_profile_id();
  v_op_id uuid;
  v_kind text := op ->> 'kind';
  v_entity uuid := case when op ->> 'entity_id' ~* '^[0-9a-f-]{36}$' then (op ->> 'entity_id')::uuid end;
  v_at timestamptz;
  v_result jsonb;
  v_prev public.sync_ops;
begin
  if v_profile is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(op ->> 'op_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'bad op_id' using errcode = '22023'; end if;
  v_op_id := (op ->> 'op_id')::uuid;

  -- Tuần tự hóa theo hồ sơ tablet: các máy dùng chung hồ sơ không ghi chồng lên nhau.
  perform pg_advisory_xact_lock(hashtext(v_profile::text));

  -- Gửi lại (mất phản hồi lần trước): trả đúng kết quả cũ, kèm dữ liệu hiện tại.
  select * into v_prev from public.sync_ops where op_id = v_op_id;
  if found then
    if v_prev.result ->> 'status' = 'rejected' then return v_prev.result; end if;
    return jsonb_build_object('status', 'duplicate') || private.op_data(v_profile, v_prev.kind, v_prev.entity_id);
  end if;

  begin
    v_at := case when nullif(op ->> 'performed_at', '') is null then now()
                 else private.as_ts(op ->> 'performed_at', 'performed_at') end;
    if v_at > now() + interval '5 minutes' then perform private.reject('performed_at_in_future'); end if;
    case v_kind
      when 'open_shift' then perform private.op_open_shift(v_profile, op -> 'payload', v_at);
      when 'close_shift' then perform private.op_close_shift(v_profile, op -> 'payload', v_at);
      when 'create_order' then perform private.op_create_order(v_profile, op -> 'payload', v_at);
      when 'update_order' then perform private.op_update_order(v_profile, op -> 'payload', v_at);
      when 'serve_order' then perform private.op_serve_order(v_profile, op -> 'payload', v_at);
      when 'delete_order' then perform private.op_delete_order(v_profile, op -> 'payload', v_at);
      when 'pay_order' then perform private.op_pay_order(v_profile, op -> 'payload', v_at);
      when 'debt_payment' then perform private.op_debt_payment(v_profile, op -> 'payload', v_at);
      else perform private.reject('unknown_kind');
    end case;
    v_result := jsonb_build_object('status', 'ok');
  exception when sqlstate 'LD001' then
    v_result := jsonb_build_object('status', 'rejected', 'reason', sqlerrm);
    insert into public.audit_log (at, actor_kind, tablet_profile_id, action, entity, entity_id, after, reason)
    values (coalesce(v_at, now()), 'staff', v_profile, 'sync_rejected', coalesce(v_kind, 'unknown'), v_entity, op, sqlerrm);
    perform private.notify('sync_rejected', jsonb_build_object(
      'tablet_profile_id', v_profile, 'tablet_name', (select name from public.tablet_profiles where id = v_profile),
      'kind', v_kind, 'reason', sqlerrm), coalesce(v_at, now()));
  end;

  insert into public.sync_ops (op_id, tablet_profile_id, kind, entity_id, performed_at, result)
  values (v_op_id, v_profile, coalesce(v_kind, 'unknown'), v_entity, coalesce(v_at, now()), v_result);
  if v_result ->> 'status' = 'ok' then
    v_result := v_result || private.op_data(v_profile, v_kind, v_entity);
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------- nhịp realtime

-- Khóa: 'catalog' (menu, giá, nhân viên, điểm bán, hồ sơ tablet, cấu hình, khách + dư nợ)
-- hoặc 'profile:<id>' (ca + đơn của một hồ sơ tablet). Nội dung không có gì nhạy cảm: chỉ là số đếm.
create table public.live_pulse (
  key text primary key,
  rev bigint not null default 0,
  changed_at timestamptz not null default now()
);

alter table public.live_pulse enable row level security;
alter table public.live_pulse force row level security;
revoke all on public.live_pulse from anon, authenticated;
grant select on public.live_pulse to authenticated;

create policy pulse_read on public.live_pulse for select to authenticated using (
  private.is_owner()
  or (private.is_tablet() and (key = 'catalog' or key = 'profile:' || private.my_tablet_profile_id()::text))
);

create function private.bump_pulse(p_key text) returns void
language sql as $$
  insert into public.live_pulse (key, rev, changed_at) values (p_key, 1, now())
  on conflict (key) do update set rev = public.live_pulse.rev + 1, changed_at = now()
$$;

create function private.pulse_shift() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.bump_pulse('profile:' || new.tablet_profile_id::text);
  return null;
end $$;

create function private.pulse_order() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.bump_pulse('profile:' || new.tablet_profile_id::text);
  -- Ghi nợ (đơn trả bằng nợ) làm đổi dư nợ ⇒ danh mục của mọi tablet.
  if new.payment_method = 'debt' or (tg_op = 'UPDATE' and old.payment_method = 'debt') then
    perform private.bump_pulse('catalog');
  end if;
  return null;
end $$;

create function private.pulse_catalog() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.bump_pulse('catalog');
  return null;
end $$;

create trigger live_pulse after insert or update on public.orders
  for each row execute function private.pulse_order();
create trigger live_pulse after insert or update on public.shifts
  for each row execute function private.pulse_shift();

do $$
declare t text;
begin
  foreach t in array array[
    'settings', 'staff', 'menus', 'points', 'tablet_profiles', 'products', 'toppings', 'combos', 'customers', 'debt_payments'
  ] loop
    execute format(
      'create trigger live_pulse after insert or update on public.%I for each statement execute function private.pulse_catalog()', t);
  end loop;
end $$;

alter publication supabase_realtime add table public.live_pulse;
