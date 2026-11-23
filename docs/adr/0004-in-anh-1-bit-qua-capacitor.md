# 0004. In phiếu bằng ảnh 1-bit qua app Android Capacitor + Bluetooth SPP

- Ngày: 2026-11-20 (ghi lại 2026-11-23)
- Trạng thái: Đã chốt. Chi tiết: SPEC.md mục 12, docs/plans/in-phieu-bep-va-bill.md

## Bối cảnh
Cần in phiếu bếp và bill tiếng Việt có dấu, chữ to, trên máy in nhiệt 58mm rẻ; PWA không truy cập được Bluetooth Classic.

## Quyết định
- Tablet quầy chạy app Capacitor mở thẳng web production; push `main` là tablet tự cập nhật.
- Vẽ phiếu thành ảnh đen trắng rộng 384 điểm, gửi ESC/POS `GS v 0` qua Bluetooth SPP (plugin `LaodaiPrinterPlugin.java`).
- Máy không in được (điện thoại chủ) tạo `print_jobs`, tablet của quầy nhận và in.

## Hệ quả
- Đổi phần native (plugin, quyền, `capacitor.config.ts`) ⇒ phải build và cài lại APK trên từng tablet: đây là cửa một chiều.
- Chỉ hỗ trợ khổ 58mm.

## Phương án đã loại
In bằng text ESC/POS (lỗi dấu tiếng Việt), Web Bluetooth BLE (máy in rẻ không hỗ trợ), app in trung gian.
