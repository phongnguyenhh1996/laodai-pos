-- Seed cố định cho dev + test (mục 10.1). ID cố định để test tham chiếu (xem tests/seed-ids.ts).
-- Tài khoản chủ test: owner@laodai.test / laodai-owner-123 (CHỈ dùng local).

insert into public.settings (id, telegram_chat_id, wait_yellow_min, wait_red_min, daily_summary_time, timezone, app_url)
values (true, '-1001234567890', 5, 10, '14:30', 'Asia/Ho_Chi_Minh', 'http://localhost:4173');

-- pg_net trong container DB gọi Edge Functions qua cổng API của máy host.
insert into private.config (key, value) values ('functions_url', 'http://host.docker.internal:54321/functions/v1');

insert into public.staff (id, name, sort) values
  ('aaaaaaaa-0000-4000-8000-000000000401', 'Lan', 1),
  ('aaaaaaaa-0000-4000-8000-000000000402', 'Mai', 2),
  ('aaaaaaaa-0000-4000-8000-000000000403', 'Hùng', 3);

insert into public.menus (id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'Xôi'),
  ('aaaaaaaa-0000-4000-8000-000000000102', 'Cơm gà');

insert into public.points (id, name, menu_id, default_dine_type, sort) values
  ('aaaaaaaa-0000-4000-8000-000000000201', 'Xôi A', 'aaaaaaaa-0000-4000-8000-000000000101', 'takeaway', 1),
  ('aaaaaaaa-0000-4000-8000-000000000202', 'Xôi B', 'aaaaaaaa-0000-4000-8000-000000000101', 'takeaway', 2),
  ('aaaaaaaa-0000-4000-8000-000000000203', 'Cơm gà', 'aaaaaaaa-0000-4000-8000-000000000102', 'dinein', 3);

insert into public.tablet_profiles (id, name, point_ids, default_boxes, default_plates, default_float) values
  ('aaaaaaaa-0000-4000-8000-000000000301', 'Tablet A',
   array['aaaaaaaa-0000-4000-8000-000000000201', 'aaaaaaaa-0000-4000-8000-000000000203']::uuid[], 200, 60, 500000),
  ('aaaaaaaa-0000-4000-8000-000000000302', 'Tablet B',
   array['aaaaaaaa-0000-4000-8000-000000000202']::uuid[], 150, 0, 300000);

-- Xôi: mỗi phần 1 hộp (mang về hay tại chỗ). Cơm: mang về 1 hộp, tại chỗ 1 dĩa.
insert into public.products (id, menu_id, name, price, sort, boxes_takeaway, boxes_dinein, plates_dinein) values
  ('aaaaaaaa-0000-4000-8000-000000000501', 'aaaaaaaa-0000-4000-8000-000000000101', 'Xôi gà', 25000, 1, 1, 1, 0),
  ('aaaaaaaa-0000-4000-8000-000000000502', 'aaaaaaaa-0000-4000-8000-000000000101', 'Xôi xéo', 15000, 2, 1, 1, 0),
  ('aaaaaaaa-0000-4000-8000-000000000503', 'aaaaaaaa-0000-4000-8000-000000000101', 'Xôi pate', 20000, 3, 1, 1, 0),
  ('aaaaaaaa-0000-4000-8000-000000000504', 'aaaaaaaa-0000-4000-8000-000000000101', 'Xôi thập cẩm', 30000, 4, 1, 1, 0),
  ('aaaaaaaa-0000-4000-8000-000000000511', 'aaaaaaaa-0000-4000-8000-000000000102', 'Cơm gà', 35000, 1, 1, 0, 1),
  ('aaaaaaaa-0000-4000-8000-000000000512', 'aaaaaaaa-0000-4000-8000-000000000102', 'Cơm gà đùi', 45000, 2, 1, 0, 1);

insert into public.toppings (id, menu_id, name, price, extra_box_takeaway, sort) values
  ('aaaaaaaa-0000-4000-8000-000000000601', 'aaaaaaaa-0000-4000-8000-000000000101', 'Trứng', 6000, false, 1),
  ('aaaaaaaa-0000-4000-8000-000000000602', 'aaaaaaaa-0000-4000-8000-000000000101', 'Chả', 8000, false, 2),
  ('aaaaaaaa-0000-4000-8000-000000000603', 'aaaaaaaa-0000-4000-8000-000000000101', 'Ruốc', 5000, false, 3),
  ('aaaaaaaa-0000-4000-8000-000000000611', 'aaaaaaaa-0000-4000-8000-000000000102', 'Canh', 5000, true, 1),
  ('aaaaaaaa-0000-4000-8000-000000000612', 'aaaaaaaa-0000-4000-8000-000000000102', 'Dưa góp', 3000, true, 2),
  ('aaaaaaaa-0000-4000-8000-000000000613', 'aaaaaaaa-0000-4000-8000-000000000102', 'Thêm cơm', 5000, false, 3),
  ('aaaaaaaa-0000-4000-8000-000000000614', 'aaaaaaaa-0000-4000-8000-000000000102', 'Thêm gà', 15000, false, 4);

insert into public.combos (id, menu_id, name, product_id, topping_ids, sort) values
  ('aaaaaaaa-0000-4000-8000-000000000701', 'aaaaaaaa-0000-4000-8000-000000000101', 'Xôi gà trứng',
   'aaaaaaaa-0000-4000-8000-000000000501', array['aaaaaaaa-0000-4000-8000-000000000601']::uuid[], 1),
  ('aaaaaaaa-0000-4000-8000-000000000702', 'aaaaaaaa-0000-4000-8000-000000000101', 'Xôi xéo chả ruốc',
   'aaaaaaaa-0000-4000-8000-000000000502',
   array['aaaaaaaa-0000-4000-8000-000000000602', 'aaaaaaaa-0000-4000-8000-000000000603']::uuid[], 2),
  ('aaaaaaaa-0000-4000-8000-000000000711', 'aaaaaaaa-0000-4000-8000-000000000102', 'Cơm gà canh',
   'aaaaaaaa-0000-4000-8000-000000000511', array['aaaaaaaa-0000-4000-8000-000000000611']::uuid[], 1);

insert into public.customers (id, name, description, phone) values
  ('aaaaaaaa-0000-4000-8000-000000000801', 'Dũng', 'giáo viên', null),
  ('aaaaaaaa-0000-4000-8000-000000000802', 'Dũng', 'phường B', '0909000111');

-- Seed không phải thao tác của chủ: dọn nhật ký do trigger audit_settings sinh ra.
alter table public.audit_log disable trigger forbid_delete;
delete from public.audit_log;
alter table public.audit_log enable trigger forbid_delete;

-- Tài khoản chủ (local/test)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000901', 'authenticated', 'authenticated',
  'owner@laodai.test', extensions.crypt('laodai-owner-123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"],"role":"owner"}', '{}', now(), now(), '', '', '', ''
);
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000901', 'aaaaaaaa-0000-4000-8000-000000000901',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000901","email":"owner@laodai.test","email_verified":true}',
  'email', now(), now(), now()
);
