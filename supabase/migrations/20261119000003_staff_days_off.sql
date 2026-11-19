-- Ngày nghỉ của nhân viên (chủ đánh trên lịch ở màn Lương), lý do không bắt buộc.
-- Chỉ để ghi nhận / xem: lương vẫn tính theo ngày có mở ca nên ngày nghỉ không đổi số tiền.
-- Đánh nhầm thì bỏ (xóa dòng); đánh + bỏ đều vào Nhật ký.

create table public.staff_days_off (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  day date not null,
  reason text check (char_length(reason) between 1 and 120),
  at timestamptz not null default now(),
  unique (staff_id, day)
);
create index on public.staff_days_off (day);

alter table public.staff_days_off enable row level security;
alter table public.staff_days_off force row level security;
revoke all on public.staff_days_off from anon, authenticated;
grant select, insert, delete on public.staff_days_off to authenticated;
grant update (reason) on public.staff_days_off to authenticated;

create policy owner_read on public.staff_days_off for select to authenticated using (private.is_owner());
create policy owner_insert on public.staff_days_off for insert to authenticated with check (private.is_owner());
create policy owner_update on public.staff_days_off for update to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_delete on public.staff_days_off for delete to authenticated using (private.is_owner());

create function private.audit_day_off() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.staff_days_off := case when tg_op = 'DELETE' then old else new end;
begin
  insert into public.audit_log (actor_kind, action, entity, entity_id, before, after)
  values ('owner', case tg_op when 'INSERT' then 'day_off_add' when 'UPDATE' then 'day_off_update' else 'day_off_remove' end,
          'staff_days_off', r.id,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          to_jsonb(r) || jsonb_build_object('staff_name', (select name from public.staff where id = r.staff_id)));
  return r;
end $$;

create trigger audit_day_off after insert or update or delete on public.staff_days_off
  for each row execute function private.audit_day_off();
