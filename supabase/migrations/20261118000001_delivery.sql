-- Đơn ship: loại đơn thứ ba bên cạnh Tại chỗ / Mang về, có dòng địa chỉ; tạo đơn ship ⇒ báo Telegram.
-- Bao bì của đơn ship tính như mang về.

alter table public.orders drop constraint orders_dine_type_check;
alter table public.orders add constraint orders_dine_type_check check (dine_type in ('dinein', 'takeaway', 'delivery'));
alter table public.orders add column address text;
alter table public.orders add constraint orders_delivery_address
  check (dine_type <> 'delivery' or (address is not null and address <> ''));

create or replace function private.order_packaging(p_order uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'boxes', coalesce(sum(case when o.dine_type in ('takeaway', 'delivery')
               then i.qty * (p.boxes_takeaway + (select count(*) from jsonb_array_elements(i.toppings_snap) t
                                                  where coalesce((t ->> 'extra_box')::boolean, false)))
               else i.qty * p.boxes_dinein end), 0)::int,
    'plates', coalesce(sum(case when o.dine_type = 'dinein' then i.qty * p.plates_dinein else 0 end), 0)::int)
  from public.orders o
  join public.order_items i on i.order_id = o.id and i.removed_at is null
  join public.products p on p.id = i.product_id
  where o.id = p_order
$$;

-- Kiểm loại đơn + địa chỉ; trả địa chỉ đã chuẩn hóa (null nếu không phải đơn ship).
create function private.order_address(p jsonb) returns text
language plpgsql stable as $$
declare
  v_address text := left(nullif(trim(p ->> 'address'), ''), 200);
begin
  if coalesce(p ->> 'dine_type', '') not in ('dinein', 'takeaway', 'delivery') then perform private.reject('bad_dine_type'); end if;
  if p ->> 'dine_type' <> 'delivery' then return null; end if;
  if v_address is null then perform private.reject('address_required'); end if;
  return v_address;
end $$;

create function private.notify_delivery(p_order uuid, p_shift uuid, p_updated boolean, p_at timestamptz) returns void
language sql as $$
  select private.notify('delivery_order', private.shift_ctx(p_shift) || jsonb_build_object(
    'order', private.order_json(p_order),
    'point_name', (select pt.name from public.orders o join public.points pt on pt.id = o.point_id where o.id = p_order),
    'updated', p_updated), p_at)
$$;

create or replace function private.op_create_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  o jsonb := p -> 'order';
  v_id uuid := private.as_uuid(o ->> 'id', 'order');
  v_seq int := private.as_int(o ->> 'device_seq', 'device_seq', 1);
  v_point uuid := private.as_uuid(o ->> 'point_id', 'point');
  v_shift public.shifts := private.require_shift(p_profile, private.as_uuid(o ->> 'opened_shift_id', 'shift'));
  v_total int := private.as_int(o ->> 'total', 'total', 0);
  v_address text;
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
  v_address := private.order_address(o);
  if coalesce(o ->> 'code', '') !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$' then perform private.reject('bad_code'); end if;
  if v_shift.opened_at > p_at + interval '5 minutes' then perform private.reject('bad_shift'); end if;

  insert into public.orders (id, device_seq, tablet_profile_id, point_id, code, label, table_no, dine_type, address,
                             status, opened_shift_id, created_at, total)
  values (v_id, v_seq, p_profile, v_point, o ->> 'code', left(nullif(trim(o ->> 'label'), ''), 40),
          left(nullif(trim(o ->> 'table_no'), ''), 10), o ->> 'dine_type', v_address, 'open', v_shift.id, p_at, v_total);

  v_calc := private.write_items(v_id, v_menu, p -> 'items', p_at);
  if v_calc <> v_total then perform private.reject('total_mismatch'); end if;

  perform private.audit('order_create', 'order', v_id, null, private.order_json(v_id), p_at, 'staff', v_shift.id, p_profile);
  perform private.check_seq(p_profile, v_seq, p_at);
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
  v_calc int;
  v_shift uuid := coalesce(private.current_shift_id(p_profile), o.opened_shift_id);
begin
  if not exists (select 1 from public.tablet_profiles where id = p_profile and v_point = any(point_ids)) then
    perform private.reject('point_not_allowed');
  end if;
  select menu_id into v_menu from public.points where id = v_point;
  v_address := private.order_address(p);

  v_calc := private.write_items(o.id, v_menu, p -> 'items', p_at);
  if v_calc <> v_total then perform private.reject('total_mismatch'); end if;

  update public.orders set
    point_id = v_point, dine_type = p ->> 'dine_type', address = v_address,
    label = left(nullif(trim(p ->> 'label'), ''), 40), table_no = left(nullif(trim(p ->> 'table_no'), ''), 10),
    total = v_total
  where id = o.id;

  perform private.audit('order_update', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff', v_shift, p_profile);
  -- Đơn vừa chuyển sang ship, hoặc đổi địa chỉ giao ⇒ báo lại (sửa món thôi thì không báo).
  if v_address is not null and v_address is distinct from o.address then
    perform private.notify_delivery(o.id, v_shift, o.dine_type = 'delivery', p_at);
  end if;
end $$;
