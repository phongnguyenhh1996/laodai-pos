-- Hết món (SPEC mục 4.8): nhân viên báo một món / topping đã hết TRONG NGÀY, theo từng điểm bán
-- (Xôi A hết xôi gấc không có nghĩa Xôi B hết). Sang ngày kinh doanh mới thì tự bán lại.
-- Ghi qua `sync_push` (kind `set_sold_out`, cần ca đang mở) ⇒ có tên nhân viên trong nhật ký; mọi máy cập nhật qua `live_pulse`.
-- Bỏ báo hết không xóa dòng: ghi `cleared_at` (không hard delete ở bảng nghiệp vụ).

create table public.sold_out (
  point_id uuid not null references public.points (id),
  item_kind text not null check (item_kind in ('product', 'topping')),
  item_id uuid not null,
  day date not null,
  at timestamptz not null default now(),
  shift_id uuid references public.shifts (id),
  tablet_profile_id uuid references public.tablet_profiles (id),
  cleared_at timestamptz,
  cleared_shift_id uuid references public.shifts (id),
  primary key (point_id, item_kind, item_id, day)
);

alter table public.sold_out enable row level security;
alter table public.sold_out force row level security;
revoke all on public.sold_out from anon, authenticated;
grant select on public.sold_out to authenticated;
-- Tablet đọc qua `sold_out_today()`; chủ đọc thẳng được mọi ngày.
create policy owner_read on public.sold_out for select to authenticated using (private.is_owner());

create trigger live_pulse after insert or update on public.sold_out
  for each statement execute function private.pulse_catalog();

-- Các món / topping đang báo hết hôm nay ở những điểm bán của quầy này (chủ: mọi điểm bán).
create function public.sold_out_today()
returns table (point_id uuid, item_kind text, item_id uuid, day date, at timestamptz)
language sql stable security definer set search_path = public, private as $$
  select s.point_id, s.item_kind, s.item_id, s.day, s.at
    from public.sold_out s
   where s.day = private.business_date(now())
     and s.cleared_at is null
     and (private.is_owner()
          or s.point_id = any (coalesce((select point_ids from public.tablet_profiles
                                          where id = private.my_tablet_profile_id()), '{}')))
$$;

revoke execute on function public.sold_out_today() from public, anon;
grant execute on function public.sold_out_today() to authenticated;

create function private.op_set_sold_out(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  v_shift public.shifts := private.require_shift(p_profile, private.as_uuid(p ->> 'shift_id', 'shift'));
  v_point uuid := private.as_uuid(p ->> 'point_id', 'point');
  v_kind text := p ->> 'item_kind';
  v_item uuid := private.as_uuid(p ->> 'item_id', 'item');
  v_day date := private.business_date(p_at);
  v_on boolean;
  v_menu uuid;
  v_name text;
  v_prev public.sold_out;
begin
  if v_shift.status <> 'open' then perform private.reject('shift_not_open'); end if;
  if coalesce(jsonb_typeof(p -> 'sold_out'), '') <> 'boolean' then perform private.reject('bad_sold_out'); end if;
  v_on := (p ->> 'sold_out')::boolean;
  if coalesce(v_kind, '') not in ('product', 'topping') then perform private.reject('bad_item_kind'); end if;
  if not exists (select 1 from public.tablet_profiles where id = p_profile and v_point = any (point_ids)) then
    perform private.reject('point_not_allowed');
  end if;
  select menu_id into v_menu from public.points where id = v_point;
  if v_kind = 'product' then
    select name into v_name from public.products where id = v_item and menu_id = v_menu;
  else
    select name into v_name from public.toppings where id = v_item and menu_id = v_menu;
  end if;
  if v_name is null then perform private.reject('bad_item'); end if;

  select * into v_prev from public.sold_out
   where point_id = v_point and item_kind = v_kind and item_id = v_item and day = v_day;

  if v_on then
    -- Đã báo hết (vd. máy khác vừa bấm) ⇒ không ghi thêm.
    if found and v_prev.cleared_at is null then return; end if;
    insert into public.sold_out (point_id, item_kind, item_id, day, at, shift_id, tablet_profile_id)
    values (v_point, v_kind, v_item, v_day, p_at, v_shift.id, p_profile)
    on conflict (point_id, item_kind, item_id, day) do update
      set at = excluded.at, shift_id = excluded.shift_id, tablet_profile_id = excluded.tablet_profile_id,
          cleared_at = null, cleared_shift_id = null;
  else
    if not found or v_prev.cleared_at is not null then return; end if;
    update public.sold_out set cleared_at = p_at, cleared_shift_id = v_shift.id
     where point_id = v_point and item_kind = v_kind and item_id = v_item and day = v_day;
  end if;

  perform private.audit(case when v_on then 'sold_out_set' else 'sold_out_clear' end, v_kind, v_item, null,
                        jsonb_build_object('point_id', v_point, 'point_name', (select name from public.points where id = v_point),
                                           'item_kind', v_kind, 'name', v_name, 'day', v_day),
                        p_at, 'staff', v_shift.id, p_profile);
end $$;

-- sync_push: như bản 20261118000002_realtime, thêm `set_sold_out`.
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
      when 'set_sold_out' then perform private.op_set_sold_out(v_profile, op -> 'payload', v_at);
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
