-- Bước 9: dashboard & báo cáo của chủ (mục 7, màn chủ 1–4).
-- Mọi hàm ở đây chỉ chủ gọi được (require_owner); tablet bị từ chối kể cả khi gọi API trực tiếp.

-- ---------------------------------------------------------------- tiện ích

-- Doanh thu (đơn đã thanh toán) trong một khoảng, chia theo hình thức.
create function private.revenue_json(r tstzrange, p_point uuid default null) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'total', coalesce(sum(total), 0),
    'cash', coalesce(sum(total) filter (where payment_method = 'cash'), 0),
    'transfer', coalesce(sum(total) filter (where payment_method = 'transfer'), 0),
    'debt', coalesce(sum(total) filter (where payment_method = 'debt'), 0),
    'orders', count(*))
  from public.orders
  where status = 'paid' and paid_at <@ r and (p_point is null or point_id = p_point)
$$;

-- ---------------------------------------------------------------- Tổng quan (realtime)

-- Hôm nay (giờ VN): doanh thu theo điểm, thu nợ, các ca đang mở, đơn đang chờ (để tô màu chờ lâu).
-- Client gọi lại hàm này mỗi khi Realtime báo `orders` / `shifts` / `debt_payments` đổi.
create function public.owner_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  d date := private.business_date(now());
  r tstzrange := private.day_range(d);
  st public.settings;
begin
  perform private.require_owner();
  select * into st from public.settings limit 1;
  return jsonb_build_object(
    'date', d,
    'server_now', now(),
    'wait', jsonb_build_object('yellow_min', coalesce(st.wait_yellow_min, 5), 'red_min', coalesce(st.wait_red_min, 10)),
    'revenue', private.revenue_json(r),
    'by_point', coalesce((
      select jsonb_agg(jsonb_build_object('point_id', p.id, 'point_name', p.name) || private.revenue_json(r, p.id)
                       order by p.sort, p.name)
        from public.points p
       where p.active or exists (select 1 from public.orders o where o.point_id = p.id and o.status = 'paid' and o.paid_at <@ r)), '[]'),
    'debt_collected', (
      select jsonb_build_object(
        'cash', coalesce(sum(amount) filter (where method = 'cash'), 0),
        'transfer', coalesce(sum(amount) filter (where method = 'transfer'), 0))
        from public.debt_payments where at <@ r),
    'deleted', (
      select jsonb_build_object(
        'count', count(*),
        'served', count(*) filter (where served_at is not null and served_at < deleted_at))
        from public.orders where status = 'deleted' and deleted_at <@ r),
    'open_shifts', coalesce((
      select jsonb_agg(private.shift_ctx(s.id) order by s.opened_at)
        from public.shifts s where s.status = 'open'), '[]'),
    'active_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'code', o.code, 'label', o.label, 'status', o.status,
               'created_at', o.created_at, 'served_at', o.served_at, 'total', o.total,
               'tablet_name', tp.name, 'point_name', p.name)
             order by o.created_at)
        from public.orders o
        join public.tablet_profiles tp on tp.id = o.tablet_profile_id
        join public.points p on p.id = o.point_id
       where o.status in ('open', 'served')), '[]'));
end $$;

-- ---------------------------------------------------------------- Đơn (lọc)

-- "Ngày" của một đơn = lúc đơn kết thúc: thu tiền / xóa; đơn còn mở thì lúc tạo.
create function public.owner_orders(
  p_date date default null,
  p_point uuid default null,
  p_staff uuid default null,
  p_method text default null,
  p_status text default null,
  p_limit int default 300
) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r tstzrange := case when p_date is null then null else private.day_range(p_date) end;
begin
  perform private.require_owner();
  return coalesce((
    select jsonb_agg(x order by (x ->> 'at')::timestamptz desc, x ->> 'id' desc) from (
      select jsonb_build_object(
        'id', o.id, 'code', o.code, 'label', o.label, 'status', o.status, 'dine_type', o.dine_type,
        'point_id', o.point_id, 'point_name', p.name, 'tablet_name', tp.name,
        'total', o.total, 'payment_method', o.payment_method, 'owner_edited', o.owner_edited,
        'created_at', o.created_at, 'served_at', o.served_at, 'paid_at', o.paid_at,
        'deleted_at', o.deleted_at, 'delete_reason', o.delete_reason,
        'at', coalesce(o.paid_at, o.deleted_at, o.created_at),
        'opened_by', so_st.name, 'paid_by', sp_st.name,
        'customer_label', case when o.customer_id is not null then private.customer_label(o.customer_id) end,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('name_snap', i.name_snap, 'qty', i.qty, 'toppings_snap', i.toppings_snap)
                           order by i.sort, i.id)
            from public.order_items i where i.order_id = o.id and i.removed_at is null), '[]')) x
      from public.orders o
      join public.points p on p.id = o.point_id
      join public.tablet_profiles tp on tp.id = o.tablet_profile_id
      join public.shifts so on so.id = o.opened_shift_id
      join public.staff so_st on so_st.id = so.staff_id
      left join public.shifts sp on sp.id = o.paid_shift_id
      left join public.staff sp_st on sp_st.id = sp.staff_id
      where (r is null or coalesce(o.paid_at, o.deleted_at, o.created_at) <@ r)
        and (p_point is null or o.point_id = p_point)
        and (p_staff is null or so.staff_id = p_staff or sp.staff_id = p_staff)
        and (p_method is null or o.payment_method = p_method)
        and (p_status is null or o.status = p_status)
      order by coalesce(o.paid_at, o.deleted_at, o.created_at) desc, o.id desc
      limit greatest(1, least(coalesce(p_limit, 300), 1000))) t), '[]');
