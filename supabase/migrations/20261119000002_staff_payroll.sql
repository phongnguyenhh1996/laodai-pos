-- Nhân viên: số điện thoại, CCCD, sinh nhật, lương ngày + sổ lương theo tháng.
-- Tách khỏi `staff` vì tablet đọc được `staff` (để chọn tên khi mở ca): SĐT / CCCD / ngày sinh / lương chỉ chủ thấy.

create table public.staff_details (
  id uuid primary key references public.staff (id),
  -- chỉ số, 9–11 chữ số (vd. 0901234567); null = chưa nhập
  phone text check (phone ~ '^[0-9]{9,11}$'),
  -- CMND 9 số hoặc CCCD 12 số; null = chưa nhập
  id_number text check (id_number ~ '^[0-9]{9}([0-9]{3})?$'),
  birthday date check (birthday between '1900-01-01' and '2100-01-01'),
  -- lương mỗi ngày; công = số ngày có mở ca (giờ VN) ± ngày công chủ chỉnh
  day_rate int not null default 0 check (day_rate >= 0)
);

-- Sổ lương: thưởng / trừ / ứng / trả lương / cộng-trừ ngày công. Không sửa, không xóa: ghi sai thì hủy (voided_at).
create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  -- tháng lương = ngày đầu tháng
  month date not null check (extract(day from month) = 1),
  kind text not null check (kind in ('bonus', 'deduction', 'advance', 'payment', 'days')),
  -- tiền (bonus/deduction/advance/payment, > 0) hoặc ngày công thêm/bớt (days, khác 0)
  amount int not null check (case when kind = 'days' then amount <> 0 else amount > 0 end),
  note text,
  at timestamptz not null default now(),
  voided_at timestamptz
);
create index on public.payroll_entries (month, staff_id);

alter table public.staff_details enable row level security;
alter table public.staff_details force row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_entries force row level security;
revoke all on public.staff_details, public.payroll_entries from anon, authenticated;

grant select, insert, update on public.staff_details to authenticated;
grant select, insert on public.payroll_entries to authenticated;
grant update (voided_at) on public.payroll_entries to authenticated;

create policy owner_read on public.staff_details for select to authenticated using (private.is_owner());
create policy owner_insert on public.staff_details for insert to authenticated with check (private.is_owner());
create policy owner_update on public.staff_details for update to authenticated using (private.is_owner()) with check (private.is_owner());

create policy owner_read on public.payroll_entries for select to authenticated using (private.is_owner());
create policy owner_insert on public.payroll_entries for insert to authenticated with check (private.is_owner());
-- Chỉ hủy được dòng chưa hủy (không "bỏ hủy").
create policy owner_void on public.payroll_entries for update to authenticated
  using (private.is_owner() and voided_at is null) with check (private.is_owner() and voided_at is not null);

create trigger forbid_delete before delete on public.staff_details for each row execute function private.forbid_delete();
create trigger forbid_delete before delete on public.payroll_entries for each row execute function private.forbid_delete();

-- Nhật ký: sửa thông tin nhân viên như mọi cài đặt khác.
create trigger audit_settings after insert or update on public.staff_details
  for each row execute function private.audit_settings();

create function private.audit_payroll() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_kind, action, entity, entity_id, before, after)
  values ('owner', case tg_op when 'INSERT' then 'payroll_add' else 'payroll_void' end, 'payroll_entries', new.id,
          case when tg_op = 'UPDATE' then to_jsonb(old) end,
          to_jsonb(new) || jsonb_build_object('staff_name', (select name from public.staff where id = new.staff_id)));
  return new;
end $$;

create trigger audit_payroll after insert or update on public.payroll_entries
  for each row execute function private.audit_payroll();
