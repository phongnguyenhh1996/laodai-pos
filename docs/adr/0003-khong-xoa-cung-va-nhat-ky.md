# 0003. Không hard delete, mọi thao tác vào nhật ký

- Ngày: 2026-11-17 (ghi lại 2026-11-23)
- Trạng thái: Đã chốt. Chi tiết: SPEC.md mục 3, 6

## Bối cảnh
Phần mềm không chặn được việc thu tiền mà không bấm đơn, nên hệ thống ghi lại mọi thứ để chủ chất vấn.

## Quyết định
- Không hard delete ở bảng nghiệp vụ. Xóa đơn = `status = deleted` + lý do; sổ lương ghi nhầm thì `voided_at`.
- Mọi thao tác ghi `audit_log` với trước / sau; thao tác quan trọng báo Telegram.
- Giá trong đơn là ảnh chụp (`*_snap`).

## Hệ quả
**Không** viết `delete from` cho bảng nghiệp vụ, không cập nhật đơn cũ khi đổi giá. Ngoại lệ: dữ liệu tạm (`live_pulse`, `print_jobs`, `sync_ops`).
