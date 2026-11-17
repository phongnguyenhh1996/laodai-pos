-- Laodai POS — schema (Đợt 1)
-- Nguyên tắc: không có hard delete ở bảng nghiệp vụ; mọi ghi nghiệp vụ đi qua RPC SECURITY DEFINER.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------- cấu hình

create table public.settings (
  id boolean primary key default true check (id),
  telegram_chat_id text,
  wait_yellow_min int not null default 5 check (wait_yellow_min > 0),
  wait_red_min int not null default 10 check (wait_red_min > 0),
  daily_summary_time time not null default '14:30',
  timezone text not null default 'Asia/Ho_Chi_Minh',
  app_url text not null default 'http://localhost:4173',
  check (wait_red_min > wait_yellow_min)
);

-- Cấu hình nội bộ (không lộ qua API): URL Edge Functions cho pg_net.
create table private.config (
  key text primary key,
  value text not null
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  sort int not null default 0
);

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.points (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  menu_id uuid not null references public.menus (id),
  active boolean not null default true,
  default_dine_type text not null default 'takeaway' check (default_dine_type in ('dinein', 'takeaway')),
  sort int not null default 0
);

create table public.tablet_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  point_ids uuid[] not null default '{}',
  default_boxes int not null default 0 check (default_boxes >= 0),
  default_plates int not null default 0 check (default_plates >= 0),
  default_float int not null default 0 check (default_float >= 0),
  auth_user_id uuid unique
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus (id),
  name text not null,
  price int not null check (price >= 0),
  sort int not null default 0,
  active boolean not null default true,
  boxes_takeaway int not null default 1 check (boxes_takeaway >= 0),
  boxes_dinein int not null default 0 check (boxes_dinein >= 0),
  plates_dinein int not null default 0 check (plates_dinein >= 0)
);

create table public.toppings (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus (id),
  name text not null,
  price int not null check (price >= 0),
  extra_box_takeaway boolean not null default false,
  sort int not null default 0,
  active boolean not null default true
);

create table public.combos (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus (id),
  name text not null,
  product_id uuid not null references public.products (id),
  topping_ids uuid[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true
);

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('product', 'topping')),
  entity_id uuid not null,
  old_price int not null,
  new_price int not null,
  changed_at timestamptz not null default now()
);
create index on public.price_history (entity_type, entity_id, changed_at);

-- ---------------------------------------------------------------- ca

create table public.shifts (
  id uuid primary key,
  tablet_profile_id uuid not null references public.tablet_profiles (id),
  staff_id uuid not null references public.staff (id),
  opened_at timestamptz not null,
  closed_at timestamptz,
  open_boxes int not null,
  open_plates int not null,
  open_float int not null,
  close_boxes_left int check (close_boxes_left >= 0),
  close_plates_left int check (close_plates_left >= 0),
  close_cash_counted int check (close_cash_counted >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  recalculated_at timestamptz,
  synced_at timestamptz not null default now()
);
-- Mỗi tablet tại một thời điểm chỉ có 1 ca mở.
create unique index shifts_one_open_per_tablet on public.shifts (tablet_profile_id) where status = 'open';

create table public.shift_adjustments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id),
  kind text not null check (kind in ('boxes', 'plates', 'cash')),
  qty int not null check (qty <> 0),
  note text,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- khách nợ

create table public.customers (
  id uuid primary key,
  name text not null check (length(trim(name)) > 0),
  description text,
  phone text,
  merged_into_id uuid references public.customers (id),
  created_by_shift_id uuid references public.shifts (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- đơn

create table public.orders (
  id uuid primary key,
  device_seq int not null check (device_seq > 0),
  tablet_profile_id uuid not null references public.tablet_profiles (id),
  point_id uuid not null references public.points (id),
  code text not null check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$'),
  label text,
  table_no text,
  dine_type text not null check (dine_type in ('dinein', 'takeaway')),
  status text not null default 'open' check (status in ('open', 'served', 'paid', 'deleted')),
  opened_shift_id uuid not null references public.shifts (id),
  paid_shift_id uuid references public.shifts (id),
  created_at timestamptz not null,
  served_at timestamptz,
  paid_at timestamptz,
  deleted_at timestamptz,
  delete_reason text check (delete_reason in ('mistake', 'customer_left', 'customer_changed', 'other')),
  total int not null check (total >= 0),
  payment_method text check (payment_method in ('cash', 'transfer', 'debt')),
  cash_given int,
  customer_id uuid references public.customers (id),
  owner_edited boolean not null default false,
  synced_at timestamptz not null default now(),
  check ((status = 'paid') = (payment_method is not null and paid_shift_id is not null and paid_at is not null)),
  check ((payment_method = 'debt') = (customer_id is not null) or payment_method is null),
  check ((status = 'deleted') = (deleted_at is not null))
);
create unique index orders_device_seq on public.orders (tablet_profile_id, device_seq);
create index on public.orders (opened_shift_id);
create index on public.orders (paid_shift_id);
create index on public.orders (status, created_at);
create index on public.orders (customer_id) where customer_id is not null;

-- Dòng đơn: không xóa cứng; dòng bị bỏ khi sửa đơn được đánh dấu removed_at.
create table public.order_items (
  id uuid primary key,
  order_id uuid not null references public.orders (id),
  product_id uuid not null references public.products (id),
  name_snap text not null,
  unit_price_snap int not null check (unit_price_snap >= 0),
  qty int not null check (qty > 0),
  toppings_snap jsonb not null default '[]',
  sort int not null default 0,
  removed_at timestamptz
);
create index on public.order_items (order_id) where removed_at is null;

create table public.debt_payments (
  id uuid primary key,
  customer_id uuid not null references public.customers (id),
  amount int not null check (amount > 0),
  method text not null check (method in ('cash', 'transfer')),
  shift_id uuid references public.shifts (id),
  at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index on public.debt_payments (customer_id);
create index on public.debt_payments (shift_id);

-- ---------------------------------------------------------------- dấu vết

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),       -- thời điểm thực hiện
  synced_at timestamptz not null default now(), -- thời điểm server nhận
  actor_kind text not null check (actor_kind in ('staff', 'owner', 'system')),
  staff_id uuid references public.staff (id),
  tablet_profile_id uuid references public.tablet_profiles (id),
  shift_id uuid references public.shifts (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  reason text
);
create index on public.audit_log (at desc);
create index on public.audit_log (entity, entity_id);
create index on public.audit_log (staff_id, action);

-- Thao tác đồng bộ đã xử lý (khóa idempotent).
create table public.sync_ops (
  op_id uuid primary key,
  tablet_profile_id uuid not null references public.tablet_profiles (id),
  kind text not null,
  entity_id uuid,
  performed_at timestamptz not null,
  synced_at timestamptz not null default now(),
  result jsonb not null
);

-- Lỗ hổng device_seq (đơn bị mất trước khi sync).
create table public.seq_gaps (
  id uuid primary key default gen_random_uuid(),
  tablet_profile_id uuid not null references public.tablet_profiles (id),
  missing_seq int not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (tablet_profile_id, missing_seq)
);

-- Hàng đợi tin Telegram (cũng là nhật ký thông báo).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  performed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  business_date date,
  sent_at timestamptz,
  attempts int not null default 0,
  error text
);
create index on public.notifications (kind, business_date);
