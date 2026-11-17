-- Đồng bộ từ tablet: RPC idempotent `sync_push`, kiểm giá phía server, phát hiện lỗ hổng device_seq,
-- nhật ký và thông báo. Đối soát ca `reconcile_shift` (cùng công thức với src/domain/reconcile.ts).

-- ---------------------------------------------------------------- tiện ích

-- Từ chối nghiệp vụ: bắt được trong sync_push, không làm hỏng hàng đợi đồng bộ.
create function private.reject(reason text) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'LD001', message = reason;
end $$;

create function private.as_uuid(v text, what text) returns uuid
language plpgsql immutable as $$
begin
  if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform private.reject('bad_' || what);
  end if;
  return v::uuid;
end $$;

create function private.as_int(v text, what text, min_value int default 0) returns int
language plpgsql immutable as $$
begin
  if v is null or v !~ '^-?[0-9]{1,9}$' or v::bigint < min_value then
    perform private.reject('bad_' || what);
  end if;
  return v::int;
end $$;

create function private.as_ts(v text, what text) returns timestamptz
language plpgsql stable as $$
declare t timestamptz;
begin
  begin
    t := v::timestamptz;
  exception when others then
    perform private.reject('bad_' || what);
  end;
  if t is null then perform private.reject('bad_' || what); end if;
  return t;
end $$;

create function private.tz() returns text
language sql stable as $$ select coalesce((select timezone from public.settings limit 1), 'Asia/Ho_Chi_Minh') $$;

create function private.business_date(t timestamptz) returns date
language sql stable as $$ select (t at time zone private.tz())::date $$;

create function private.current_price(p_type text, p_id uuid) returns int
language sql stable as $$
  select case p_type
    when 'product' then (select price from public.products where id = p_id)
    else (select price from public.toppings where id = p_id) end
$$;

-- Giá hợp lệ = giá hiện hành, hoặc giá có hiệu lực tại thời điểm thực hiện (đơn tạo lúc offline trước khi đổi giá).
create function private.price_ok(p_type text, p_id uuid, p_price int, p_at timestamptz) returns boolean
language sql stable as $$
  select p_price = private.current_price(p_type, p_id)
      or p_price = coalesce(
           (select new_price from public.price_history
             where entity_type = p_type and entity_id = p_id and changed_at <= p_at
             order by changed_at desc limit 1),
           (select old_price from public.price_history
             where entity_type = p_type and entity_id = p_id and changed_at > p_at
             order by changed_at asc limit 1),
           private.current_price(p_type, p_id))
$$;

create function private.order_json(p_order uuid) returns jsonb
language sql stable as $$
  select to_jsonb(o) || jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'name_snap', i.name_snap,
      'unit_price_snap', i.unit_price_snap, 'qty', i.qty, 'toppings_snap', i.toppings_snap
    ) order by i.sort, i.id)
    from public.order_items i where i.order_id = o.id and i.removed_at is null
  ), '[]'::jsonb))
  from public.orders o where o.id = p_order
$$;

create function private.shift_ctx(p_shift uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'shift_id', s.id, 'staff_id', s.staff_id, 'staff_name', st.name,
    'tablet_profile_id', s.tablet_profile_id, 'tablet_name', tp.name,
    'opened_at', s.opened_at, 'closed_at', s.closed_at)
  from public.shifts s
  join public.staff st on st.id = s.staff_id
  join public.tablet_profiles tp on tp.id = s.tablet_profile_id
  where s.id = p_shift
$$;

create function private.audit(
  p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb,
  p_at timestamptz, p_actor text, p_shift uuid, p_profile uuid, p_reason text default null
) returns void
language sql as $$
  insert into public.audit_log (at, actor_kind, staff_id, tablet_profile_id, shift_id, action, entity, entity_id, before, after, reason)
  values (p_at, p_actor, (select staff_id from public.shifts where id = p_shift), p_profile, p_shift,
          p_action, p_entity, p_entity_id, p_before, p_after, p_reason)
$$;

-- Thông báo Telegram: chèn vào hàng đợi; trigger gửi qua Edge Function.
create function private.notify(p_kind text, p_payload jsonb, p_performed_at timestamptz default now()) returns uuid
language sql as $$
  insert into public.notifications (kind, payload, performed_at, business_date)
  values (p_kind, p_payload || jsonb_build_object('performed_at', p_performed_at, 'synced_at', now()),
          p_performed_at, private.business_date(p_performed_at))
  returning id
