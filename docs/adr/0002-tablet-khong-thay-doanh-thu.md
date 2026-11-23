# 0002. Tablet không thấy doanh thu, chặn ở tầng RLS

- Ngày: 2026-11-17 (ghi lại 2026-11-23)
- Trạng thái: Đã chốt. Chi tiết: SPEC.md mục 1.2, 11.5

## Bối cảnh
Chống gian lận dựa vào đếm mù: nhân viên không biết số kỳ vọng nên không "đếm cho khớp". Nhân viên rành kỹ thuật có thể mở devtools.

## Quyết định
Vai trò Postgres `tablet` riêng. RLS chỉ cho đọc menu / nhân viên / khách nợ và **đơn đang mở** của quầy mình; không đọc đơn đã thanh toán, ca đã đóng, báo cáo, nhật ký.

## Hệ quả
- Ẩn trên UI là chưa đủ: mọi bảng / RPC mới phải có RLS cho `tablet` và test trong `tests/db/`.
- RPC trả dữ liệu cho tablet không được kèm tổng tiền, số đơn đã bán, số kỳ vọng.

## Phương án đã loại
Chỉ ẩn ở giao diện: lấy được doanh thu bằng cách gọi API trực tiếp.
