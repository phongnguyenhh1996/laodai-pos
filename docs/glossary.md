# Thuật ngữ

Một khái niệm, một tên, dùng giống nhau ở UI, code, DB, Telegram và lúc nói chuyện với agent.
Thêm thuật ngữ mới vào đây ngay khi nó xuất hiện. Chi tiết nghiệp vụ: [SPEC.md](../SPEC.md) mục 2–4.

## Bán hàng

| Tiếng Việt (UI) | Code / DB | Nghĩa |
|---|---|---|
| Điểm bán | `points` | Nơi bán: Xôi A, Xôi B, Cơm gà. Mỗi điểm dùng một menu |
| Menu | `menus` | "Xôi", "Cơm gà". Xôi A và Xôi B dùng chung menu "Xôi" |
| Quầy | `tablet_profiles` | Hồ sơ máy bán hàng (vd. "Tablet A"): điểm bán được phép, số mặc định đầu ca, công tắc in. Nhiều máy có thể dùng chung một quầy. **UI nói "quầy", DB nói `tablet_profiles`** |
| Quầy của máy này | — | Màn chế độ chủ: quầy mà máy đang dùng, máy in, PIN |
| Ca | `shifts` | 1 nhân viên + 1 quầy + khoảng thời gian. Chịu trách nhiệm tiền mặt, hộp, dĩa, lon. Mỗi quầy tối đa 1 ca mở |
| Đơn | `orders` | Gắn nhãn điểm bán. Trạng thái `open` → `served` (ra món) → `paid`, hoặc `deleted` |
| Mã đơn | `orders.code` | Do server cấp, vd. "3F5" |
| Số thứ tự | `device_seq` | Do server cấp theo quầy, không trùng giữa các máy |
| Ra món | `served` | Đã đưa món cho khách, chưa thu tiền |
| Hàng đợi | — | Màn chính của tablet: các đơn đang mở, màu theo thời gian chờ |
| Món | `products` | Có giá và định mức bao bì (`boxes_*`, `plates_dinein`, `cans`) |
| Topping | `toppings` | Thêm vào món, có thể cần thêm hộp khi mang về |
| Combo | `combos` | Món + topping cố định. Giá = tổng, không có giá combo riêng |
| Hết món | `sold_out` | Khóa món / topping theo điểm bán trong ngày; "bán lại" = ghi `cleared_at` |
| Loại đơn | `dine_type` | `dinein` tại chỗ, `takeaway` mang về, `delivery` ship |
| Phí ship | `ship_fee` | Chỉ đơn ship, đã nằm trong `total` |
| Ảnh chụp giá | `*_snap` | Giá / tên lúc bán, lưu trong đơn; đổi giá không đổi đơn cũ |

## Tiền và đối soát

| Tiếng Việt (UI) | Code / DB | Nghĩa |
|---|---|---|
| TM / CK / Nợ | `payment_method` `cash` / `transfer` / `debt` | Hình thức thanh toán |
| Tiền lẻ đầu ca | `open_float`, `default_float` | Tiền mặt có sẵn khi mở ca |
| Bao bì | hộp `boxes`, dĩa `plates`, lon `cans` | Thứ được giao đầu ca và đếm lại cuối ca |
| Thứ phải đếm | `count_items` | Danh sách quầy bắt đếm khi đóng ca; ca chụp lại lúc mở, đổi công tắc chỉ áp dụng từ ca sau |
| Đếm mù | — | Nhân viên đếm cuối ca mà không thấy số kỳ vọng |
| Đối soát | `reconcile_shift` | So hàng giao – đơn bán – tiền thu của một ca, tính ở server |
| Bổ sung giữa ca | `shift_adjustments` | Chủ giao thêm hộp / dĩa / tiền giữa ca |
| Khách nợ | `customers` | Có thể gộp (`merged_into_id`) |
| Thu nợ | `debt_payments` | Khách trả nợ, bằng TM hoặc CK |
| Dư nợ | — | Σ đơn ghi nợ − Σ thu nợ, tính trên khách gốc sau khi gộp |

## Vai trò và hệ thống

| Tiếng Việt (UI) | Code / DB | Nghĩa |
|---|---|---|
| Chủ | vai trò `owner` | Một tài khoản email + mật khẩu |
| Chế độ chủ | — | Phiên chủ tạm trên một máy, vào bằng mật khẩu hoặc PIN, tự thoát sau 2 phút |
| PIN | `owner_device_pins` | PIN 6 số riêng từng máy để vào chế độ chủ |
| Kích hoạt | `activate-tablet` | Chủ đăng nhập rồi chọn quầy ⇒ máy nhận phiên vai trò `tablet` |
| Nhân viên | `staff` | Chọn tên khi mở ca, không PIN |
| Thao tác | `sync_push`, `op_id` | Mọi ghi từ tablet đi qua RPC idempotent này; gửi lại cùng `op_id` không ghi hai lần |
| Nhịp realtime | `live_pulse` | Bộ đếm tăng khi có thay đổi; tablet nghe bảng này thay vì `orders` |
| Nhật ký | `audit_log` | Mọi thao tác đều ghi lại, kèm trước / sau |
| Chủ sửa đơn | `owner_edited` | Chủ sửa đơn đã thanh toán |
| Phiếu bếp / Bill | `print_jobs.kind` `kitchen` / `bill` | Hai loại phiếu in |
| Phiếu "ĐÃ SỬA" | `print_jobs.detail` | Phiếu bếp in lại khi sửa đơn, chỉ món thêm / bớt |
| In từ xa | `print_jobs` | Máy không in được (điện thoại chủ) tạo lệnh, tablet của quầy nhận và in |
| Mẫu in | `print_template` | Một mẫu chung cho phiếu bếp và bill |
| Sổ lương | `payroll_entries` | Thưởng / trừ / ứng / trả / ngày công; không sửa, ghi nhầm thì hủy |
| Sao lưu đêm | `nightly-backup`, `backup_runs` | Zip mọi bảng gửi vào Telegram lúc 03:00 |