$$;

create function private.customer_balance(p_customer uuid) returns int
language sql stable as $$
  with recursive tree as (
    select id from public.customers where id = p_customer
    union
    select c.id from public.customers c join tree t on c.merged_into_id = t.id
  )
  select (coalesce((select sum(total) from public.orders
                     where status = 'paid' and payment_method = 'debt' and customer_id in (select id from tree)), 0)
        - coalesce((select sum(amount) from public.debt_payments where customer_id in (select id from tree)), 0))::int
$$;

create function private.customer_label(p_customer uuid) returns text
language sql stable as $$
  select case when description is null or description = '' then name else name || ' (' || description || ')' end
  from public.customers where id = p_customer
$$;

-- ---------------------------------------------------------------- bao bì & đối soát

create function private.order_packaging(p_order uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'boxes', coalesce(sum(case when o.dine_type = 'takeaway'
               then i.qty * (p.boxes_takeaway + (select count(*) from jsonb_array_elements(i.toppings_snap) t
                                                  where coalesce((t ->> 'extra_box')::boolean, false)))
               else i.qty * p.boxes_dinein end), 0)::int,
    'plates', coalesce(sum(case when o.dine_type = 'dinein' then i.qty * p.plates_dinein else 0 end), 0)::int)
  from public.orders o
  join public.order_items i on i.order_id = o.id and i.removed_at is null
  join public.products p on p.id = i.product_id
  where o.id = p_order
$$;

-- Cùng công thức với src/domain/reconcile.ts (kiểm bằng tests/fixtures/reconcile-cases.json).
create function private.reconcile_shift(p_shift uuid) returns jsonb
language plpgsql stable as $$
declare
  s public.shifts;
  adj_cash int; adj_boxes int; adj_plates int;
  rev_cash int; rev_tr int; rev_debt int; paid_n int;
  dc_cash int; dc_tr int;
  pk_boxes int; pk_plates int; del_n int; open_n int; das jsonb;
  expected int; used_b int; used_p int;
begin
  select * into s from public.shifts where id = p_shift;
  if not found then return null; end if;

  select coalesce(sum(qty) filter (where kind = 'cash'), 0),
         coalesce(sum(qty) filter (where kind = 'boxes'), 0),
         coalesce(sum(qty) filter (where kind = 'plates'), 0)
    into adj_cash, adj_boxes, adj_plates
    from public.shift_adjustments where shift_id = p_shift;

  -- Tiền: theo ca THU
  select coalesce(sum(total) filter (where payment_method = 'cash'), 0),
         coalesce(sum(total) filter (where payment_method = 'transfer'), 0),
         coalesce(sum(total) filter (where payment_method = 'debt'), 0),
         count(*)
    into rev_cash, rev_tr, rev_debt, paid_n
    from public.orders where status = 'paid' and paid_shift_id = p_shift;

  select coalesce(sum(amount) filter (where method = 'cash'), 0),
         coalesce(sum(amount) filter (where method = 'transfer'), 0)
    into dc_cash, dc_tr
    from public.debt_payments where shift_id = p_shift;

  expected := s.open_float + adj_cash + rev_cash + dc_cash;

  -- Bao bì: theo ca MỞ đơn
  with op as (
    select o.id, o.code, o.status, o.served_at, o.deleted_at, private.order_packaging(o.id) pk
    from public.orders o where o.opened_shift_id = p_shift
  )
  select coalesce(sum((pk ->> 'boxes')::int) filter (where status <> 'deleted'), 0),
         coalesce(sum((pk ->> 'plates')::int) filter (where status <> 'deleted'), 0),
         count(*) filter (where status = 'deleted'),
         count(*) filter (where status in ('open', 'served')),
         coalesce(jsonb_agg(jsonb_build_object('order_id', id, 'code', code,
                    'boxes', (pk ->> 'boxes')::int, 'plates', (pk ->> 'plates')::int) order by deleted_at)
                  filter (where status = 'deleted' and served_at is not null and deleted_at is not null
                          and served_at < deleted_at), '[]'::jsonb)
    into pk_boxes, pk_plates, del_n, open_n, das
    from op;

  used_b := case when s.close_boxes_left is null then null else s.open_boxes + adj_boxes - s.close_boxes_left end;
  used_p := case when s.close_plates_left is null then null else s.open_plates + adj_plates - s.close_plates_left end;

  return jsonb_build_object(
    'revenue', jsonb_build_object('total', rev_cash + rev_tr + rev_debt, 'cash', rev_cash, 'transfer', rev_tr, 'debt', rev_debt),
    'paid_orders', paid_n,
    'debt_collected', jsonb_build_object('cash', dc_cash, 'transfer', dc_tr),
    'cash', jsonb_build_object('expected', expected, 'counted', s.close_cash_counted,
                               'diff', s.close_cash_counted - expected),
    'boxes', jsonb_build_object('used', used_b, 'by_orders', pk_boxes, 'diff', used_b - pk_boxes),
    'plates', jsonb_build_object('used', used_p, 'by_orders', pk_plates, 'diff', used_p - pk_plates),
    'deleted_count', del_n,
    'deleted_after_served', das,
    'open_orders', open_n
  );
