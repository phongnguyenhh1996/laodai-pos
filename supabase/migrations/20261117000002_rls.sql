-- Phân quyền: chủ (app_metadata.role = 'owner') và tablet (app_metadata.role = 'tablet').
-- "Nhân viên không thấy doanh thu" được đảm bảo ở tầng dữ liệu.

create function private.jwt_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
$$;

create function private.is_owner() returns boolean
language sql stable as $$
  select private.jwt_role() = 'owner'
$$;

create function private.is_tablet() returns boolean
language sql stable as $$
  select private.jwt_role() = 'tablet'
$$;

create function private.my_tablet_profile_id() returns uuid
language sql stable as $$
  select case when private.jwt_role() = 'tablet'
    then nullif(auth.jwt() -> 'app_metadata' ->> 'tablet_profile_id', '')::uuid end
$$;

grant usage on schema private to authenticated;
grant execute on function private.jwt_role(), private.is_owner(), private.is_tablet(), private.my_tablet_profile_id()
  to authenticated;

-- ---------------------------------------------------------------- quyền bảng

do $$
declare t text;
begin
  foreach t in array array[
    'settings','staff','menus','points','tablet_profiles','products','toppings','combos','price_history',
    'shifts','shift_adjustments','customers','orders','order_items','debt_payments',
    'audit_log','sync_ops','seq_gaps','notifications'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Chủ sửa cài đặt trực tiếp (vẫn không có DELETE: ngừng bán = active=false).
grant insert, update on public.settings, public.staff, public.menus, public.points, public.tablet_profiles,
  public.products, public.toppings, public.combos to authenticated;

-- ---------------------------------------------------------------- policy đọc

-- Danh mục: chủ + tablet đọc được
create policy catalog_read on public.staff for select to authenticated using (private.is_owner() or private.is_tablet());
create policy catalog_read on public.menus for select to authenticated using (private.is_owner() or private.is_tablet());
create policy catalog_read on public.points for select to authenticated using (private.is_owner() or private.is_tablet());
create policy catalog_read on public.products for select to authenticated using (private.is_owner() or private.is_tablet());
create policy catalog_read on public.toppings for select to authenticated using (private.is_owner() or private.is_tablet());
create policy catalog_read on public.combos for select to authenticated using (private.is_owner() or private.is_tablet());
create policy catalog_read on public.customers for select to authenticated using (private.is_owner() or private.is_tablet());

create policy profile_read on public.tablet_profiles for select to authenticated
  using (private.is_owner() or id = private.my_tablet_profile_id());

-- Tablet chỉ thấy ca đang mở của chính mình
create policy shift_read on public.shifts for select to authenticated
  using (private.is_owner() or (tablet_profile_id = private.my_tablet_profile_id() and status = 'open'));

-- Tablet chỉ thấy đơn đang mở của chính mình
create policy order_read on public.orders for select to authenticated
  using (private.is_owner() or (tablet_profile_id = private.my_tablet_profile_id() and status in ('open', 'served')));

create policy order_item_read on public.order_items for select to authenticated
  using (
    private.is_owner() or exists (
      select 1 from public.orders o
      where o.id = order_id and o.tablet_profile_id = private.my_tablet_profile_id() and o.status in ('open', 'served')
    )
  );

-- Chỉ chủ
create policy owner_read on public.settings for select to authenticated using (private.is_owner());
create policy owner_read on public.price_history for select to authenticated using (private.is_owner());
create policy owner_read on public.shift_adjustments for select to authenticated using (private.is_owner());
create policy owner_read on public.debt_payments for select to authenticated using (private.is_owner());
create policy owner_read on public.audit_log for select to authenticated using (private.is_owner());
create policy owner_read on public.sync_ops for select to authenticated using (private.is_owner());
create policy owner_read on public.seq_gaps for select to authenticated using (private.is_owner());
create policy owner_read on public.notifications for select to authenticated using (private.is_owner());

-- ---------------------------------------------------------------- policy ghi (chỉ chủ, chỉ cài đặt)

do $$
declare t text;
begin
  foreach t in array array['settings','staff','menus','points','tablet_profiles','products','toppings','combos'] loop
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (private.is_owner())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (private.is_owner()) with check (private.is_owner())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- chống hard delete (mọi vai trò, kể cả chủ)

create function private.forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Không được xóa cứng bảng %', tg_table_name using errcode = '42501';
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'settings','staff','menus','points','tablet_profiles','products','toppings','combos','price_history',
    'shifts','shift_adjustments','customers','orders','order_items','debt_payments',
    'audit_log','sync_ops','seq_gaps','notifications'
  ] loop
    execute format('create trigger forbid_delete before delete on public.%I for each row execute function private.forbid_delete()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- lịch sử giá + nhật ký cài đặt

create function private.track_price() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price then
    insert into public.price_history (entity_type, entity_id, old_price, new_price)
    values (case tg_table_name when 'products' then 'product' else 'topping' end, new.id, old.price, new.price);
  end if;
  return new;
end $$;

create trigger track_price after update on public.products for each row execute function private.track_price();
create trigger track_price after update on public.toppings for each row execute function private.track_price();

create function private.audit_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_kind, action, entity, entity_id, before, after)
  values (
    'owner',
    case tg_op when 'INSERT' then 'settings_create' else 'settings_update' end,
    tg_table_name,
    case when tg_table_name = 'settings' then null else (to_jsonb(new) ->> 'id')::uuid end,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['settings','staff','menus','points','tablet_profiles','products','toppings','combos'] loop
    execute format('create trigger audit_settings after insert or update on public.%I for each row execute function private.audit_settings()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- realtime cho dashboard chủ (RLS vẫn áp dụng)

alter publication supabase_realtime add table public.orders, public.shifts, public.debt_payments, public.audit_log;
