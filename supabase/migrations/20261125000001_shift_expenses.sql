-- Khoản chi giữa ca (SPEC 3, 4.9, 5, 6, 10; ADR 0006): tiền mặt lấy từ két của MỘT ca để mua đá, ga…
-- - Nhân viên ghi / hủy qua `sync_push` (`create_expense`, `void_expense`) khi ca đang mở; chủ ghi / sửa / hủy mọi khoản,
--   kể cả của ca đã đóng (⇒ `recalculated_at`).
-- - Tiền mặt kỳ vọng của ca − Σ amount (chưa hủy). Doanh thu không đổi.
-- - Không hard delete: hủy = `voided_at`. Mọi thao tác ghi `audit_log` + Telegram ngay.
-- - Tablet chỉ đọc khoản chi của ca ĐANG MỞ của quầy mình (số do chính nhân viên ghi, không lộ doanh thu — ADR 0002).
-- Ca cũ không có khoản chi ⇒ đối soát không đổi (chỉ thêm khối `expenses` = 0).

-- ---------------------------------------------------------------- bảng

create table public.shift_expenses (
  id uuid primary key,                                  -- client sinh (như customers / debt_payments)
  shift_id uuid not null references public.shifts (id),
  amount int not null check (amount > 0 and amount % 1000 = 0),
  note text not null check (length(btrim(note)) between 1 and 80),
  actor_kind text not null check (actor_kind in ('staff', 'owner')),
  staff_id uuid references public.staff (id),
  at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  voided_at timestamptz,
  void_actor_kind text check (void_actor_kind in ('staff', 'owner')),
  check ((actor_kind = 'staff') = (staff_id is not null)),
  check ((voided_at is null) = (void_actor_kind is null))
);
create index on public.shift_expenses (shift_id);
create index on public.shift_expenses (at);

alter table public.shift_expenses enable row level security;
alter table public.shift_expenses force row level security;
revoke all on public.shift_expenses from anon, authenticated;
grant select on public.shift_expenses to authenticated;

-- Chủ đọc tất cả; tablet chỉ khoản của ca đang mở của hồ sơ mình. Không ai ghi thẳng (chỉ qua sync_push / RPC chủ).
create policy expense_read on public.shift_expenses for select to authenticated using (
  private.is_owner() or exists (
    select 1 from public.shifts s
     where s.id = shift_id and s.status = 'open' and s.tablet_profile_id = private.my_tablet_profile_id()));

create trigger forbid_delete before delete on public.shift_expenses
  for each row execute function private.forbid_delete();

-- Tablet nghe `live_pulse` của hồ sơ mình ⇒ thấy ngay khoản chủ vừa ghi / sửa / hủy.
create function private.pulse_expense() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.bump_pulse('profile:' || (select tablet_profile_id from public.shifts where id = new.shift_id)::text);
  return null;
end $$;

create trigger live_pulse after insert or update on public.shift_expenses
  for each row execute function private.pulse_expense();

alter publication supabase_realtime add table public.shift_expenses;

-- ---------------------------------------------------------------- tiện ích

