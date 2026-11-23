# 0001. Server là nguồn sự thật, không có chế độ offline

- Ngày: 2026-11-17 (ghi lại 2026-11-23)
- Trạng thái: Đã chốt. Chi tiết: SPEC.md mục 1.1

## Bối cảnh
Nhiều máy có thể dùng chung một quầy (vd. hai tablet cùng điểm bán). Ca, hàng đợi, mã đơn phải có một bản duy nhất để không xung đột.

## Quyết định
- Tablet đọc / ghi thẳng Supabase. Mọi thao tác gọi RPC idempotent `sync_push`, chỉ coi là xong khi server trả lời.
- Server cấp mã đơn, `device_seq` và giờ thực hiện.
- Tablet nghe thay đổi qua Realtime trên `live_pulse`, không nghe thẳng `orders` (RLS giấu đơn đã thanh toán).

## Hệ quả
- Mất mạng ⇒ báo "Mất kết nối", thao tác không lưu. Đây là chủ ý, không phải lỗi.
- **Không** thêm hàng đợi offline, cache đơn trong IndexedDB / localStorage, hay sinh mã đơn ở client.
- Gửi lại phải dùng lại `op_id`.

## Phương án đã loại
Offline-first với outbox IndexedDB (bản đầu, đã bỏ; `src/pos/legacy.ts` chỉ còn để chuyển tiếp): xung đột khi nhiều máy cùng quầy.
