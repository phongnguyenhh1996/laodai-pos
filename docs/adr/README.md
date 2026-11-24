# Architectural Decision Records

Mỗi file ghi một quyết định **khó đảo ngược**, để người và agent không lặp lại tranh luận cũ hoặc vô tình phá nó.
Đánh số tăng dần, không sửa nội dung ADR cũ: đổi ý thì viết ADR mới và đánh dấu ADR cũ là "Bị thay bởi NNNN".
Mẫu: [0000-mau.md](0000-mau.md).

| # | Quyết định | Trạng thái |
|---|---|---|
| [0001](0001-server-la-nguon-su-that.md) | Server là nguồn sự thật, không có chế độ offline | Đã chốt |
| [0002](0002-tablet-khong-thay-doanh-thu.md) | Tablet không thấy doanh thu, chặn ở tầng RLS | Đã chốt |
| [0003](0003-khong-xoa-cung-va-nhat-ky.md) | Không hard delete, mọi thao tác vào nhật ký | Đã chốt |
| [0004](0004-in-anh-1-bit-qua-capacitor.md) | In phiếu bằng ảnh 1-bit qua app Android Capacitor + Bluetooth SPP | Đã chốt |
| [0005](0005-sao-luu-dem-qua-telegram.md) | Sao lưu hằng đêm vào Telegram | Đã chốt |
| [0006](0006-khoan-chi-giua-ca.md) | Khoản chi giữa ca: bảng riêng, nhân viên tự ghi, trừ vào tiền mặt kỳ vọng | Đã chốt |

ADR 0001–0005 được ghi lại ngày 2026-11-23 từ SPEC.md và README.md; quyết định gốc đã có từ trước.
