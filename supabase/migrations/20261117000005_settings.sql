-- Cài đặt của chủ (bước 4): ràng buộc toàn vẹn cho danh mục mà khóa ngoại không diễn tả được.
-- Giao diện đã kiểm tra trước (src/domain/catalog.ts); ở đây chặn cả khi gọi API trực tiếp.

-- Combo = 1 món + các topping, tất cả cùng menu với combo (giá combo = tổng thành phần).
create function private.check_combo() returns trigger
language plpgsql as $$
declare v_bad int;
begin
  if not exists (select 1 from public.products where id = new.product_id and menu_id = new.menu_id) then
    raise exception 'Món chính của combo phải thuộc menu của combo' using errcode = '23514';
  end if;
  if cardinality(new.topping_ids) <> (select count(distinct x) from unnest(new.topping_ids) x) then
    raise exception 'Topping của combo bị trùng' using errcode = '23514';
  end if;
  select count(*) into v_bad
    from unnest(new.topping_ids) x
   where not exists (select 1 from public.toppings t where t.id = x and t.menu_id = new.menu_id);
  if v_bad > 0 then
    raise exception 'Topping của combo phải có thật và thuộc menu của combo' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger check_combo before insert or update on public.combos
  for each row execute function private.check_combo();

-- Hồ sơ tablet: các điểm bán phải có thật, không trùng (mảng không có khóa ngoại).
create function private.check_tablet_profile() returns trigger
language plpgsql as $$
begin
  if cardinality(new.point_ids) <> (select count(distinct x) from unnest(new.point_ids) x) then
    raise exception 'Điểm bán của hồ sơ tablet bị trùng' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(new.point_ids) x where not exists (select 1 from public.points p where p.id = x)) then
    raise exception 'Hồ sơ tablet trỏ tới điểm bán không tồn tại' using errcode = '23503';
  end if;
  return new;
end $$;

create trigger check_tablet_profile before insert or update on public.tablet_profiles
  for each row execute function private.check_tablet_profile();

-- Menu của món / topping / combo không đổi sau khi tạo: đổi sẽ làm combo và đơn cũ lệch menu.
-- Muốn chuyển menu thì tạo món mới và ngừng bán món cũ.
create function private.freeze_menu() returns trigger
language plpgsql as $$
begin
  if new.menu_id is distinct from old.menu_id then
    raise exception 'Không đổi menu của % sau khi tạo', tg_table_name using errcode = '23514';
  end if;
  return new;
end $$;

create trigger freeze_menu before update on public.products for each row execute function private.freeze_menu();
create trigger freeze_menu before update on public.toppings for each row execute function private.freeze_menu();
create trigger freeze_menu before update on public.combos for each row execute function private.freeze_menu();

-- Tên rỗng / chỉ có dấu cách không được (staff đã có check; thêm cho danh mục còn lại).
alter table public.menus add constraint menus_name_not_blank check (length(trim(name)) > 0);
alter table public.points add constraint points_name_not_blank check (length(trim(name)) > 0);
alter table public.tablet_profiles add constraint tablet_profiles_name_not_blank check (length(trim(name)) > 0);
alter table public.products add constraint products_name_not_blank check (length(trim(name)) > 0);
alter table public.toppings add constraint toppings_name_not_blank check (length(trim(name)) > 0);
alter table public.combos add constraint combos_name_not_blank check (length(trim(name)) > 0);