end $$;

-- Chỉ chủ đọc được đối soát.
create function public.reconcile_shift(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  return private.reconcile_shift(p_shift);
end $$;

-- ---------------------------------------------------------------- dòng đơn (kiểm giá)

-- Ghi dòng đơn và trả về tổng tính lại.
-- Dòng giữ nguyên (cùng id, cùng món, cùng topping) phải giữ đúng giá đã chụp;
-- dòng mới phải đúng giá hiện hành / giá có hiệu lực lúc thực hiện, và món còn bán.
create function private.write_items(p_order uuid, p_menu uuid, p_items jsonb, p_at timestamptz) returns int
language plpgsql as $$
declare
  it jsonb; tp jsonb;
  v_item_id uuid; v_qty int; v_unit int; v_tp_price int;
  v_prod public.products; v_top public.toppings; v_old public.order_items;
  v_keep boolean; v_exists boolean; v_tops jsonb; v_tp_sum int; v_total int := 0; v_seen uuid[] := '{}'; v_sort int := 0;
  v_old_prices jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.reject('empty_items');
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    v_sort := v_sort + 1;
    v_item_id := private.as_uuid(it ->> 'id', 'item_id');
    if v_item_id = any(v_seen) then perform private.reject('duplicate_item'); end if;
    v_qty := private.as_int(it ->> 'qty', 'qty', 1);
    v_unit := private.as_int(it ->> 'unit_price_snap', 'price', 0);
    select * into v_prod from public.products where id = private.as_uuid(it ->> 'product_id', 'product');
    if not found or v_prod.menu_id <> p_menu then perform private.reject('bad_product'); end if;
    if jsonb_typeof(coalesce(it -> 'toppings_snap', '[]')) <> 'array' then perform private.reject('bad_toppings'); end if;

    select * into v_old from public.order_items where id = v_item_id;
    v_exists := found;
    if v_exists and v_old.order_id <> p_order then perform private.reject('item_id_conflict'); end if;
    v_keep := v_exists and v_old.removed_at is null and v_old.product_id = v_prod.id
      and (select coalesce(array_agg(x ->> 'id' order by x ->> 'id'), '{}') from jsonb_array_elements(v_old.toppings_snap) x)
        = (select coalesce(array_agg(x ->> 'id' order by x ->> 'id'), '{}') from jsonb_array_elements(coalesce(it -> 'toppings_snap', '[]')) x);

    if v_keep then
      if v_unit <> v_old.unit_price_snap then perform private.reject('price_mismatch'); end if;
      v_old_prices := (select coalesce(jsonb_object_agg(x ->> 'id', (x ->> 'price')::int), '{}') from jsonb_array_elements(v_old.toppings_snap) x);
    else
      if v_exists then perform private.reject('item_id_conflict'); end if; -- id cũ nhưng đổi món: phải là dòng mới
      if not v_prod.active then perform private.reject('product_inactive'); end if;
      if not private.price_ok('product', v_prod.id, v_unit, p_at) then perform private.reject('price_mismatch'); end if;
    end if;

    v_tops := '[]'; v_tp_sum := 0;
    for tp in select value from jsonb_array_elements(coalesce(it -> 'toppings_snap', '[]')) loop
      select * into v_top from public.toppings where id = private.as_uuid(tp ->> 'id', 'topping');
      if not found or v_top.menu_id <> p_menu then perform private.reject('bad_topping'); end if;
      v_tp_price := private.as_int(tp ->> 'price', 'price', 0);
      if v_keep then
        if v_tp_price <> (v_old_prices ->> v_top.id::text)::int then perform private.reject('price_mismatch'); end if;
      else
        if not v_top.active then perform private.reject('topping_inactive'); end if;
        if not private.price_ok('topping', v_top.id, v_tp_price, p_at) then perform private.reject('price_mismatch'); end if;
      end if;
      v_tops := v_tops || jsonb_build_array(jsonb_build_object(
        'id', v_top.id, 'name', v_top.name, 'price', v_tp_price, 'extra_box', v_top.extra_box_takeaway));
      v_tp_sum := v_tp_sum + v_tp_price;
    end loop;

    if v_keep then
      update public.order_items set qty = v_qty, sort = v_sort where id = v_item_id;
    else
      insert into public.order_items (id, order_id, product_id, name_snap, unit_price_snap, qty, toppings_snap, sort)
      values (v_item_id, p_order, v_prod.id, v_prod.name, v_unit, v_qty, v_tops, v_sort);
    end if;

    v_total := v_total + (v_unit + v_tp_sum) * v_qty;
    v_seen := v_seen || v_item_id;
  end loop;

  update public.order_items set removed_at = p_at
   where order_id = p_order and removed_at is null and not (id = any(v_seen));

  return v_total;
end $$;

-- ---------------------------------------------------------------- các thao tác đồng bộ

create function private.require_shift(p_profile uuid, p_shift uuid) returns public.shifts
language plpgsql as $$
declare s public.shifts;
begin
  select * into s from public.shifts where id = p_shift and tablet_profile_id = p_profile;
  if not found then perform private.reject('bad_shift'); end if;
  return s;
end $$;

create function private.require_open_order(p_profile uuid, p_order uuid) returns public.orders
language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order and tablet_profile_id = p_profile for update;
  if not found then perform private.reject('order_not_found'); end if;
  if o.status not in ('open', 'served') then perform private.reject('order_not_open'); end if;
  return o;
end $$;

create function private.op_open_shift(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  v_id uuid := private.as_uuid(p ->> 'shift_id', 'shift');
  v_staff uuid := private.as_uuid(p ->> 'staff_id', 'staff');
  tp public.tablet_profiles;
begin
  select * into tp from public.tablet_profiles where id = p_profile;
  if not exists (select 1 from public.staff where id = v_staff and active) then perform private.reject('bad_staff'); end if;
  if exists (select 1 from public.shifts where id = v_id) then perform private.reject('shift_exists'); end if;
  if exists (select 1 from public.shifts where tablet_profile_id = p_profile and status = 'open') then
    perform private.reject('shift_already_open');
  end if;
  insert into public.shifts (id, tablet_profile_id, staff_id, opened_at, open_boxes, open_plates, open_float)
  values (v_id, p_profile, v_staff, p_at, tp.default_boxes, tp.default_plates, tp.default_float);
  perform private.audit('shift_open', 'shift', v_id, null, (select to_jsonb(s) from public.shifts s where id = v_id),
                        p_at, 'staff', v_id, p_profile);
  perform private.notify('shift_open', private.shift_ctx(v_id), p_at);
end $$;

create function private.op_close_shift(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  s public.shifts := private.require_shift(p_profile, private.as_uuid(p ->> 'shift_id', 'shift'));
  v_before jsonb := to_jsonb(s);
begin
  if s.status <> 'open' then perform private.reject('shift_not_open'); end if;
  update public.shifts set
    status = 'closed', closed_at = p_at,
    close_boxes_left = private.as_int(p ->> 'boxes_left', 'boxes_left', 0),
    close_plates_left = private.as_int(p ->> 'plates_left', 'plates_left', 0),
    close_cash_counted = private.as_int(p ->> 'cash_counted', 'cash_counted', 0)
  where id = s.id;
  perform private.audit('shift_close', 'shift', s.id, v_before, (select to_jsonb(x) from public.shifts x where id = s.id),
                        p_at, 'staff', s.id, p_profile);
  perform private.notify('shift_close',
    private.shift_ctx(s.id) || jsonb_build_object('reconcile', private.reconcile_shift(s.id), 'adjusted', false), p_at);
end $$;

-- Lỗ hổng device_seq: đơn n đến ⇒ giải quyết cảnh báo cho n (nếu có), báo thiếu các số giữa max cũ và n.
create function private.check_seq(p_profile uuid, p_seq int, p_at timestamptz) returns void
language plpgsql as $$
declare
  v_prev int;
  v_missing int[];
begin
  update public.seq_gaps set resolved_at = now()
   where tablet_profile_id = p_profile and missing_seq = p_seq and resolved_at is null;

  select max(device_seq) into v_prev from public.orders where tablet_profile_id = p_profile and device_seq < p_seq;
  select coalesce(array_agg(g order by g), '{}') into v_missing
    from generate_series(coalesce(v_prev, 0) + 1, p_seq - 1) g
   where not exists (select 1 from public.orders where tablet_profile_id = p_profile and device_seq = g)
     and not exists (select 1 from public.seq_gaps where tablet_profile_id = p_profile and missing_seq = g);

  if array_length(v_missing, 1) > 0 then
    insert into public.seq_gaps (tablet_profile_id, missing_seq) select p_profile, unnest(v_missing);
    perform private.audit('seq_gap', 'tablet_profile', p_profile, null,
                          jsonb_build_object('missing', to_jsonb(v_missing), 'received', p_seq),
                          p_at, 'system', null, p_profile);
    perform private.notify('seq_gap', jsonb_build_object(
      'tablet_profile_id', p_profile,
      'tablet_name', (select name from public.tablet_profiles where id = p_profile),
      'missing', to_jsonb(v_missing), 'received', p_seq), p_at);
  end if;
end $$;

create function private.op_create_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o jsonb := p -> 'order';
  v_id uuid := private.as_uuid(o ->> 'id', 'order');
  v_seq int := private.as_int(o ->> 'device_seq', 'device_seq', 1);
  v_point uuid := private.as_uuid(o ->> 'point_id', 'point');
  v_shift public.shifts := private.require_shift(p_profile, private.as_uuid(o ->> 'opened_shift_id', 'shift'));
  v_total int := private.as_int(o ->> 'total', 'total', 0);
  v_menu uuid;
  v_calc int;
begin
  if exists (select 1 from public.orders where id = v_id) then perform private.reject('order_exists'); end if;
  if exists (select 1 from public.orders where tablet_profile_id = p_profile and device_seq = v_seq) then
    perform private.reject('device_seq_exists');
  end if;
  if not exists (select 1 from public.tablet_profiles where id = p_profile and v_point = any(point_ids)) then
    perform private.reject('point_not_allowed');
  end if;
  select menu_id into v_menu from public.points where id = v_point and active;
  if v_menu is null then perform private.reject('point_inactive'); end if;
  if coalesce(o ->> 'dine_type', '') not in ('dinein', 'takeaway') then perform private.reject('bad_dine_type'); end if;
  if coalesce(o ->> 'code', '') !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$' then perform private.reject('bad_code'); end if;
  if v_shift.opened_at > p_at + interval '5 minutes' then perform private.reject('bad_shift'); end if;

  insert into public.orders (id, device_seq, tablet_profile_id, point_id, code, label, table_no, dine_type,
                             status, opened_shift_id, created_at, total)
  values (v_id, v_seq, p_profile, v_point, o ->> 'code', left(nullif(trim(o ->> 'label'), ''), 40),
          left(nullif(trim(o ->> 'table_no'), ''), 10), o ->> 'dine_type', 'open', v_shift.id, p_at, v_total);

  v_calc := private.write_items(v_id, v_menu, p -> 'items', p_at);
  if v_calc <> v_total then perform private.reject('total_mismatch'); end if;

  perform private.audit('order_create', 'order', v_id, null, private.order_json(v_id), p_at, 'staff', v_shift.id, p_profile);
  perform private.check_seq(p_profile, v_seq, p_at);
end $$;

create function private.current_shift_id(p_profile uuid) returns uuid
language sql stable as $$
  select id from public.shifts where tablet_profile_id = p_profile and status = 'open'
$$;

create function private.op_update_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o public.orders := private.require_open_order(p_profile, private.as_uuid(p ->> 'order_id', 'order'));
  v_before jsonb := private.order_json(o.id);
  v_point uuid := private.as_uuid(p ->> 'point_id', 'point');
  v_menu uuid;
  v_total int := private.as_int(p ->> 'total', 'total', 0);
  v_calc int;
begin
  if not exists (select 1 from public.tablet_profiles where id = p_profile and v_point = any(point_ids)) then
    perform private.reject('point_not_allowed');
  end if;
  select menu_id into v_menu from public.points where id = v_point;
  if coalesce(p ->> 'dine_type', '') not in ('dinein', 'takeaway') then perform private.reject('bad_dine_type'); end if;

  v_calc := private.write_items(o.id, v_menu, p -> 'items', p_at);
  if v_calc <> v_total then perform private.reject('total_mismatch'); end if;

  update public.orders set
    point_id = v_point, dine_type = p ->> 'dine_type',
    label = left(nullif(trim(p ->> 'label'), ''), 40), table_no = left(nullif(trim(p ->> 'table_no'), ''), 10),
    total = v_total
  where id = o.id;

  perform private.audit('order_update', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff',
                        coalesce(private.current_shift_id(p_profile), o.opened_shift_id), p_profile);
end $$;

create function private.op_serve_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o public.orders := private.require_open_order(p_profile, private.as_uuid(p ->> 'order_id', 'order'));
  v_before jsonb := private.order_json(o.id);
begin
  if o.status <> 'open' then perform private.reject('already_served'); end if;
  update public.orders set status = 'served', served_at = p_at where id = o.id;
  perform private.audit('order_serve', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff',
                        coalesce(private.current_shift_id(p_profile), o.opened_shift_id), p_profile);
end $$;

create function private.op_delete_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o public.orders := private.require_open_order(p_profile, private.as_uuid(p ->> 'order_id', 'order'));
  v_before jsonb := private.order_json(o.id);
  v_reason text := p ->> 'reason';
  v_shift uuid := coalesce(private.current_shift_id(p_profile), o.opened_shift_id);
begin
  if coalesce(v_reason, '') not in ('mistake', 'customer_left', 'customer_changed', 'other') then
    perform private.reject('bad_reason');
  end if;
  update public.orders set status = 'deleted', deleted_at = p_at, delete_reason = v_reason where id = o.id;
  perform private.audit('order_delete', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff', v_shift, p_profile, v_reason);
  perform private.notify('order_deleted', private.shift_ctx(v_shift) || jsonb_build_object(
    'order', v_before, 'reason', v_reason, 'was_served', o.status = 'served'), p_at);
end $$;

create function private.op_pay_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o public.orders := private.require_open_order(p_profile, private.as_uuid(p ->> 'order_id', 'order'));
  v_before jsonb := private.order_json(o.id);
  v_shift public.shifts := private.require_shift(p_profile, private.as_uuid(p ->> 'paid_shift_id', 'shift'));
  v_method text := p ->> 'method';
  v_given int;
  c jsonb := p -> 'customer';
  v_customer uuid;
begin
  if private.as_int(p ->> 'total', 'total', 0) <> o.total then perform private.reject('total_mismatch'); end if;
  if coalesce(v_method, '') not in ('cash', 'transfer', 'debt') then perform private.reject('bad_method'); end if;

  if v_method = 'cash' then
    v_given := private.as_int(p ->> 'cash_given', 'cash_given', 0);
    if v_given < o.total then perform private.reject('cash_short'); end if;
  elsif v_method = 'debt' then
    if c is null or length(trim(coalesce(c ->> 'name', ''))) = 0 then perform private.reject('customer_required'); end if;
    v_customer := private.as_uuid(c ->> 'id', 'customer');
    if not exists (select 1 from public.customers where id = v_customer) then
      insert into public.customers (id, name, description, phone, created_by_shift_id)
      values (v_customer, trim(c ->> 'name'), nullif(trim(c ->> 'description'), ''), nullif(trim(c ->> 'phone'), ''), v_shift.id);
      perform private.audit('customer_create', 'customer', v_customer, null,
                            (select to_jsonb(x) from public.customers x where id = v_customer), p_at, 'staff', v_shift.id, p_profile);
    end if;
  end if;

  update public.orders set
    status = 'paid', paid_at = p_at, paid_shift_id = v_shift.id, payment_method = v_method,
    cash_given = v_given, customer_id = v_customer
  where id = o.id;

  perform private.audit('order_pay', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff', v_shift.id, p_profile);
  if v_method = 'debt' then
    perform private.notify('debt_recorded', private.shift_ctx(v_shift.id) || jsonb_build_object(
      'order_code', o.code, 'order_id', o.id, 'amount', o.total, 'customer_id', v_customer,
      'customer_label', private.customer_label(v_customer), 'balance', private.customer_balance(v_customer)), p_at);
  end if;
end $$;

create function private.op_debt_payment(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  v_id uuid := private.as_uuid(p ->> 'id', 'payment');
  v_customer uuid := private.as_uuid(p ->> 'customer_id', 'customer');
  v_shift public.shifts := private.require_shift(p_profile, private.as_uuid(p ->> 'shift_id', 'shift'));
  v_amount int := private.as_int(p ->> 'amount', 'amount', 1);
  v_method text := p ->> 'method';
begin
  if coalesce(v_method, '') not in ('cash', 'transfer') then perform private.reject('bad_method'); end if;
  if not exists (select 1 from public.customers where id = v_customer) then perform private.reject('bad_customer'); end if;
  if exists (select 1 from public.debt_payments where id = v_id) then perform private.reject('payment_exists'); end if;
  insert into public.debt_payments (id, customer_id, amount, method, shift_id, at)
  values (v_id, v_customer, v_amount, v_method, v_shift.id, p_at);
  perform private.audit('debt_payment', 'customer', v_customer, null,
                        (select to_jsonb(x) from public.debt_payments x where id = v_id), p_at, 'staff', v_shift.id, p_profile);
  perform private.notify('debt_paid', private.shift_ctx(v_shift.id) || jsonb_build_object(
    'customer_id', v_customer, 'customer_label', private.customer_label(v_customer),
    'amount', v_amount, 'method', v_method, 'balance', private.customer_balance(v_customer)), p_at);
end $$;

-- ---------------------------------------------------------------- RPC đồng bộ (idempotent)

create function public.sync_push(op jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_profile uuid := private.my_tablet_profile_id();
  v_op_id uuid;
  v_kind text := op ->> 'kind';
  v_at timestamptz;
  v_result jsonb;
begin
  if v_profile is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(op ->> 'op_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'bad op_id' using errcode = '22023'; end if;
  v_op_id := (op ->> 'op_id')::uuid;

  -- Tuần tự hóa theo tablet để kiểm tra trùng / thứ tự an toàn.
  perform pg_advisory_xact_lock(hashtext(v_profile::text));
  if exists (select 1 from public.sync_ops where op_id = v_op_id) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  begin
    v_at := private.as_ts(op ->> 'performed_at', 'performed_at');
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
    values (coalesce(v_at, now()), 'staff', v_profile, 'sync_rejected', coalesce(v_kind, 'unknown'),
            case when op ->> 'entity_id' ~* '^[0-9a-f-]{36}$' then (op ->> 'entity_id')::uuid end, op, sqlerrm);
    perform private.notify('sync_rejected', jsonb_build_object(
      'tablet_profile_id', v_profile, 'tablet_name', (select name from public.tablet_profiles where id = v_profile),
      'kind', v_kind, 'reason', sqlerrm), coalesce(v_at, now()));
  end;

  insert into public.sync_ops (op_id, tablet_profile_id, kind, entity_id, performed_at, result)
  values (v_op_id, v_profile, coalesce(v_kind, 'unknown'),
          case when op ->> 'entity_id' ~* '^[0-9a-f-]{36}$' then (op ->> 'entity_id')::uuid end,
          coalesce(v_at, now()), v_result);
  return v_result;
end $$;

-- ---------------------------------------------------------------- RPC đọc cho tablet

-- Chỉ trả cấu hình tablet cần (không lộ telegram/giờ tổng kết...).
create function public.tablet_config() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when private.is_tablet() or private.is_owner() then
    (select jsonb_build_object('wait_yellow_min', wait_yellow_min, 'wait_red_min', wait_red_min, 'timezone', timezone)
       from public.settings limit 1)
  end
$$;

-- Dư nợ theo khách gốc (tablet được xem để thu nợ / gợi ý).
create function public.customer_balances()
returns table (customer_id uuid, balance int)
language sql stable security definer set search_path = public, private as $$
  select c.id, private.customer_balance(c.id)
    from public.customers c
   where c.merged_into_id is null and (private.is_tablet() or private.is_owner())
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.sync_push(jsonb), public.tablet_config(), public.customer_balances(),
  public.reconcile_shift(uuid) to authenticated;
