-- Ship hai kiểu (SPEC 3, 4.2, 4.4, 4.7, 5, 6): Quán ship (`shop`) / Shipper ngoài (`external`).
-- - Shipper ngoài: khách trả phụ thu (vẫn là `ship_fee`, nằm trong `total`); quán lấy TIỀN MẶT từ két trả shipper
--   (`ship_payout`, KHÔNG nằm trong `total`). Payout chỉ tính khi đơn đã thanh toán, vào ca thanh toán, mọi hình thức.
-- - Tiền mặt kỳ vọng của ca trừ Σ ship_payout ⇒ đếm mù cuối ca vẫn khớp.
-- - Đơn cũ: shop / 0 ⇒ đối soát các ca đã đóng không đổi. Client cũ không gửi hai trường ⇒ shop / 0.

alter table public.orders add column ship_mode text not null default 'shop';
alter table public.orders add column ship_payout int not null default 0;
alter table public.orders add constraint orders_ship_mode check (ship_mode in ('shop', 'external'));
alter table public.orders add constraint orders_ship_payout check (
  case ship_mode
    when 'shop' then ship_payout = 0
    else dine_type = 'delivery' and ship_payout between 1000 and 50000 and ship_payout % 1000 = 0
  end);

-- Kiểu ship gửi lên. Không phải đơn ship ⇒ `shop` (bỏ như bỏ địa chỉ). Thiếu ⇒ `shop` (client cũ).
create function private.order_ship_mode(p jsonb) returns text
language plpgsql immutable as $$
declare v text := coalesce(nullif(p ->> 'ship_mode', ''), 'shop');
begin
  if p ->> 'dine_type' <> 'delivery' then return 'shop'; end if;
  if v not in ('shop', 'external') then perform private.reject('bad_ship_mode'); end if;
  return v;
end $$;

-- Tiền trả shipper gửi lên. Chỉ shipper ngoài: bắt buộc, 1.000–50.000, bội 1.000 (`bad_ship_payout`).
-- Quán ship / không phải đơn ship mà vẫn gửi ⇒ bỏ (lưu 0).
create function private.order_ship_payout(p jsonb) returns int
language plpgsql immutable as $$
declare v int;
begin
  if private.order_ship_mode(p) <> 'external' then return 0; end if;
  v := private.as_int(p ->> 'ship_payout', 'ship_payout', 0);
  if v < 1000 or v > 50000 or v % 1000 <> 0 then perform private.reject('bad_ship_payout'); end if;
  return v;
end $$;

-- Như bản 20261121000001_ship_fee, ghi thêm `ship_mode`, `ship_payout`. Kiểm tổng giữ nguyên: tiền món + ship_fee = total.
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
  v_mode text;
  v_payout int;
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
  v_mode := private.order_ship_mode(o);
  v_payout := private.order_ship_payout(o);
  if v_shift.opened_at > p_at + interval '5 minutes' then perform private.reject('bad_shift'); end if;
  v_customer := private.order_customer(p -> 'customer', v_address, v_shift.id, p_profile, p_at);

  -- Số thứ tự + mã đơn: server cấp (sync_push giữ khóa theo hồ sơ tablet ⇒ không trùng giữa các máy).
  v_seq := coalesce((select max(device_seq) from public.orders where tablet_profile_id = p_profile), 0) + 1;
  v_code := private.new_order_code(p_profile, p_at);

  insert into public.orders (id, device_seq, tablet_profile_id, point_id, code, label, table_no, dine_type, address,
                             customer_id, status, opened_shift_id, created_at, ship_fee, ship_mode, ship_payout, total)
  values (v_id, v_seq, p_profile, v_point, v_code, left(nullif(trim(o ->> 'label'), ''), 40),
          left(nullif(trim(o ->> 'table_no'), ''), 10), o ->> 'dine_type', v_address, v_customer, 'open', v_shift.id, p_at,
          v_fee, v_mode, v_payout, v_total);

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
  v_mode text;
  v_payout int;
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
  v_mode := private.order_ship_mode(p);
  v_payout := private.order_ship_payout(p);
  v_customer := private.order_customer(p -> 'customer', v_address, v_shift, p_profile, p_at);

  v_calc := private.write_items(o.id, v_menu, p -> 'items', p_at);
  if v_calc + v_fee <> v_total then perform private.reject('total_mismatch'); end if;

  update public.orders set
    point_id = v_point, dine_type = p ->> 'dine_type', address = v_address, customer_id = v_customer,
    label = left(nullif(trim(p ->> 'label'), ''), 40), table_no = left(nullif(trim(p ->> 'table_no'), ''), 10),
    ship_fee = v_fee, ship_mode = v_mode, ship_payout = v_payout, total = v_total
  where id = o.id;

  perform private.audit('order_update', 'order', o.id, v_before, private.order_json(o.id), p_at, 'staff', v_shift, p_profile);
  -- Đơn vừa chuyển sang ship, đổi địa chỉ / khách / kiểu ship / tiền trả shipper ⇒ báo lại
  -- (sửa món / đổi phí thôi thì không báo).
  if v_address is not null and (v_address is distinct from o.address or v_customer is distinct from o.customer_id
                                or v_mode is distinct from o.ship_mode or v_payout is distinct from o.ship_payout) then
    perform private.notify_delivery(o.id, v_shift, o.dine_type = 'delivery', p_at);
  end if;