end $$;

-- ---------------------------------------------------------------- Báo cáo

-- Như bản bước 8 + sửa `cash` rỗng thành 0, thêm số đơn / thu nợ theo nhân viên và
-- `bank_check`: tổng chuyển khoản theo ngày / điểm (+ thu nợ bằng CK) để chủ so với app ngân hàng.
create or replace function public.owner_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare
  r tstzrange := tstzrange(lower(private.day_range(p_from)), upper(private.day_range(p_to)), '[)');
begin
  perform private.require_owner();
  if p_to < p_from then raise exception 'Khoảng ngày không hợp lệ' using errcode = '22023'; end if;
  return jsonb_build_object(
    'range', jsonb_build_object('from', lower(r), 'to', upper(r), 'from_date', p_from, 'to_date', p_to),
    'revenue', private.revenue_json(r),
    'by_day_point', coalesce((
      select jsonb_agg(x order by x ->> 'date', (x ->> 'point_sort')::int, x ->> 'point_name') from (
        select jsonb_build_object(
          'date', private.business_date(o.paid_at), 'point_id', p.id, 'point_name', p.name, 'point_sort', p.sort,
          'total', sum(o.total),
          'cash', coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0),
          'transfer', coalesce(sum(o.total) filter (where o.payment_method = 'transfer'), 0),
          'debt', coalesce(sum(o.total) filter (where o.payment_method = 'debt'), 0),
          'orders', count(*)) x
        from public.orders o join public.points p on p.id = o.point_id
        where o.status = 'paid' and o.paid_at <@ r
        group by private.business_date(o.paid_at), p.id, p.name, p.sort) t), '[]'),
    'bank_check', coalesce((
      with tr as (
        select private.business_date(o.paid_at) d, o.point_id, sum(o.total) amount, count(*) n
          from public.orders o
         where o.status = 'paid' and o.payment_method = 'transfer' and o.paid_at <@ r
         group by 1, 2),
      dp as (
        select private.business_date(at) d, sum(amount) amount, count(*) n
          from public.debt_payments where method = 'transfer' and at <@ r group by 1),
      days as (select d from tr union select d from dp)
      select jsonb_agg(jsonb_build_object(
               'date', days.d,
               'points', coalesce((
                 select jsonb_agg(jsonb_build_object('point_id', p.id, 'point_name', p.name, 'amount', tr.amount, 'orders', tr.n)
                                  order by p.sort, p.name)
                   from tr join public.points p on p.id = tr.point_id where tr.d = days.d), '[]'),
               'debt_payments', coalesce((select jsonb_build_object('amount', dp.amount, 'count', dp.n) from dp where dp.d = days.d),
                                         jsonb_build_object('amount', 0, 'count', 0)),
               'total', coalesce((select sum(amount) from tr where tr.d = days.d), 0)
                      + coalesce((select amount from dp where dp.d = days.d), 0))
             order by days.d)
        from days), '[]'),
    'by_staff', coalesce((
      select jsonb_agg(x order by x ->> 'staff_name') from (
        select jsonb_build_object(
          'staff_id', st.id, 'staff_name', st.name, 'active', st.active,
          'total', coalesce(sum(o.total), 0),
          'cash', coalesce(sum(o.total) filter (where o.payment_method = 'cash'), 0),
          'transfer', coalesce(sum(o.total) filter (where o.payment_method = 'transfer'), 0),
          'debt', coalesce(sum(o.total) filter (where o.payment_method = 'debt'), 0),
          'orders', count(o.id),
          'debt_collected', coalesce((
            select sum(dp.amount) from public.debt_payments dp join public.shifts s2 on s2.id = dp.shift_id
             where s2.staff_id = st.id and dp.at <@ r), 0),
          'edits', (select count(*) from public.audit_log a where a.staff_id = st.id and a.action = 'order_update' and a.at <@ r),
          'deletes', (select count(*) from public.audit_log a where a.staff_id = st.id and a.action = 'order_delete' and a.at <@ r)) x
        from public.staff st
        left join public.shifts s on s.staff_id = st.id
        left join public.orders o on o.paid_shift_id = s.id and o.status = 'paid' and o.paid_at <@ r
        group by st.id, st.name, st.active) t
      where (x ->> 'active')::boolean or (x ->> 'orders')::int > 0 or (x ->> 'edits')::int > 0 or (x ->> 'deletes')::int > 0), '[]'),
    'by_shift', coalesce((
      select jsonb_agg(private.shift_ctx(s.id) || jsonb_build_object(
               'status', s.status, 'recalculated_at', s.recalculated_at, 'reconcile', private.reconcile_shift(s.id))
             order by s.opened_at)
      from public.shifts s where s.opened_at <@ r), '[]'),
    'top_products', coalesce((
      select jsonb_agg(x order by (x ->> 'qty')::int desc, x ->> 'name') from (
        select jsonb_build_object('product_id', i.product_id, 'name', max(i.name_snap), 'qty', sum(i.qty),
                                  'revenue', sum(i.qty * (i.unit_price_snap + coalesce(
                                    (select sum((t ->> 'price')::int) from jsonb_array_elements(i.toppings_snap) t), 0)))) x
        from public.order_items i join public.orders o on o.id = i.order_id
        where o.status = 'paid' and o.paid_at <@ r and i.removed_at is null
        group by i.product_id
        order by sum(i.qty) desc
        limit 50) t), '[]')
  );
end $$;

revoke execute on function public.owner_dashboard(), public.owner_orders(date, uuid, uuid, text, text, int) from public, anon;
grant execute on function public.owner_dashboard(), public.owner_orders(date, uuid, uuid, text, text, int) to authenticated;
