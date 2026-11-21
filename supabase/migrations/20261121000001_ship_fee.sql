-- Phí ship (SPEC 4.2): đơn ship có thêm phí (tablet có các mức +5k / +10k / +15k / +20k), cộng vào tổng đơn.
-- Tổng đơn = tiền món + phí ship. Doanh thu và tiền mặt kỳ vọng tính cả phí; báo cáo tách "trong đó phí ship".
-- Client cũ không gửi `ship_fee` ⇒ 0, tổng vẫn khớp như trước.

alter table public.orders add column ship_fee int not null default 0;
alter table public.orders add constraint orders_ship_fee
  check (ship_fee >= 0 and ship_fee <= 50000 and ship_fee % 1000 = 0 and (dine_type = 'delivery' or ship_fee = 0));

-- Phí ship gửi lên: chỉ đơn ship, 0–50.000, bội số 1.000. Không phải đơn ship ⇒ 0 (bỏ phí như bỏ địa chỉ).
create function private.order_ship_fee(p jsonb) returns int
language plpgsql immutable as $$
declare
  v int := private.as_int(coalesce(p ->> 'ship_fee', '0'), 'ship_fee', 0);
begin
  if p ->> 'dine_type' <> 'delivery' then return 0; end if;
  if v > 50000 or v % 1000 <> 0 then perform private.reject('bad_ship_fee'); end if;
  return v;
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
  v_fee int;
  v_customer uuid;
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
  v_fee := private.order_ship_fee(o);
  if v_shift.opened_at > p_at + interval '5 minutes' then perform private.reject('bad_shift'); end if;
  v_customer := private.order_customer(p -> 'customer', v_address, v_shift.id, p_profile, p_at);

  -- Số thứ tự + mã đơn: server cấp (sync_push giữ khóa theo hồ sơ tablet ⇒ không trùng giữa các máy).
  v_seq := coalesce((select max(device_seq) from public.orders where tablet_profile_id = p_profile), 0) + 1;
  v_code := private.new_order_code(p_profile, p_at);

  insert into public.orders (id, device_seq, tablet_profile_id, point_id, code, label, table_no, dine_type, address,
                             customer_id, status, opened_shift_id, created_at, ship_fee, total)
  values (v_id, v_seq, p_profile, v_point, v_code, left(nullif(trim(o ->> 'label'), ''), 40),
          left(nullif(trim(o ->> 'table_no'), ''), 10), o ->> 'dine_type', v_address, v_customer, 'open', v_shift.id, p_at,
          v_fee, v_total);

  v_calc := private.write_items(v_id, v_menu, p -> 'items', p_at);
  if v_calc + v_fee <> v_total then perform private.reject('total_mismatch'); end if;

  perform private.audit('order_create', 'order', v_id, null, private.order_json(v_id), p_at, 'staff', v_shift.id, p_profile);
  if v_address is not null then perform private.notify_delivery(v_id, v_shift.id, false, p_at); end if;
end $$;

create or replace function private.op_update_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o public.orders := private.require_open_order(p_profile, private.as_uuid(p ->> 'order_id', 'order'));
  v_before jsonb := private.order_json(o.id);
  v_point uuid := private.as_uuid(p ->> 'point_id', 'point');
  v_menu uuid;
  v_total int := private.as_int(p ->> 'total', 'total', 0);
  v_address text;
  v_fee int;
  v_customer uuid;
  v_calc int;
  v_shift uuid := coalesce(private.current_shift_id(p_profile), o.opened_shift_id);
begin
  if not exists (select 1 from public.tablet_profiles where id = p_profile and v_point = any(point_ids)) then
    perform private.reject('point_not_allowed');
  end if;
  select menu_id into v_menu from public.points where id = v_point;
  v_address := private.order_address(p);
  v_fee := private.order_ship_fee(p);
  v_customer := private.order_customer(p -> 'customer', v_address, v_shift, p_profile, p_at);

  v_calc := private.write_items(o.id, v_menu, p -> 'items', p_at);
  if v_calc + v_fee <> v_total then perform private.reject('total_mismatch'); end if;

  update public.orders set
    point_id = v_point, dine_type = p ->> 'dine_type', address = v_address, customer_id = v_customer,
    label = left(nullif(trim(p ->> 'label'), ''), 40), table_no = left(nullif(trim(p ->> 'table_no'), ''), 10),
    ship_fee = v_fee, total = v_total
  where id = o.id;

  perform private.audit('order_update', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff', v_shift, p_profile);
  -- Đơn vừa chuyển sang ship, đổi địa chỉ giao hoặc đổi khách ⇒ báo lại (sửa món / đổi phí thôi thì không báo).
  if v_address is not null and (v_address is distinct from o.address or v_customer is distinct from o.customer_id) then
    perform private.notify_delivery(o.id, v_shift, o.dine_type = 'delivery', p_at);
  end if;
end $$;

-- Chủ sửa đơn: sửa món ⇒ tổng = tiền món mới + phí ship cũ (chủ chưa sửa được phí).
create or replace function public.owner_edit_order(
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
      v_total := private.write_items(o.id, v_menu, p_items, now()) + o.ship_fee;
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
    customer_id = case when v_method = 'debt' then coalesce(p_customer_id, o.customer_id)
                       when o.dine_type = 'delivery' then o.customer_id end,
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

-- Bill: thêm phí ship (dòng "Phí ship" trước "TỔNG").
create or replace function private.print_doc(p_order uuid) returns jsonb
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
    'ship_fee', o.ship_fee,
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

-- Doanh thu có thêm `ship_fee`: phần phí ship nằm trong `total` (không cộng thêm).
create or replace function private.revenue_json(r tstzrange, p_point uuid default null) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'total', coalesce(sum(total), 0),
    'cash', coalesce(sum(total) filter (where payment_method = 'cash'), 0),
    'transfer', coalesce(sum(total) filter (where payment_method = 'transfer'), 0),
    'debt', coalesce(sum(total) filter (where payment_method = 'debt'), 0),
    'ship_fee', coalesce(sum(ship_fee), 0),
    'orders', count(*))
  from public.orders
  where status = 'paid' and paid_at <@ r and (p_point is null or point_id = p_point)
$$;

-- Như bản 20261117000003_sync, doanh thu thêm `ship_fee` (cùng công thức với src/domain/reconcile.ts).
create or replace function private.reconcile_shift(p_shift uuid) returns jsonb
language plpgsql stable as $$
declare
  s public.shifts;
  adj_cash int; adj_boxes int; adj_plates int;
  rev_cash int; rev_tr int; rev_debt int; rev_fee int; paid_n int;
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
         coalesce(sum(ship_fee), 0),
         count(*)
    into rev_cash, rev_tr, rev_debt, rev_fee, paid_n
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
    'revenue', jsonb_build_object('total', rev_cash + rev_tr + rev_debt, 'cash', rev_cash, 'transfer', rev_tr, 'debt', rev_debt,
                                  'ship_fee', rev_fee),
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
