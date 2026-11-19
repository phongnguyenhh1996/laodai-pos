-- Mã PIN vào chế độ chủ, theo từng thiết bị (mỗi máy một PIN riêng, không phải một PIN cho cả tài khoản).
-- Máy giữ một khóa ngẫu nhiên (localStorage); server chỉ lưu băm của khóa + băm bcrypt của PIN.
-- Mở bằng PIN: Edge Function owner-pin-unlock (service role) gọi owner_pin_verify rồi cấp phiên chủ tạm.
-- Sai 5 lần liền ⇒ xóa PIN của máy đó, phải nhập lại mật khẩu chủ.

create table public.owner_device_pins (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  pin_hash text not null,
  device_id text check (length(device_id) between 8 and 64),
  tablet_profile_id uuid references public.tablet_profiles (id) on delete set null,
  failed_attempts int not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create unique index on public.owner_device_pins (device_id) where device_id is not null;
alter table public.owner_device_pins enable row level security;
-- Không ai đọc/ghi trực tiếp: chỉ qua các hàm security definer bên dưới.
revoke all on public.owner_device_pins from anon, authenticated;

create function private.pin_token_hash(p_token text) returns text
language sql immutable as $$ select encode(extensions.digest(p_token, 'sha256'), 'hex') $$;

-- Chủ (đang ở phiên chủ) cài / đổi PIN cho máy này. Máy đã có PIN ⇒ thay PIN cũ.
create function public.owner_set_device_pin(p_token text, p_pin text, p_device text, p_profile uuid) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare v_id uuid;
begin
  perform private.require_owner();
  if p_pin !~ '^[0-9]{6}$' then raise exception 'Mã PIN phải gồm 6 chữ số' using errcode = '22023'; end if;
  if length(coalesce(p_token, '')) < 32 then raise exception 'Khóa thiết bị không hợp lệ' using errcode = '22023'; end if;
  if p_device is not null then delete from public.owner_device_pins where device_id = p_device; end if;
  delete from public.owner_device_pins where token_hash = private.pin_token_hash(p_token);
  insert into public.owner_device_pins (token_hash, owner_id, pin_hash, device_id, tablet_profile_id)
  values (private.pin_token_hash(p_token), auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), p_device, p_profile)
  returning id into v_id;
  perform private.audit('owner_pin_set', 'owner_device_pin', v_id, null,
                        jsonb_build_object('tablet_name', (select name from public.tablet_profiles where id = p_profile)),
                        now(), 'owner', null, p_profile);
  return v_id;
end $$;

-- Danh sách máy đã cài PIN (màn "Máy này" của chủ).
create function public.owner_list_device_pins()
returns table (id uuid, device_id text, tablet_name text, created_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = public, private as $$
begin
  perform private.require_owner();
  return query
    select p.id, p.device_id, t.name, p.created_at, p.last_used_at
    from public.owner_device_pins p left join public.tablet_profiles t on t.id = p.tablet_profile_id
    order by p.created_at desc;
end $$;

-- Xóa PIN của một máy (theo id), hoặc của chính máy đang dùng (theo khóa thiết bị).
create function public.owner_remove_device_pin(p_id uuid default null, p_token text default null) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare r public.owner_device_pins;
begin
  perform private.require_owner();
  delete from public.owner_device_pins
  where (p_id is not null and id = p_id) or (p_token is not null and token_hash = private.pin_token_hash(p_token))
  returning * into r;
  if not found then return false; end if;
  perform private.audit('owner_pin_removed', 'owner_device_pin', r.id, null,
                        jsonb_build_object('tablet_name', (select name from public.tablet_profiles where id = r.tablet_profile_id)),
                        now(), 'owner', null, r.tablet_profile_id);
  return true;
end $$;

-- Chỉ Edge Function (service role) gọi. Kết quả: ok (+ owner_id) | wrong (+ remaining) | locked | not_found.
create function public.owner_pin_verify(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r public.owner_device_pins; max_attempts constant int := 5;
begin
  select * into r from public.owner_device_pins where token_hash = private.pin_token_hash(coalesce(p_token, '')) for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, r.pin_hash) = r.pin_hash then
    update public.owner_device_pins set failed_attempts = 0, last_used_at = now() where id = r.id;
    return jsonb_build_object('status', 'ok', 'owner_id', r.owner_id);
  end if;
  if r.failed_attempts + 1 >= max_attempts then
    delete from public.owner_device_pins where id = r.id;
    perform private.audit('owner_pin_locked', 'owner_device_pin', r.id, null,
                          jsonb_build_object('tablet_name', (select name from public.tablet_profiles where id = r.tablet_profile_id)),
                          now(), 'system', null, r.tablet_profile_id);
    return jsonb_build_object('status', 'locked');
  end if;
  update public.owner_device_pins set failed_attempts = failed_attempts + 1 where id = r.id;
  return jsonb_build_object('status', 'wrong', 'remaining', max_attempts - r.failed_attempts - 1);
end $$;

revoke execute on function public.owner_set_device_pin(text, text, text, uuid), public.owner_list_device_pins(),
  public.owner_remove_device_pin(uuid, text) from public, anon;
grant execute on function public.owner_set_device_pin(text, text, text, uuid), public.owner_list_device_pins(),
  public.owner_remove_device_pin(uuid, text) to authenticated;
revoke execute on function public.owner_pin_verify(text, text) from public, anon, authenticated;
grant execute on function public.owner_pin_verify(text, text) to service_role;
