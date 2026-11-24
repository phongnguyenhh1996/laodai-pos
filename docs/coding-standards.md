# Coding standards

Mỗi dòng ở đây là một luật đã chốt. Khi retro sau mỗi task: luật nào kiểm tra được bằng máy (test, type, lint)
thì chuyển thành kiểm tra tự động và ghi "(tự động: …)" bên cạnh.

## Chung

- TypeScript `strict`, không dùng `any`; cần thoát hiểm thì `unknown` rồi thu hẹp. (tự động: `tsc` strict + ESLint `no-explicit-any`)
- Không có cảnh báo lint nào được merge; luật hook React (`react-hooks/*`) bật cho `src/`. (tự động: `npm run lint`, CI)
- Mọi PR phải qua `npm run check` trên CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)).
- Thuật ngữ theo [glossary.md](glossary.md). Không đặt tên mới cho khái niệm đã có tên.
- Logic nghiệp vụ thuần nằm ở `src/domain/` (không React, không Supabase), test ở đó trước.
- Ngưỡng coverage ≥ 90% dòng / nhánh cho `src/domain`, `src/pos`. (tự động: `npm run test:coverage`)

## Dữ liệu và bảo mật

- Server là nguồn sự thật ([ADR 0001](adr/0001-server-la-nguon-su-that.md)). Tablet không lưu đơn trên máy.
- Mọi ghi từ tablet đi qua `sync_push` với `op_id`; không thêm đường ghi thẳng vào bảng từ tablet.
- Không hard delete bảng nghiệp vụ ([ADR 0003](adr/0003-khong-xoa-cung-va-nhat-ky.md)). Xóa = đổi trạng thái / `voided_at` / `deleted_at`.
- Mọi thay đổi nghiệp vụ ghi `audit_log`.
- Tablet không được đọc doanh thu: bảng / RPC mới phải có RLS cho vai trò `tablet` và test trong `tests/db/` ([ADR 0002](adr/0002-tablet-khong-thay-doanh-thu.md)).
- Migration chỉ thêm file mới, không sửa migration đã áp.

## Test

- Mỗi lỗi gặp khi dùng thật phải có test tái hiện trước khi sửa.
- Đổi công thức đối soát ⇒ cập nhật `tests/fixtures/reconcile-cases.json`, test TS và test SQL đều pass.
- Test qua giao diện công khai của module, không kiểm tra chi tiết bên trong.
- Đổi chữ trên UI ⇒ cập nhật Cypress dùng chữ đó.

## UI

- Nhân viên không bao giờ thấy doanh thu, tổng số đơn hoặc số kỳ vọng khi đếm.
- Mọi ô tiền dùng `MoneyInput` (nhập theo nghìn, [src/app/MoneyInput.tsx](../src/app/MoneyInput.tsx)); không tự làm ô số có đuôi "đ". (tự động: ESLint `no-restricted-syntax` với `unit` / `suffix` = "đ")
- Tablet: nút to, ít chữ, một chạm. Chế độ chủ: tối ưu cho điện thoại 390px, vẫn dùng được ở 1280px.
