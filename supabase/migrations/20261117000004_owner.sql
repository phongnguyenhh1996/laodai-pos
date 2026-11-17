-- Thao tác của chủ, báo cáo, tổng kết ngày (pg_cron) và gửi Telegram (pg_net → Edge Function).

create function private.require_owner() returns void
language plpgsql stable as $$
begin
  if not private.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create function private.mark_recalculated(p_shift uuid) returns void
language sql as $$
  update public.shifts set recalculated_at = now() where id = p_shift and status = 'closed'
$$;

-- ---------------------------------------------------------------- kích hoạt tablet / chế độ chủ

-- Gọi bởi Edge Function activate-tablet bằng token của chủ.
create function public.activate_tablet_profile(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare tp public.tablet_profiles;
begin
  perform private.require_owner();
  select * into tp from public.tablet_profiles where id = p_profile;
  if not found then raise exception 'Không có hồ sơ tablet' using errcode = 'P0002'; end if;
  perform private.audit('tablet_login', 'tablet_profile', tp.id, null, to_jsonb(tp), now(), 'owner', null, tp.id);
  perform private.notify('tablet_login', jsonb_build_object('tablet_profile_id', tp.id, 'tablet_name', tp.name));
  return jsonb_build_object(
    'profile', to_jsonb(tp),
    'last_device_seq', coalesce((select max(device_seq) from public.orders where tablet_profile_id = tp.id), 0));
end $$;

create function public.owner_mode_entered(p_profile uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare v_name text;
begin
  perform private.require_owner();
  select name into v_name from public.tablet_profiles where id = p_profile;
  perform private.audit('owner_mode', 'tablet_profile', p_profile, null, null, now(), 'owner', null, p_profile);
  perform private.notify('owner_mode', jsonb_build_object('tablet_profile_id', p_profile, 'tablet_name', v_name));
end $$;

-- ---------------------------------------------------------------- ca

create function public.owner_adjust_shift(p_shift uuid, p_kind text, p_qty int, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid; s public.shifts;
begin
  perform private.require_owner();
  select * into s from public.shifts where id = p_shift;
  if not found then raise exception 'Không có ca' using errcode = 'P0002'; end if;
  insert into public.shift_adjustments (shift_id, kind, qty, note) values (p_shift, p_kind, p_qty, p_note)
  returning id into v_id;
  perform private.audit('shift_adjust', 'shift', p_shift, null,
                        (select to_jsonb(a) from public.shift_adjustments a where id = v_id), now(), 'owner', p_shift, s.tablet_profile_id);
  perform private.mark_recalculated(p_shift);
  return v_id;
end $$;

-- ---------------------------------------------------------------- sửa đơn đã thanh toán

create function public.owner_edit_order(
  p_order uuid,
  p_items jsonb default null,
  p_payment_method text default null,
  p_customer_id uuid default null,
  p_cash_given int default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  o public.orders;
  v_before jsonb;
  v_after jsonb;
  v_method text;
  v_total int;
  v_menu uuid;
  v_shifts uuid[];
  v_rec_before jsonb := '{}';
  v_rec_after jsonb := '{}';
  sid uuid;
begin
  perform private.require_owner();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Không có đơn' using errcode = 'P0002'; end if;
  if o.status <> 'paid' then raise exception 'Chỉ sửa được đơn đã thanh toán' using errcode = '22023'; end if;

  v_before := private.order_json(o.id);
  v_shifts := array(select distinct x from unnest(array[o.opened_shift_id, o.paid_shift_id]) x
                     where exists (select 1 from public.shifts where id = x and status = 'closed'));
  foreach sid in array v_shifts loop
    v_rec_before := v_rec_before || jsonb_build_object(sid::text, private.reconcile_shift(sid));
  end loop;

  v_total := o.total;
  if p_items is not null then
    select menu_id into v_menu from public.points where id = o.point_id;
    begin
      v_total := private.write_items(o.id, v_menu, p_items, now());
    exception when sqlstate 'LD001' then
      raise exception 'Món không hợp lệ: %', sqlerrm using errcode = '22023';
    end;
  end if;

  v_method := coalesce(p_payment_method, o.payment_method);
  if v_method not in ('cash', 'transfer', 'debt') then raise exception 'Hình thức không hợp lệ' using errcode = '22023'; end if;
  if v_method = 'debt' and coalesce(p_customer_id, o.customer_id) is null then
    raise exception 'Ghi nợ cần khách' using errcode = '22023';
  end if;

  update public.orders set
    total = v_total,
    payment_method = v_method,
    customer_id = case when v_method = 'debt' then coalesce(p_customer_id, o.customer_id) end,
    cash_given = case when v_method = 'cash' then greatest(coalesce(p_cash_given, o.cash_given, v_total), v_total) end,
    owner_edited = true
  where id = o.id;

  v_after := private.order_json(o.id);
  perform private.audit('owner_edit_order', 'order', o.id, v_before, v_after, now(), 'owner', o.paid_shift_id, o.tablet_profile_id);

  foreach sid in array v_shifts loop
    perform private.mark_recalculated(sid);
    v_rec_after := v_rec_after || jsonb_build_object(sid::text, private.reconcile_shift(sid));
  end loop;

  perform private.notify('owner_edit', jsonb_build_object(
    'order_id', o.id, 'order_code', o.code,
    'tablet_name', (select name from public.tablet_profiles where id = o.tablet_profile_id),
    'before', v_before, 'after', v_after,
    'recalculated', jsonb_build_object('before', v_rec_before, 'after', v_rec_after)));

  return v_after;
end $$;

-- ---------------------------------------------------------------- sổ nợ

create function public.owner_transfer_debt(p_order_ids uuid[], p_to uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare o public.orders; v_before jsonb;
begin
  perform private.require_owner();
  if not exists (select 1 from public.customers where id = p_to and merged_into_id is null) then
    raise exception 'Khách nhận không hợp lệ' using errcode = '22023';
  end if;
  for o in select * from public.orders where id = any(p_order_ids) for update loop
    if o.status <> 'paid' or o.payment_method <> 'debt' then
      raise exception 'Đơn % không phải khoản nợ', o.code using errcode = '22023';
    end if;
    v_before := private.order_json(o.id);
    update public.orders set customer_id = p_to where id = o.id;
    perform private.audit('debt_transfer', 'order', o.id, v_before, private.order_json(o.id), now(), 'owner', null, o.tablet_profile_id);
  end loop;
  if (select count(*) from public.orders where id = any(p_order_ids)) <> cardinality(p_order_ids) then
    raise exception 'Có đơn không tồn tại' using errcode = 'P0002';
  end if;
end $$;

create function public.owner_record_debt_payment(p_customer uuid, p_amount int, p_method text) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid := gen_random_uuid();
begin
  perform private.require_owner();
  insert into public.debt_payments (id, customer_id, amount, method, shift_id, at)
  values (v_id, p_customer, p_amount, p_method, null, now());
  perform private.audit('debt_payment', 'customer', p_customer, null,
                        (select to_jsonb(x) from public.debt_payments x where id = v_id), now(), 'owner', null, null);
  perform private.notify('debt_paid', jsonb_build_object(
    'staff_name', 'Chủ', 'tablet_name', null,
    'customer_id', p_customer, 'customer_label', private.customer_label(p_customer),
    'amount', p_amount, 'method', p_method, 'balance', private.customer_balance(p_customer)));
  return v_id;
end $$;

-- ---------------------------------------------------------------- báo cáo

create function private.day_range(d date) returns tstzrange
language sql stable as $$
  select tstzrange((d::timestamp) at time zone private.tz(), ((d + 1)::timestamp) at time zone private.tz(), '[)')
$$;

create function public.owner_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  r tstzrange := tstzrange(lower(private.day_range(p_from)), upper(private.day_range(p_to)), '[)');
begin
  perform private.require_owner();
  return jsonb_build_object(
    'range', jsonb_build_object('from', lower(r), 'to', upper(r)),
    'by_day_point', coalesce((
      select jsonb_agg(x order by x ->> 'date', x ->> 'point_name') from (
        select jsonb_build_object(
          'date', private.business_date(o.paid_at), 'point_id', p.id, 'point_name', p.name,
          'total', sum(o.total), 'cash', sum(o.total) filter (where payment_method = 'cash'),
          'transfer', coalesce(sum(o.total) filter (where payment_method = 'transfer'), 0),
          'debt', coalesce(sum(o.total) filter (where payment_method = 'debt'), 0),
          'orders', count(*)) x
        from public.orders o join public.points p on p.id = o.point_id
        where o.status = 'paid' and o.paid_at <@ r
        group by private.business_date(o.paid_at), p.id, p.name) t), '[]'),
    'by_staff', coalesce((
      select jsonb_agg(x order by x ->> 'staff_name') from (
        select jsonb_build_object(
          'staff_id', st.id, 'staff_name', st.name,
          'total', coalesce(sum(o.total), 0),
          'cash', coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0),
          'transfer', coalesce(sum(o.total) filter (where o.payment_method = 'transfer'), 0),
          'debt', coalesce(sum(o.total) filter (where o.payment_method = 'debt'), 0),
          'edits', (select count(*) from public.audit_log a where a.staff_id = st.id and a.action = 'order_update' and a.at <@ r),
          'deletes', (select count(*) from public.audit_log a where a.staff_id = st.id and a.action = 'order_delete' and a.at <@ r)) x
        from public.staff st
        left join public.shifts s on s.staff_id = st.id
        left join public.orders o on o.paid_shift_id = s.id and o.status = 'paid' and o.paid_at <@ r
        group by st.id, st.name) t), '[]'),
    'by_shift', coalesce((
      select jsonb_agg(private.shift_ctx(s.id) || jsonb_build_object(
               'status', s.status, 'recalculated_at', s.recalculated_at, 'reconcile', private.reconcile_shift(s.id))
             order by s.opened_at)
      from public.shifts s where s.opened_at <@ r), '[]'),
    'top_products', coalesce((
      select jsonb_agg(x order by (x ->> 'qty')::int desc) from (
        select jsonb_build_object('product_id', i.product_id, 'name', max(i.name_snap), 'qty', sum(i.qty),
                                  'revenue', sum(i.qty * (i.unit_price_snap + coalesce(
                                    (select sum((t ->> 'price')::int) from jsonb_array_elements(i.toppings_snap) t), 0)))) x
        from public.order_items i join public.orders o on o.id = i.order_id
        where o.status = 'paid' and o.paid_at <@ r and i.removed_at is null
        group by i.product_id limit 50) t), '[]')
  );
end $$;

-- ---------------------------------------------------------------- tổng kết ngày

create function private.build_daily_summary(d date) returns jsonb
language sql stable as $$
  with r as (select private.day_range(d) rg)
  select jsonb_build_object(
    'date', d,
    'range', jsonb_build_object('from', lower(r.rg), 'to', upper(r.rg)),
    'revenue', jsonb_build_object(
      'total', coalesce((select sum(total) from public.orders where status = 'paid' and paid_at <@ r.rg), 0),
      'cash', coalesce((select sum(total) from public.orders where status = 'paid' and payment_method = 'cash' and paid_at <@ r.rg), 0),
      'transfer', coalesce((select sum(total) from public.orders where status = 'paid' and payment_method = 'transfer' and paid_at <@ r.rg), 0),
      'debt', coalesce((select sum(total) from public.orders where status = 'paid' and payment_method = 'debt' and paid_at <@ r.rg), 0)),
    'by_point', coalesce((
      select jsonb_agg(jsonb_build_object('point_name', p.name, 'total', x.total) order by p.sort, p.name)
      from (select point_id, sum(total) total from public.orders
             where status = 'paid' and paid_at <@ r.rg group by point_id) x
      join public.points p on p.id = x.point_id), '[]'),
    'debt_collected', coalesce((select sum(amount) from public.debt_payments where at <@ r.rg), 0),
    'deleted', jsonb_build_object(
      'count', (select count(*) from public.orders where status = 'deleted' and deleted_at <@ r.rg),
      'served', (select count(*) from public.orders where status = 'deleted' and deleted_at <@ r.rg
                   and served_at is not null and served_at < deleted_at)),
    'shifts', coalesce((
      select jsonb_agg(private.shift_ctx(s.id) || jsonb_build_object(
               'status', s.status, 'reconcile', private.reconcile_shift(s.id)) order by s.opened_at)
      from public.shifts s where s.opened_at <@ r.rg), '[]'),
    'open_orders', (select count(*) from public.orders where status in ('open', 'served')),
    'unresolved_gaps', (select count(*) from public.seq_gaps where resolved_at is null))
  from r
$$;

-- Gọi thẳng trong test (H38) hoặc bởi cron. Trả về id thông báo.
create function public.run_daily_summary(p_day date default null) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare d date := coalesce(p_day, private.business_date(now()));
begin
  if not (private.is_owner() or coalesce(auth.role(), '') = 'service_role' or current_user = 'postgres') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- performed_at nằm trong ngày được tổng kết (để business_date của thông báo = d)
  return private.notify('daily_summary', private.build_daily_summary(d),
    least(now(), upper(private.day_range(d)) - interval '1 second'));
end $$;

-- Cron mỗi phút: đến giờ tổng kết (theo giờ VN) và hôm nay chưa gửi ⇒ gửi.
create function private.daily_summary_tick(p_now timestamptz default now()) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  st public.settings;
  d date := private.business_date(p_now);
begin
  select * into st from public.settings limit 1;
  if (p_now at time zone private.tz())::time < st.daily_summary_time then return null; end if;
  if exists (select 1 from public.notifications where kind = 'daily_summary' and business_date = d) then return null; end if;
  return private.notify('daily_summary', private.build_daily_summary(d), p_now);
end $$;

-- ---------------------------------------------------------------- gửi Telegram

create function private.dispatch_notification() returns trigger
language plpgsql security definer set search_path = public, private, net as $$
declare v_url text := (select value from private.config where key = 'functions_url');
begin
  if v_url is not null then
    perform net.http_post(
      url := v_url || '/telegram-dispatch',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000);
  end if;
  return new;
end $$;

create trigger dispatch after insert on public.notifications
  for each row execute function private.dispatch_notification();

-- Gửi lại tin lỗi (tối đa 5 lần).
create function private.retry_notifications() returns void
language plpgsql security definer set search_path = public, private, net as $$
declare n record; v_url text := (select value from private.config where key = 'functions_url');
begin
  if v_url is null then return; end if;
  for n in select id from public.notifications
            where sent_at is null and attempts between 1 and 4 and created_at > now() - interval '1 day' loop
    perform net.http_post(url := v_url || '/telegram-dispatch', body := jsonb_build_object('id', n.id),
                          headers := jsonb_build_object('Content-Type', 'application/json'));
  end loop;
end $$;

select cron.schedule('laodai-daily-summary', '* * * * *', $$select private.daily_summary_tick()$$);
select cron.schedule('laodai-retry-notifications', '*/5 * * * *', $$select private.retry_notifications()$$);

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.activate_tablet_profile(uuid), public.owner_mode_entered(uuid), public.owner_adjust_shift(uuid, text, int, text),
  public.owner_edit_order(uuid, jsonb, text, uuid, int), public.owner_transfer_debt(uuid[], uuid),
  public.owner_record_debt_payment(uuid, int, text), public.owner_report(date, date), public.run_daily_summary(date)
  to authenticated;
grant execute on function public.run_daily_summary(date) to service_role;