end $$;

-- Chủ sửa đơn đã thanh toán: thêm kiểu ship, phí ship / phụ thu, tiền trả shipper (không gửi ⇒ giữ nguyên).
-- Tổng mới = tiền món (mới hoặc cũ) + phí mới. Cùng luật kiểm như tablet (4.2).
drop function public.owner_edit_order(uuid, jsonb, text, uuid, int);
create function public.owner_edit_order(
  p_order uuid,
  p_items jsonb default null,
  p_payment_method text default null,
  p_customer_id uuid default null,
  p_cash_given int default null,
  p_ship_mode text default null,
  p_ship_fee int default null,
  p_ship_payout int default null
) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  o public.orders;
  v_before jsonb;
  v_after jsonb;
  v_method text;
  v_total int;
  v_items int;
  v_ship jsonb;
  v_mode text;
  v_fee int;
  v_payout int;
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

  -- Kiểu ship / phí / tiền trả shipper: giữ nguyên phần không gửi; về Quán ship ⇒ bỏ tiền trả shipper.
  v_mode := coalesce(p_ship_mode, o.ship_mode);
  v_ship := jsonb_build_object(
    'dine_type', o.dine_type, 'ship_mode', v_mode, 'ship_fee', coalesce(p_ship_fee, o.ship_fee),
    'ship_payout', case when p_ship_payout is not null then p_ship_payout
                        when v_mode = 'external' and o.ship_payout > 0 then o.ship_payout end);
  begin
    v_fee := private.order_ship_fee(v_ship);
    v_mode := private.order_ship_mode(v_ship);
    v_payout := private.order_ship_payout(v_ship);
  exception when sqlstate 'LD001' then
    raise exception '%', case sqlerrm when 'bad_ship_payout' then 'Chưa chọn tiền trả shipper hợp lệ'
                                     when 'bad_ship_fee' then 'Phí ship không hợp lệ'
                                     else 'Kiểu ship không hợp lệ' end using errcode = '22023';
  end;

  v_items := o.total - o.ship_fee;
  if p_items is not null then
    select menu_id into v_menu from public.points where id = o.point_id;
    begin
      v_items := private.write_items(o.id, v_menu, p_items, now());
    exception when sqlstate 'LD001' then
      raise exception 'Món không hợp lệ: %', sqlerrm using errcode = '22023';
    end;
  end if;
  v_total := v_items + v_fee;

  v_method := coalesce(p_payment_method, o.payment_method);
  if v_method not in ('cash', 'transfer', 'debt') then raise exception 'Hình thức không hợp lệ' using errcode = '22023'; end if;
  if v_method = 'debt' and coalesce(p_customer_id, o.customer_id) is null then
    raise exception 'Ghi nợ cần khách' using errcode = '22023';
  end if;

  update public.orders set
    total = v_total,
    ship_fee = v_fee,
    ship_mode = v_mode,
    ship_payout = v_payout,
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

revoke execute on function public.owner_edit_order(uuid, jsonb, text, uuid, int, text, int, int) from public, anon;
grant execute on function public.owner_edit_order(uuid, jsonb, text, uuid, int, text, int, int) to authenticated;

