-- Lon (nước uống) + công tắc "đếm khi đóng ca" theo từng quầy.
-- - Món có `cans`: số lon mỗi phần, tính như nhau cho Tại chỗ / Mang về / Ship.
-- - Quầy có `count_items`: các thứ nhân viên phải đếm khi đóng ca (cash / boxes / plates / cans).
--   Ca chụp lại danh sách này lúc mở ca (`shifts.count_items`): chủ đổi công tắc ⇒ áp dụng từ ca sau.
--   Thứ không đếm ⇒ ẩn hẳn: không số đầu ca trên tablet, không ô đóng ca, đối soát trả `used`/`diff` = null.
-- Quầy cũ giữ nguyên hành vi: đếm tiền mặt, hộp, dĩa; chưa đếm lon.

alter table public.products add column cans int not null default 0 check (cans >= 0);

alter table public.tablet_profiles add column default_cans int not null default 0 check (default_cans >= 0);
alter table public.tablet_profiles add column count_items text[] not null default '{cash,boxes,plates}'
  check (count_items <@ array['cash', 'boxes', 'plates', 'cans']);

alter table public.shifts add column open_cans int not null default 0;
alter table public.shifts add column close_cans_left int check (close_cans_left >= 0);
alter table public.shifts add column count_items text[] not null default '{cash,boxes,plates}';

alter table public.shift_adjustments drop constraint shift_adjustments_kind_check;
alter table public.shift_adjustments add constraint shift_adjustments_kind_check
  check (kind in ('boxes', 'plates', 'cans', 'cash'));

-- Bao bì một đơn: thêm lon (qty × cans, mọi loại đơn).
create or replace function private.order_packaging(p_order uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'boxes', coalesce(sum(case when o.dine_type in ('takeaway', 'delivery')
               then i.qty * (p.boxes_takeaway + (select count(*) from jsonb_array_elements(i.toppings_snap) t
                                                  where coalesce((t ->> 'extra_box')::boolean, false)))
               else i.qty * p.boxes_dinein end), 0)::int,
    'plates', coalesce(sum(case when o.dine_type = 'dinein' then i.qty * p.plates_dinein else 0 end), 0)::int,
    'cans', coalesce(sum(i.qty * p.cans), 0)::int)
  from public.orders o
  join public.order_items i on i.order_id = o.id and i.removed_at is null
  join public.products p on p.id = i.product_id
  where o.id = p_order
$$;

create or replace function private.op_open_shift(p_profile uuid, p jsonb, p_at timestamptz) returns void
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
  insert into public.shifts (id, tablet_profile_id, staff_id, opened_at, open_boxes, open_plates, open_cans, open_float, count_items)
  values (v_id, p_profile, v_staff, p_at, tp.default_boxes, tp.default_plates, tp.default_cans, tp.default_float, tp.count_items);
  perform private.audit('shift_open', 'shift', v_id, null, (select to_jsonb(s) from public.shifts s where id = v_id),
                        p_at, 'staff', v_id, p_profile);
  perform private.notify('shift_open', private.shift_ctx(v_id), p_at);
end $$;

-- Chỉ đòi số của các thứ ca này đếm; thứ không đếm ⇒ null (bỏ qua nếu client vẫn gửi).
create or replace function private.op_close_shift(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  s public.shifts := private.require_shift(p_profile, private.as_uuid(p ->> 'shift_id', 'shift'));
  v_before jsonb := to_jsonb(s);
begin
  if s.status <> 'open' then perform private.reject('shift_not_open'); end if;
  update public.shifts set
    status = 'closed', closed_at = p_at,
    close_boxes_left = case when 'boxes' = any(s.count_items) then private.as_int(p ->> 'boxes_left', 'boxes_left', 0) end,
    close_plates_left = case when 'plates' = any(s.count_items) then private.as_int(p ->> 'plates_left', 'plates_left', 0) end,
    close_cans_left = case when 'cans' = any(s.count_items) then private.as_int(p ->> 'cans_left', 'cans_left', 0) end,
    close_cash_counted = case when 'cash' = any(s.count_items) then private.as_int(p ->> 'cash_counted', 'cash_counted', 0) end
  where id = s.id;
  perform private.audit('shift_close', 'shift', s.id, v_before, (select to_jsonb(x) from public.shifts x where id = s.id),
                        p_at, 'staff', s.id, p_profile);
  perform private.notify('shift_close',
    private.shift_ctx(s.id) || jsonb_build_object('reconcile', private.reconcile_shift(s.id), 'adjusted', false), p_at);
end $$;

-- Ca vừa mở trả về tablet: thêm lon + danh sách cần đếm.
create or replace function private.op_data(p_profile uuid, p_kind text, p_entity uuid) returns jsonb
language sql stable as $$
  select coalesce(case
    when p_kind in ('create_order', 'update_order', 'serve_order') then (
      select jsonb_build_object('order', private.order_json(o.id))
        from public.orders o
       where o.id = p_entity and o.tablet_profile_id = p_profile and o.status in ('open', 'served'))
    when p_kind = 'open_shift' then (
      select jsonb_build_object('shift', jsonb_build_object(
               'id', s.id, 'tablet_profile_id', s.tablet_profile_id, 'staff_id', s.staff_id, 'staff_name', st.name,
               'opened_at', s.opened_at, 'open_boxes', s.open_boxes, 'open_plates', s.open_plates, 'open_cans', s.open_cans,
               'open_float', s.open_float, 'count_items', to_jsonb(s.count_items)))
        from public.shifts s join public.staff st on st.id = s.staff_id
       where s.id = p_entity and s.tablet_profile_id = p_profile and s.status = 'open')
  end, '{}'::jsonb)
$$;

-- Như bản 20261121000001_ship_fee, thêm lon + `count_items`; thứ không đếm ⇒ used/diff null
-- (cùng công thức với src/domain/reconcile.ts). Tiền mặt không đếm ⇒ counted/diff null, kỳ vọng vẫn tính.
create or replace function private.reconcile_shift(p_shift uuid) returns jsonb
language plpgsql stable as $$
declare
  s public.shifts;
  adj_cash int; adj_boxes int; adj_plates int; adj_cans int;
  rev_cash int; rev_tr int; rev_debt int; rev_fee int; paid_n int;
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
