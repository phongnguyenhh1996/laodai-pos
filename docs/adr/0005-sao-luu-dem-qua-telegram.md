# 0005. Sao lưu hằng đêm vào Telegram

- Ngày: 2026-11-22 (ghi lại 2026-11-23)
- Trạng thái: Đã chốt. Chi tiết: README.md mục "Sao lưu hằng đêm"

## Bối cảnh
Gói Supabase miễn phí không có khôi phục theo thời điểm. Chi phí vận hành mục tiêu 0đ/tháng.

## Quyết định
03:00 giờ VN, `pg_cron` gọi Edge Function `nightly-backup`: chụp mọi bảng `public` (trừ dữ liệu tạm) thành zip và gửi vào chat Telegram. Khôi phục bằng `npm run db:restore` vào dự án mới, trống.

## Hệ quả
- Thêm bảng nghiệp vụ mới ⇒ kiểm tra nó có trong bản sao lưu và `tests/db/backup.test.ts` vẫn pass.
- Giới hạn file 50MB của Telegram; không sao lưu tài khoản auth, PIN, secret.