-- Thống kê ship của một tập đơn đã thanh toán (dùng chung cho đối soát ca và báo cáo theo kỳ).
-- Chỉ đơn ship; lãi/lỗ ship ngoài = phụ thu ship ngoài − trả shipper ngoài.
create function private.ship_stats(p_orders public.orders[]) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'shop_orders', count(*) filter (where ship_mode = 'shop'),
    'external_orders', count(*) filter (where ship_mode = 'external'),
    'shop_fee', coalesce(sum(ship_fee) filter (where ship_mode = 'shop'), 0),
    'external_fee', coalesce(sum(ship_fee) filter (where ship_mode = 'external'), 0),
    'payout', coalesce(sum(ship_payout), 0),
    'external_profit', coalesce(sum(ship_fee - ship_payout) filter (where ship_mode = 'external'), 0))
  from unnest(p_orders) o
  where o.dine_type = 'delivery'
$$;

-- Như bản 20261121000002_cans_counts. Đổi: tiền mặt kỳ vọng − Σ ship_payout (đơn paid, ca THU này, mọi hình thức);
-- thêm khối `ship`. Giữ `revenue.ship_fee` (= tổng hai loại phí) cho client cũ.
-- Cùng công thức với src/domain/reconcile.ts (tests/fixtures/reconcile-cases.json).
create or replace function private.reconcile_shift(p_shift uuid) returns jsonb
language plpgsql stable as $$
declare
  s public.shifts;
  adj_cash int; adj_boxes int; adj_plates int; adj_cans int;
  rev_cash int; rev_tr int; rev_debt int; rev_fee int; payout int; paid_n int; ship jsonb;
  dc_cash int; dc_tr int;
  pk_boxes int; pk_plates int; pk_cans int; del_n int; open_n int; das jsonb;
  expected int; used_b int; used_p int; used_c int;
begin
  select * into s from public.shifts where id = p_shift;
  if not found then return null; end if;

  select coalesce(sum(qty) filter (where kind = 'cash'), 0),
         coalesce(sum(qty) filter (where kind = 'boxes'), 0),
         coalesce(sum(qty) filter (where kind = 'plates'), 0),
         coalesce(sum(qty) filter (where kind = 'cans'), 0)
    into adj_cash, adj_boxes, adj_plates, adj_cans
    from public.shift_adjustments where shift_id = p_shift;

  -- Tiền: theo ca THU
  select coalesce(sum(total) filter (where payment_method = 'cash'), 0),
         coalesce(sum(total) filter (where payment_method = 'transfer'), 0),
         coalesce(sum(total) filter (where payment_method = 'debt'), 0),
         coalesce(sum(ship_fee), 0),
         coalesce(sum(ship_payout), 0),
         count(*),
         private.ship_stats(coalesce(array_agg(o), '{}'))
    into rev_cash, rev_tr, rev_debt, rev_fee, payout, paid_n, ship
    from public.orders o where status = 'paid' and paid_shift_id = p_shift;

  select coalesce(sum(amount) filter (where method = 'cash'), 0),
         coalesce(sum(amount) filter (where method = 'transfer'), 0)
    into dc_cash, dc_tr
    from public.debt_payments where shift_id = p_shift;

  -- Trả shipper ngoài luôn là tiền mặt lấy từ két, kể cả khách CK / Nợ.
  expected := s.open_float + adj_cash + rev_cash + dc_cash - payout;

  -- Bao bì: theo ca MỞ đơn
  with op as (
    select o.id, o.code, o.status, o.served_at, o.deleted_at, private.order_packaging(o.id) pk
    from public.orders o where o.opened_shift_id = p_shift
  )
  select coalesce(sum((pk ->> 'boxes')::int) filter (where status <> 'deleted'), 0),
         coalesce(sum((pk ->> 'plates')::int) filter (where status <> 'deleted'), 0),
         coalesce(sum((pk ->> 'cans')::int) filter (where status <> 'deleted'), 0),
         count(*) filter (where status = 'deleted'),
         count(*) filter (where status in ('open', 'served')),
         coalesce(jsonb_agg(jsonb_build_object('order_id', id, 'code', code,
                    'boxes', (pk ->> 'boxes')::int, 'plates', (pk ->> 'plates')::int, 'cans', (pk ->> 'cans')::int)
                    order by deleted_at)
                  filter (where status = 'deleted' and served_at is not null and deleted_at is not null
                          and served_at < deleted_at), '[]'::jsonb)
    into pk_boxes, pk_plates, pk_cans, del_n, open_n, das
    from op;

  used_b := case when s.close_boxes_left is null then null else s.open_boxes + adj_boxes - s.close_boxes_left end;
  used_p := case when s.close_plates_left is null then null else s.open_plates + adj_plates - s.close_plates_left end;
  used_c := case when s.close_cans_left is null then null else s.open_cans + adj_cans - s.close_cans_left end;

  return jsonb_build_object(
    'count_items', to_jsonb(s.count_items),
    'revenue', jsonb_build_object('total', rev_cash + rev_tr + rev_debt, 'cash', rev_cash, 'transfer', rev_tr, 'debt', rev_debt,
                                  'ship_fee', rev_fee),
    'ship', ship,
    'paid_orders', paid_n,
    'debt_collected', jsonb_build_object('cash', dc_cash, 'transfer', dc_tr),
    'cash', jsonb_build_object('expected', expected, 'counted', s.close_cash_counted,
                               'diff', s.close_cash_counted - expected),
    'boxes', jsonb_build_object('used', used_b, 'by_orders', pk_boxes, 'diff', used_b - pk_boxes),
    'plates', jsonb_build_object('used', used_p, 'by_orders', pk_plates, 'diff', used_p - pk_plates),
    'cans', jsonb_build_object('used', used_c, 'by_orders', pk_cans, 'diff', used_c - pk_cans),
    'deleted_count', del_n,
    'deleted_after_served', das,
    'open_orders', open_n
  );
