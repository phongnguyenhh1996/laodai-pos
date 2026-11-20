-- Mã đơn đổi sang dạng 1 chữ + 2 số, ví dụ A30, F15 (chữ bỏ I L O ⇒ 23 × 100 = 2.300 mã / ngày / hồ sơ tablet).
-- Đơn cũ giữ nguyên mã 3 ký tự cũ, nên ràng buộc nhận cả hai dạng.

alter table public.orders drop constraint orders_code_check;
alter table public.orders add constraint orders_code_check
  check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ][0-9]{2}$'          -- dạng mới
      or code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$');     -- dạng cũ (đơn trước 20/11/2026)

-- Mã ngẫu nhiên, không trùng với mã đã dùng trong ngày của hồ sơ tablet.
-- Gọi bên trong sync_push (đã khóa theo hồ sơ tablet) ⇒ hai máy cùng hồ sơ không lấy trùng mã.
create or replace function private.new_order_code(p_profile uuid, p_at timestamptz) returns text
language plpgsql volatile as $$
declare
  a constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ';
  n constant int := length(a);
  d date := private.business_date(p_at);
  c text;
begin
  for i in 1..200 loop
    c := substr(a, 1 + floor(random() * n)::int, 1) || lpad(floor(random() * 100)::int::text, 2, '0');
    if not exists (select 1 from public.orders
                    where tablet_profile_id = p_profile and code = c and private.business_date(created_at) = d) then
      return c;
    end if;
  end loop;
  -- Gần hết mã trong ngày: chọn trong các mã còn trống.
  select x into c from (
    select substr(a, i, 1) || lpad(k::text, 2, '0') x
      from generate_series(1, n) i, generate_series(0, 99) k
  ) s
  where not exists (select 1 from public.orders
                     where tablet_profile_id = p_profile and code = s.x and private.business_date(created_at) = d)
  order by random() limit 1;
  if c is null then perform private.reject('order_codes_exhausted'); end if;
  return c;
end $$;
