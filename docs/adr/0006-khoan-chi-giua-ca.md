# 0006. Khoản chi giữa ca: bảng riêng, nhân viên tự ghi, trừ vào tiền mặt kỳ vọng

- Ngày: 2026-11-24
- Trạng thái: Đã chốt. Chi tiết: SPEC.md mục 3, 4.9, 5, 6; kế hoạch [khoan-chi-giua-ca.md](../plans/khoan-chi-giua-ca.md)

## Bối cảnh
Giữa ca nhân viên hay lấy tiền két đi mua đá, ga… lúc chủ không có mặt. Hệ thống chưa có chỗ ghi việc này, nên két lệch
và "chênh lệch tiền mặt", tín hiệu chính để chống gian lận khi đếm mù, mất giá trị. Bổ sung giữa ca (`shift_adjustments`)
về kỹ thuật cho phép số âm, nhưng chỉ chủ ghi được và không hủy được.

## Quyết định
- Thêm bảng riêng `shift_expenses`, UI gọi là **khoản chi**. Đây là tiền mặt từ két của **một ca**, có số tiền (bội 1.000, > 0)
  và ghi chú bắt buộc.
- Nhân viên ghi qua `sync_push` khi ca đang mở. Chủ ghi từ chi tiết ca, kể cả ca đã đóng.
- Tiền mặt kỳ vọng của ca thêm `− Σ shift_expenses.amount (voided_at is null)`. Doanh thu không đổi.
- Nhân viên chỉ **hủy** (`voided_at`) khoản của ca còn mở và không phải chủ ghi. Chủ hủy hoặc sửa được bất kỳ khoản nào;
  sửa khoản của ca đã đóng thì đối soát tính lại, `recalculated_at`.
- Răn đe bằng **Telegram ngay** khi ghi, hủy hoặc sửa, cùng `audit_log`. Không đặt hạn mức, không bắt chụp ảnh.

## Hệ quả
- Nhân viên tự giảm được tiền mặt kỳ vọng. Rủi ro này chấp nhận được vì chủ thấy từng khoản trên Telegram ngay lúc đó.
- Tablet được đọc các khoản chi của ca đang mở của quầy mình, cùng tổng của chúng. Đây là số do chính nhân viên ghi nên không
  lộ doanh thu hay kỳ vọng ([ADR 0002](0002-tablet-khong-thay-doanh-thu.md)). Không được đọc khoản chi của ca đã đóng hay ca khác.
- Đổi công thức ⇒ `reconcile-cases.json`, `src/domain/reconcile.ts` và `private.reconcile_shift` đổi cùng nhau.
- **Không** ghi khoản chi bằng `shift_adjustments` âm. **Không** dùng khoản chi cho chi phí không lấy từ két (CK, tiền túi chủ).

## Phương án đã loại
- `shift_adjustments` với `kind = 'cash'` âm: chỉ chủ ghi được, không hủy được, không bắt buộc ghi chú, và báo cáo không tách
  được "chủ bỏ thêm tiền" với "đã chi".
- Chỉ chủ ghi khoản chi: chủ hay vắng lúc nhân viên mua đá, quên ghi thì két lệch.
- Danh mục chi cố định: bấm thêm một bước. Thay bằng "ghi chú gần đây" và cộng theo ghi chú giống nhau.