end $$;

-- Doanh thu theo kỳ (owner_dashboard, owner_report): thêm khối `ship` như đối soát ca.
create or replace function private.revenue_json(r tstzrange, p_point uuid default null) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'total', coalesce(sum(total), 0),
    'cash', coalesce(sum(total) filter (where payment_method = 'cash'), 0),
    'transfer', coalesce(sum(total) filter (where payment_method = 'transfer'), 0),
    'debt', coalesce(sum(total) filter (where payment_method = 'debt'), 0),
    'ship_fee', coalesce(sum(ship_fee), 0),
    'ship', private.ship_stats(coalesce(array_agg(o), '{}')),
    'orders', count(*))
  from public.orders o
  where status = 'paid' and paid_at <@ r and (p_point is null or point_id = p_point)
$$;

-- Mặc định kiểu ship / phí / tiền trả shipper cho đơn ship mới = đơn ship gần nhất của ca (kể cả đã thanh toán,
-- trừ đã xóa). Tablet không đọc được đơn đã thanh toán (RLS) nên cần RPC này; chỉ trả ba trường của MỘT đơn,
-- không lộ tổng tiền / số đơn (ADR 0002). Tablet chỉ hỏi được ca của quầy mình. Chưa có đơn ship ⇒ null.
create function public.shift_ship_defaults(p_shift uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not (private.is_owner() or (private.is_tablet() and exists (
            select 1 from public.shifts where id = p_shift and tablet_profile_id = private.my_tablet_profile_id()))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select jsonb_build_object('ship_mode', o.ship_mode, 'ship_fee', o.ship_fee, 'ship_payout', o.ship_payout)
            from public.orders o
           where o.opened_shift_id = p_shift and o.dine_type = 'delivery' and o.status <> 'deleted'
           order by o.created_at desc, o.device_seq desc
           limit 1);
end $$;

revoke execute on function public.shift_ship_defaults(uuid) from public, anon;
grant execute on function public.shift_ship_defaults(uuid) to authenticated;

-- Như bản 20261117000006_dashboard, dòng đơn thêm phí ship + kiểu ship + tiền trả shipper (badge "Ship ngoài · trả 10k").
-- "Ngày" của một đơn = lúc đơn kết thúc: thu tiền / xóa; đơn còn mở thì lúc tạo.
create or replace function public.owner_orders(
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
        'total', o.total, 'ship_fee', o.ship_fee, 'ship_mode', o.ship_mode, 'ship_payout', o.ship_payout,
        'payment_method', o.payment_method, 'owner_edited', o.owner_edited,
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
