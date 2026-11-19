-- Đánh dấu ngày trên lịch lương: ngoài "nghỉ" thêm "có làm" (làm mà không mở ca).
-- Mỗi nhân viên mỗi ngày một đánh dấu (nghỉ HOẶC có làm), đổi qua lại được.
-- "Có làm" ở ngày không có ca được tính 1 ngày công; "nghỉ" chỉ ghi nhận, không đổi lương.

alter table public.staff_days_off rename to staff_day_marks;
alter table public.staff_day_marks add column kind text not null default 'off' check (kind in ('off', 'work'));
alter table public.staff_day_marks alter column kind drop default;
grant update (kind) on public.staff_day_marks to authenticated;

drop trigger audit_day_off on public.staff_day_marks;
drop function private.audit_day_off();

-- Nhật ký: day_off_* / day_work_* theo loại sau thao tác (bỏ thì theo loại đã bỏ).
create function private.audit_day_mark() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r public.staff_day_marks := case when tg_op = 'DELETE' then old else new end;
begin
  insert into public.audit_log (actor_kind, action, entity, entity_id, before, after)
  values ('owner',
          'day_' || r.kind || '_' || case tg_op when 'INSERT' then 'add' when 'UPDATE' then 'update' else 'remove' end,
          'staff_day_marks', r.id,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          to_jsonb(r) || jsonb_build_object('staff_name', (select name from public.staff where id = r.staff_id)));
  return r;
end $$;

create trigger audit_day_mark after insert or update or delete on public.staff_day_marks
  for each row execute function private.audit_day_mark();