-- Ghi chú lưu: bỏ khoảng trắng đầu/cuối, gộp khoảng trắng giữa. Rỗng / quá 80 ký tự ⇒ null.
create function private.clean_expense_note(p text) returns text
language sql immutable as $$
  select case when length(x) between 1 and 80 then x end
    from (select btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')) x) t
$$;

-- Nhóm ghi chú (ghi chú gần đây, cộng theo ghi chú): không phân biệt hoa thường / khoảng trắng thừa.
-- Cùng quy tắc với normalizeExpenseNote (src/domain/expenses.ts).
create function private.expense_note_key(p text) returns text
language sql immutable as $$
  select lower(btrim(regexp_replace(p, '\s+', ' ', 'g')))
$$;

create function private.expense_json(p_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', e.id, 'shift_id', e.shift_id, 'amount', e.amount, 'note', e.note,
                            'actor_kind', e.actor_kind, 'staff_id', e.staff_id, 'at', e.at,
                            'voided_at', e.voided_at, 'void_actor_kind', e.void_actor_kind)
    from public.shift_expenses e where e.id = p_id
$$;

-- Thống kê khoản chi (chưa hủy) của một tập ca: số khoản, tổng, cộng theo nhóm ghi chú
-- (nhãn nhóm = bản viết gần nhất; xếp theo tổng tiền rồi số lần).
create function private.expense_stats(p_shifts uuid[]) returns jsonb
language sql stable as $$
  with e as (
    select private.expense_note_key(note) k, note, amount, at
      from public.shift_expenses where shift_id = any(p_shifts) and voided_at is null
  ), g as (
    select k, count(*) n, sum(amount) total, max(at) last_at,
           (array_agg(note order by at desc))[1] label
      from e group by k
  )
  select jsonb_build_object(
    'count', (select count(*) from e),
    'total', coalesce((select sum(amount) from e), 0),
    'by_note', coalesce((select jsonb_agg(jsonb_build_object('note', label, 'count', n, 'total', total)
                                          order by total desc, n desc, last_at desc) from g), '[]'))
$$;

-- Lỗi RPC chủ: số tiền / ghi chú.
create function private.owner_expense_input(p_amount int, p_note text) returns text
language plpgsql immutable as $$
declare v text := private.clean_expense_note(p_note);
begin
  if p_amount is null or p_amount <= 0 or p_amount % 1000 <> 0 then
    raise exception 'Số tiền phải lớn hơn 0 và chẵn nghìn' using errcode = '22023';
  end if;
  if v is null then raise exception 'Cần ghi chú (tối đa 80 ký tự)' using errcode = '22023'; end if;
  return v;
end $$;

-- Gửi Telegram + nhật ký cho một thao tác khoản chi. `p_rec_before` có ⇒ ca đã đóng, kèm đối soát trước / sau.
create function private.notify_expense(
  p_kind text, p_expense uuid, p_actor text, p_before jsonb, p_rec_before jsonb, p_at timestamptz
) returns void
language plpgsql as $$
declare e public.shift_expenses;
begin
  select * into e from public.shift_expenses where id = p_expense;
  perform private.notify(p_kind, private.shift_ctx(e.shift_id) || jsonb_build_object(
    'expense', private.expense_json(e.id),
    'actor', p_actor,
    'before', p_before,
    'recalculated', case when p_rec_before is not null then
      jsonb_build_object('before', p_rec_before, 'after', private.reconcile_shift(e.shift_id)) end), p_at);
end $$;

-- ---------------------------------------------------------------- tablet (sync_push)

create function private.op_create_expense(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  v_id uuid := private.as_uuid(p ->> 'id', 'expense');
  v_shift public.shifts := private.require_shift(p_profile, private.as_uuid(p ->> 'shift_id', 'shift'));
  v_amount text := p ->> 'amount';
  v_note text := private.clean_expense_note(p ->> 'note');
begin
  if v_shift.status <> 'open' then perform private.reject('shift_not_open'); end if;
  if coalesce(v_amount, '') !~ '^[0-9]{1,9}$' or v_amount::int <= 0 or v_amount::int % 1000 <> 0 then
    perform private.reject('bad_expense_amount');
  end if;
  if v_note is null then perform private.reject('bad_expense_note'); end if;
  if exists (select 1 from public.shift_expenses where id = v_id) then perform private.reject('expense_exists'); end if;

  insert into public.shift_expenses (id, shift_id, amount, note, actor_kind, staff_id, at)
  values (v_id, v_shift.id, v_amount::int, v_note, 'staff', v_shift.staff_id, p_at);
  perform private.audit('expense_create', 'shift_expense', v_id, null, private.expense_json(v_id), p_at, 'staff', v_shift.id, p_profile);
  perform private.notify_expense('expense_created', v_id, 'staff', null, null, p_at);
end $$;

-- Nhân viên chỉ hủy khoản chính nhân viên ghi, của ca đang mở của quầy mình. Đã hủy rồi ⇒ không đổi.
create function private.op_void_expense(p_profile uuid, p jsonb, p_at timestamptz) returns void
language plpgsql as $$
declare
  v_id uuid := private.as_uuid(p ->> 'expense_id', 'expense');
  e public.shift_expenses;
  s public.shifts;
  v_before jsonb;
begin
  select * into e from public.shift_expenses where id = v_id for update;
  if not found then perform private.reject('expense_not_voidable'); end if;
  select * into s from public.shifts where id = e.shift_id;
  if s.tablet_profile_id <> p_profile or s.status <> 'open' or e.actor_kind <> 'staff' then
    perform private.reject('expense_not_voidable');
  end if;
  if e.voided_at is not null then return; end if;

  v_before := private.expense_json(v_id);
  update public.shift_expenses set voided_at = p_at, void_actor_kind = 'staff' where id = v_id;
  perform private.audit('expense_void', 'shift_expense', v_id, v_before, private.expense_json(v_id), p_at, 'staff', s.id, p_profile);
  perform private.notify_expense('expense_voided', v_id, 'staff', null, null, p_at);
end $$;

-- Như bản 20261121000002_cans_counts, thêm khoản chi vừa ghi / hủy (chỉ khi còn đọc được: ca đang mở của hồ sơ này).
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
    when p_kind in ('create_expense', 'void_expense') then (
      select jsonb_build_object('expense', private.expense_json(e.id))
        from public.shift_expenses e join public.shifts s on s.id = e.shift_id
       where e.id = p_entity and s.tablet_profile_id = p_profile and s.status = 'open')
  end, '{}'::jsonb)
$$;

-- sync_push: như bản 20261120000003_sold_out, thêm `create_expense`, `void_expense`.
create or replace function public.sync_push(op jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  v_profile uuid := private.my_tablet_profile_id();
  v_op_id uuid;
  v_kind text := op ->> 'kind';
  v_entity uuid := case when op ->> 'entity_id' ~* '^[0-9a-f-]{36}$' then (op ->> 'entity_id')::uuid end;
  v_at timestamptz;
  v_result jsonb;
  v_prev public.sync_ops;
begin
  if v_profile is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(op ->> 'op_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'bad op_id' using errcode = '22023'; end if;
  v_op_id := (op ->> 'op_id')::uuid;

  -- Tuần tự hóa theo hồ sơ tablet: các máy dùng chung hồ sơ không ghi chồng lên nhau.
  perform pg_advisory_xact_lock(hashtext(v_profile::text));

  -- Gửi lại (mất phản hồi lần trước): trả đúng kết quả cũ, kèm dữ liệu hiện tại.
  select * into v_prev from public.sync_ops where op_id = v_op_id;
  if found then
    if v_prev.result ->> 'status' = 'rejected' then return v_prev.result; end if;
    return jsonb_build_object('status', 'duplicate') || private.op_data(v_profile, v_prev.kind, v_prev.entity_id);
  end if;

  begin
    v_at := case when nullif(op ->> 'performed_at', '') is null then now()
                 else private.as_ts(op ->> 'performed_at', 'performed_at') end;
    if v_at > now() + interval '5 minutes' then perform private.reject('performed_at_in_future'); end if;
    case v_kind
      when 'open_shift' then perform private.op_open_shift(v_profile, op -> 'payload', v_at);
      when 'close_shift' then perform private.op_close_shift(v_profile, op -> 'payload', v_at);
      when 'create_order' then perform private.op_create_order(v_profile, op -> 'payload', v_at);
      when 'update_order' then perform private.op_update_order(v_profile, op -> 'payload', v_at);
      when 'serve_order' then perform private.op_serve_order(v_profile, op -> 'payload', v_at);
      when 'delete_order' then perform private.op_delete_order(v_profile, op -> 'payload', v_at);
      when 'pay_order' then perform private.op_pay_order(v_profile, op -> 'payload', v_at);
      when 'debt_payment' then perform private.op_debt_payment(v_profile, op -> 'payload', v_at);
      when 'set_sold_out' then perform private.op_set_sold_out(v_profile, op -> 'payload', v_at);
      when 'create_expense' then perform private.op_create_expense(v_profile, op -> 'payload', v_at);
      when 'void_expense' then perform private.op_void_expense(v_profile, op -> 'payload', v_at);
      else perform private.reject('unknown_kind');
    end case;
    v_result := jsonb_build_object('status', 'ok');
  exception when sqlstate 'LD001' then
    v_result := jsonb_build_object('status', 'rejected', 'reason', sqlerrm);
    insert into public.audit_log (at, actor_kind, tablet_profile_id, action, entity, entity_id, after, reason)
    values (coalesce(v_at, now()), 'staff', v_profile, 'sync_rejected', coalesce(v_kind, 'unknown'), v_entity, op, sqlerrm);
    perform private.notify('sync_rejected', jsonb_build_object(
      'tablet_profile_id', v_profile, 'tablet_name', (select name from public.tablet_profiles where id = v_profile),
      'kind', v_kind, 'reason', sqlerrm), coalesce(v_at, now()));
  end;

  insert into public.sync_ops (op_id, tablet_profile_id, kind, entity_id, performed_at, result)
  values (v_op_id, v_profile, coalesce(v_kind, 'unknown'), v_entity, coalesce(v_at, now()), v_result);
  if v_result ->> 'status' = 'ok' then
    v_result := v_result || private.op_data(v_profile, v_kind, v_entity);
  end if;
  return v_result;
end $$;

-- Ghi chú gần đây (tablet + chủ): ≤ 8 ghi chú dùng nhiều nhất 30 ngày, mọi quầy, chưa hủy; xếp theo số lần rồi lần gần nhất.
-- CHỈ trả chữ (bản viết gần nhất của nhóm), không số tiền / số lần.
create function public.recent_expense_notes() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not (private.is_owner() or private.is_tablet()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(label order by n desc, last_at desc) from (
      select (array_agg(note order by at desc))[1] label, count(*) n, max(at) last_at
        from public.shift_expenses
       where voided_at is null and at > now() - interval '30 days'
       group by private.expense_note_key(note)
       order by count(*) desc, max(at) desc
       limit 8) t), '[]');
end $$;

-- ---------------------------------------------------------------- chủ

create function public.owner_create_expense(p_shift uuid, p_amount int, p_note text) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare
  s public.shifts;
  v_note text := private.owner_expense_input(p_amount, p_note);
  v_id uuid := gen_random_uuid();
  v_rec jsonb;
begin
  perform private.require_owner();
  select * into s from public.shifts where id = p_shift for update;
  if not found then raise exception 'Không có ca' using errcode = 'P0002'; end if;
  if s.status = 'closed' then v_rec := private.reconcile_shift(s.id); end if;

  insert into public.shift_expenses (id, shift_id, amount, note, actor_kind, staff_id)
  values (v_id, s.id, p_amount, v_note, 'owner', null);
  perform private.audit('expense_create', 'shift_expense', v_id, null, private.expense_json(v_id), now(), 'owner', s.id, s.tablet_profile_id);
  perform private.mark_recalculated(s.id);
  perform private.notify_expense('expense_created', v_id, 'owner', null, v_rec, now());
  return v_id;
end $$;

-- Sửa số tiền / ghi chú của bất kỳ khoản chưa hủy. Không đổi gì ⇒ không ghi.
create function public.owner_edit_expense(p_id uuid, p_amount int, p_note text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  e public.shift_expenses;
  s public.shifts;
  v_note text := private.owner_expense_input(p_amount, p_note);
  v_before jsonb;
  v_rec jsonb;
begin
  perform private.require_owner();
  select * into e from public.shift_expenses where id = p_id for update;
  if not found then raise exception 'Không có khoản chi' using errcode = 'P0002'; end if;
  if e.voided_at is not null then raise exception 'Khoản chi đã hủy' using errcode = '22023'; end if;
  if e.amount = p_amount and e.note = v_note then return private.expense_json(e.id); end if;
  select * into s from public.shifts where id = e.shift_id;
  if s.status = 'closed' then v_rec := private.reconcile_shift(s.id); end if;

  v_before := private.expense_json(e.id);
  update public.shift_expenses set amount = p_amount, note = v_note where id = e.id;
  perform private.audit('expense_edit', 'shift_expense', e.id, v_before, private.expense_json(e.id), now(), 'owner', s.id, s.tablet_profile_id);
  perform private.mark_recalculated(s.id);
  perform private.notify_expense('expense_edited', e.id, 'owner', v_before, v_rec, now());
  return private.expense_json(e.id);
end $$;

-- Hủy bất kỳ khoản nào (cả khoản nhân viên ghi, cả ca đã đóng). Đã hủy rồi ⇒ không đổi.
create function public.owner_void_expense(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  e public.shift_expenses;
  s public.shifts;
  v_before jsonb;
  v_rec jsonb;
begin
  perform private.require_owner();
  select * into e from public.shift_expenses where id = p_id for update;
  if not found then raise exception 'Không có khoản chi' using errcode = 'P0002'; end if;
  if e.voided_at is not null then return private.expense_json(e.id); end if;
  select * into s from public.shifts where id = e.shift_id;
  if s.status = 'closed' then v_rec := private.reconcile_shift(s.id); end if;

  v_before := private.expense_json(e.id);
  update public.shift_expenses set voided_at = now(), void_actor_kind = 'owner' where id = e.id;
  perform private.audit('expense_void', 'shift_expense', e.id, v_before, private.expense_json(e.id), now(), 'owner', s.id, s.tablet_profile_id);
  perform private.mark_recalculated(s.id);
  perform private.notify_expense('expense_voided', e.id, 'owner', null, v_rec, now());
  return private.expense_json(e.id);
end $$;

-- Báo cáo khoản chi theo kỳ (chỉ chủ): các ca MỞ trong kỳ (như `by_shift` của owner_report), cộng theo nhóm ghi chú.
create function public.owner_expense_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r tstzrange;
begin
  perform private.require_owner();
  if p_to < p_from then raise exception 'Khoảng ngày không hợp lệ' using errcode = '22023'; end if;
  r := tstzrange(lower(private.day_range(p_from)), upper(private.day_range(p_to)), '[)');
  return private.expense_stats(array(select id from public.shifts where opened_at <@ r));
end $$;

revoke execute on function public.recent_expense_notes(), public.owner_create_expense(uuid, int, text),
  public.owner_edit_expense(uuid, int, text), public.owner_void_expense(uuid), public.owner_expense_report(date, date)
  from public, anon;
grant execute on function public.recent_expense_notes(), public.owner_create_expense(uuid, int, text),
  public.owner_edit_expense(uuid, int, text), public.owner_void_expense(uuid), public.owner_expense_report(date, date)
  to authenticated;

-- ---------------------------------------------------------------- đối soát + tổng kết ngày

-- Như bản 20261124000001_ship_external. Đổi: tiền mặt kỳ vọng − Σ khoản chi chưa hủy; thêm khối `expenses` {count, total}.
-- Cùng công thức với src/domain/reconcile.ts (tests/fixtures/reconcile-cases.json).
create or replace function private.reconcile_shift(p_shift uuid) returns jsonb
language plpgsql stable as $$
declare
  s public.shifts;
  adj_cash int; adj_boxes int; adj_plates int; adj_cans int;
  rev_cash int; rev_tr int; rev_debt int; rev_fee int; payout int; paid_n int; ship jsonb;
  dc_cash int; dc_tr int;
  ex_n int; ex_total int;
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

  select count(*), coalesce(sum(amount), 0)
    into ex_n, ex_total
    from public.shift_expenses where shift_id = p_shift and voided_at is null;

  -- Trả shipper ngoài và khoản chi đều là tiền mặt lấy từ két.
  expected := s.open_float + adj_cash + rev_cash + dc_cash - payout - ex_total;

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
    'expenses', jsonb_build_object('count', ex_n, 'total', ex_total),
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

-- Như bản 20261117000004_owner, thêm tổng chi của các ca mở trong ngày ({count, total, by_note}).
-- (Tổng kết ngày đang không chạy theo lịch — 20261120000004 — nhưng bật lại là có.)
create or replace function private.build_daily_summary(d date) returns jsonb
language sql stable as $$
  with r as (select private.day_range(d) rg)
  select jsonb_build_object(
    'date', d,
    'range', jsonb_build_object('from', lower(r.rg), 'to', upper(r.rg)),
    'revenue', jsonb_build_object(
      'total', coalesce((select sum(total) from public.orders where status = 'paid' and paid_at <@ r.rg), 0),
      'cash', coalesce((select sum(total) from public.orders where status = 'paid' and payment_method = 'cash' and paid_at <@ r.rg), 0),
      'transfer', coalesce((select sum(total) from public.orders where status = 'paid' and payment_method = 'transfer' and paid_at <@ r.rg), 0),
      'debt', coalesce((select sum(total) from public.orders where status = 'paid' and payment_method = 'debt' and paid_at <@ r.rg), 0)),
    'by_point', coalesce((
      select jsonb_agg(jsonb_build_object('point_name', p.name, 'total', x.total) order by p.sort, p.name)
      from (select point_id, sum(total) total from public.orders
             where status = 'paid' and paid_at <@ r.rg group by point_id) x
      join public.points p on p.id = x.point_id), '[]'),
    'debt_collected', coalesce((select sum(amount) from public.debt_payments where at <@ r.rg), 0),
    'expenses', private.expense_stats(array(select id from public.shifts where opened_at <@ r.rg)),
    'deleted', jsonb_build_object(
      'count', (select count(*) from public.orders where status = 'deleted' and deleted_at <@ r.rg),
      'served', (select count(*) from public.orders where status = 'deleted' and deleted_at <@ r.rg
                   and served_at is not null and served_at < deleted_at)),
    'shifts', coalesce((
      select jsonb_agg(private.shift_ctx(s.id) || jsonb_build_object(
               'status', s.status, 'reconcile', private.reconcile_shift(s.id)) order by s.opened_at)
      from public.shifts s where s.opened_at <@ r.rg), '[]'),
    'open_orders', (select count(*) from public.orders where status in ('open', 'served')),
    'unresolved_gaps', (select count(*) from public.seq_gaps where resolved_at is null))
  from r
$$;
