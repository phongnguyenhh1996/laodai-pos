-- Khách cho đơn ship: danh sách khách (vốn chỉ dùng cho ghi nợ / thu nợ) giờ chọn được cho đơn ship.
-- • Khách có thêm địa chỉ (địa chỉ giao gần nhất): chọn khách ⇒ tablet điền sẵn địa chỉ.
-- • Đơn ship giữ `customer_id` cả khi trả tiền mặt / chuyển khoản (trước đây chỉ đơn ghi nợ mới có khách).
--   Dư nợ vẫn chỉ tính đơn `payment_method = 'debt'` nên không bị ảnh hưởng.
-- • Chọn khách chưa có trong danh sách ⇒ tạo khách mới cùng lúc tạo / sửa đơn (như ghi nợ).

alter table public.customers add column address text;

alter table public.orders drop constraint orders_check1;
alter table public.orders add constraint orders_debt_customer check (payment_method is distinct from 'debt' or customer_id is not null);

-- Khách của đơn ship: tạo mới nếu chưa có, lưu địa chỉ giao gần nhất. Không phải đơn ship / không chọn khách ⇒ null.
create function private.order_customer(
  p_customer jsonb, p_address text, p_shift uuid, p_profile uuid, p_at timestamptz
) returns uuid
language plpgsql as $$
declare
  v_id uuid;
  v_before jsonb;
begin
  if p_address is null or p_customer is null or jsonb_typeof(p_customer) <> 'object' then return null; end if;
  v_id := private.as_uuid(p_customer ->> 'id', 'customer');
  if not exists (select 1 from public.customers where id = v_id) then
    if length(trim(coalesce(p_customer ->> 'name', ''))) = 0 then perform private.reject('customer_required'); end if;
    insert into public.customers (id, name, description, phone, address, created_by_shift_id)
    values (v_id, left(trim(p_customer ->> 'name'), 60), left(nullif(trim(p_customer ->> 'description'), ''), 80),
            left(nullif(trim(p_customer ->> 'phone'), ''), 20), p_address, p_shift);
    perform private.audit('customer_create', 'customer', v_id, null,
                          (select to_jsonb(x) from public.customers x where id = v_id), p_at, 'staff', p_shift, p_profile);
  else
    -- Khách đã gộp vào khách khác ⇒ gắn đơn cho khách gốc.
    while (select merged_into_id from public.customers where id = v_id) is not null loop
      v_id := (select merged_into_id from public.customers where id = v_id);
    end loop;
    select to_jsonb(x) into v_before from public.customers x where id = v_id;
    if v_before ->> 'address' is distinct from p_address then
      update public.customers set address = p_address where id = v_id;
      perform private.audit('customer_address', 'customer', v_id, v_before,
                            (select to_jsonb(x) from public.customers x where id = v_id), p_at, 'staff', p_shift, p_profile);
    end if;
  end if;
  return v_id;
end $$;

create or replace function private.notify_delivery(p_order uuid, p_shift uuid, p_updated boolean, p_at timestamptz) returns void
language sql as $$
  select private.notify('delivery_order', private.shift_ctx(p_shift) || jsonb_build_object(
    'order', private.order_json(p_order),
    'point_name', (select pt.name from public.orders o join public.points pt on pt.id = o.point_id where o.id = p_order),
    'customer', (select jsonb_build_object('id', c.id, 'label', private.customer_label(c.id), 'phone', c.phone)
                   from public.orders o join public.customers c on c.id = o.customer_id where o.id = p_order),
    'updated', p_updated), p_at)
$$;

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
  if v_shift.opened_at > p_at + interval '5 minutes' then perform private.reject('bad_shift'); end if;
  v_customer := private.order_customer(p -> 'customer', v_address, v_shift.id, p_profile, p_at);

  -- Số thứ tự + mã đơn: server cấp (sync_push giữ khóa theo hồ sơ tablet ⇒ không trùng giữa các máy).
  v_seq := coalesce((select max(device_seq) from public.orders where tablet_profile_id = p_profile), 0) + 1;
  v_code := private.new_order_code(p_profile, p_at);

  insert into public.orders (id, device_seq, tablet_profile_id, point_id, code, label, table_no, dine_type, address,
                             customer_id, status, opened_shift_id, created_at, total)
  values (v_id, v_seq, p_profile, v_point, v_code, left(nullif(trim(o ->> 'label'), ''), 40),
          left(nullif(trim(o ->> 'table_no'), ''), 10), o ->> 'dine_type', v_address, v_customer, 'open', v_shift.id, p_at, v_total);

  v_calc := private.write_items(v_id, v_menu, p -> 'items', p_at);
  if v_calc <> v_total then perform private.reject('total_mismatch'); end if;

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
  v_customer uuid;
  v_calc int;
  v_shift uuid := coalesce(private.current_shift_id(p_profile), o.opened_shift_id);
begin
  if not exists (select 1 from public.tablet_profiles where id = p_profile and v_point = any(point_ids)) then
    perform private.reject('point_not_allowed');
  end if;
  select menu_id into v_menu from public.points where id = v_point;
  v_address := private.order_address(p);
  v_customer := private.order_customer(p -> 'customer', v_address, v_shift, p_profile, p_at);

  v_calc := private.write_items(o.id, v_menu, p -> 'items', p_at);
  if v_calc <> v_total then perform private.reject('total_mismatch'); end if;

  update public.orders set
    point_id = v_point, dine_type = p ->> 'dine_type', address = v_address, customer_id = v_customer,
    label = left(nullif(trim(p ->> 'label'), ''), 40), table_no = left(nullif(trim(p ->> 'table_no'), ''), 10),
    total = v_total
  where id = o.id;

  perform private.audit('order_update', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff', v_shift, p_profile);
  -- Đơn vừa chuyển sang ship, đổi địa chỉ giao hoặc đổi khách ⇒ báo lại (sửa món thôi thì không báo).
  if v_address is not null and (v_address is distinct from o.address or v_customer is distinct from o.customer_id) then
    perform private.notify_delivery(o.id, v_shift, o.dine_type = 'delivery', p_at);
  end if;
end $$;

-- Thanh toán: ghi nợ ⇒ khách nợ; trả tiền mặt / chuyển khoản ⇒ giữ khách của đơn ship.
create or replace function private.op_pay_order(p_profile uuid, p jsonb, p_at timestamptz) returns void
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
      insert into public.customers (id, name, description, phone, address, created_by_shift_id)
      values (v_customer, trim(c ->> 'name'), nullif(trim(c ->> 'description'), ''), nullif(trim(c ->> 'phone'), ''),
              o.address, v_shift.id);
      perform private.audit('customer_create', 'customer', v_customer, null,
                            (select to_jsonb(x) from public.customers x where id = v_customer), p_at, 'staff', v_shift.id, p_profile);
    end if;
  end if;

  update public.orders set
    status = 'paid', paid_at = p_at, paid_shift_id = v_shift.id, payment_method = v_method,
    cash_given = v_given, customer_id = coalesce(v_customer, o.customer_id)
  where id = o.id;

  perform private.audit('order_pay', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff', v_shift.id, p_profile);
  if v_method = 'debt' then
    perform private.notify('debt_recorded', private.shift_ctx(v_shift.id) || jsonb_build_object(
      'order_code', o.code, 'order_id', o.id, 'amount', o.total, 'customer_id', v_customer,
      'customer_label', private.customer_label(v_customer), 'balance', private.customer_balance(v_customer)), p_at);
  end if;
end $$;

-- Chủ sửa đơn: bỏ ghi nợ ⇒ đơn ship vẫn giữ khách của nó, đơn khác thì bỏ khách.
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
