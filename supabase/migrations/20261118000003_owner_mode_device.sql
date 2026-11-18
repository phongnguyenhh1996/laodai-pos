-- "Vào chế độ chủ": chỉ báo Telegram lần đầu trên mỗi thiết bị (nhật ký vẫn ghi mọi lần vào).
-- Thiết bị nhận diện bằng mã ngẫu nhiên máy tự sinh và giữ trong localStorage (xóa dữ liệu trình duyệt ⇒ coi là máy mới).

create table public.owner_mode_devices (
  device_id text primary key check (length(device_id) between 8 and 64),
  tablet_profile_id uuid references public.tablet_profiles (id) on delete set null,
  first_seen_at timestamptz not null default now()
);
alter table public.owner_mode_devices enable row level security;
-- Không ai đọc/ghi trực tiếp: chỉ qua owner_mode_entered (security definer).
revoke all on public.owner_mode_devices from anon, authenticated;

drop function public.owner_mode_entered(uuid);

-- Trả về true nếu là lần đầu trên thiết bị này (đã báo Telegram). Thiếu mã thiết bị (bản app cũ) ⇒ báo như trước.
create function public.owner_mode_entered(p_profile uuid, p_device text default null) returns boolean
language plpgsql security definer set search_path = public, private as $$
declare v_name text; v_new boolean := true;
begin
  perform private.require_owner();
  select name into v_name from public.tablet_profiles where id = p_profile;
  perform private.audit('owner_mode', 'tablet_profile', p_profile, null, null, now(), 'owner', null, p_profile);
  if p_device is not null then
    insert into public.owner_mode_devices (device_id, tablet_profile_id) values (p_device, p_profile)
    on conflict (device_id) do nothing;
    v_new := found;
  end if;
  if v_new then
    perform private.notify('owner_mode', jsonb_build_object('tablet_profile_id', p_profile, 'tablet_name', v_name));
  end if;
  return v_new;
end $$;

revoke execute on function public.owner_mode_entered(uuid, text) from public, anon;
grant execute on function public.owner_mode_entered(uuid, text) to authenticated;
