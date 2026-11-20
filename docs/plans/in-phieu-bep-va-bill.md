# Plan: In phiếu bếp & bill thanh toán

Thiết kế đã chốt: **SPEC.md mục 12** (ngày 2026-11-20, chốt qua buổi hỏi đáp Q1–Q27).
File này là danh sách việc. Làm xong mục nào thì đánh dấu `[x]`. Đổi thiết kế thì sửa SPEC trước, rồi mới sửa plan.

## Quyết định đã chốt (đối chiếu nhanh)

- [x] App Android **Capacitor** cho tablet, mở thẳng URL Vercel. Điện thoại chủ vẫn dùng PWA (không in trực tiếp).
- [x] **Bluetooth Classic SPP + ESC/POS**, khổ **58mm**, phiếu **vẽ thành ảnh 384 điểm** (giữ dấu tiếng Việt).
- [x] Máy in **ghép theo từng máy**, chỉ ghép hoặc đổi trong chế độ chủ (Quầy của máy này → Máy in → In thử). Nhân viên chỉ có trạng thái + "Kết nối lại".
- [x] 3 công tắc theo quầy, **chỉ bật/tắt in tự động**: `auto_print_kitchen`, `auto_reprint_kitchen_on_edit`, `auto_print_bill`. In tay lúc nào cũng in được.
- [x] Phiếu bếp: tự in khi server trả mã đơn. Sửa đơn thì in lại có "ĐÃ SỬA" + **giờ sửa** + món thêm/bớt. Xóa đơn thì không in. **Không có giá.**
- [x] Nút "In lại phiếu bếp" trên thẻ đơn **luôn hiện** khi đơn còn trong hàng đợi.
- [x] Bill: tự in sau khi thanh toán thành công, kể cả ghi nợ. **Không in** hình thức thanh toán, tiền đưa/thối, thông tin nợ, tên nhân viên.
- [x] **Tablet không có nút in hay in lại bill.** Chỉ chủ in lại từ xa. Bản in lại **giống hệt bản gốc**, theo nội dung hiện tại của đơn và mẫu hiện tại.
- [x] **Một mẫu in chung**: bật/tắt từng dòng, chữ tự nhập (tên quán, SĐT, địa chỉ, 1–3 dòng chân trang), cỡ mã đơn to/rất to, **xem trước** đúng ảnh in, nút **In thử**.
- [x] In từ xa: mặc định gửi tới quầy đã bán đơn, đổi được quầy. Máy đầu tiên có máy in nhận lệnh (khóa nguyên tử). Trạng thái realtime. **Hết hạn sau 2 phút**, không in muộn.
- [x] Lỗi in **không chặn** gì cả, tablet báo đỏ. Mọi lần in đều ghi `print_jobs` + `audit_log`. **Không báo Telegram.** Báo cáo ca có dòng "bill in lỗi / không in" kèm mã đơn.
- [ ] Chưa làm (để sau): VietQR tạm tính, bill điện tử, phiếu thu nợ, 80mm, máy in LAN.

## Các bước

Mỗi bước chỉ xong khi test của bước đó pass (theo quy ước SPEC mục 10).

### 1. Dữ liệu (Supabase)
- [x] Migration `2026112x_printing.sql`:
  - [x] `tablet_profiles` thêm 3 cột bool. Mặc định: `auto_print_kitchen = true`, `auto_reprint_kitchen_on_edit = true`, `auto_print_bill = true`.
  - [x] Bảng `print_template` (singleton, jsonb) kèm giá trị mặc định.
  - [x] Bảng `print_jobs` (xem SPEC mục 3) + index `(tablet_profile_id, status)`.
  - [x] RLS: tablet chỉ đọc/nhận lệnh của quầy mình. Chủ tạo và đọc tất cả. Không hard delete.
  - [x] RPC `print_job_create` (chủ: in lại hoặc in thử. Tablet: in tại chỗ, tự nhận luôn).
  - [x] RPC `print_job_claim` (nguyên tử `pending → claimed`, từ chối nếu quá 2 phút).
  - [x] RPC `print_job_finish` (printed/failed + lỗi), ghi `audit_log`.
  - [x] Hết hạn: đổi `pending` quá 2 phút thành `expired` (khi claim hoặc khi đọc, cộng `pg_cron` dọn dẹp).
  - [x] Realtime: tablet nhận lệnh mới qua `live_pulse` hoặc kênh riêng cho `print_jobs`. Lưu ý RLS khi nghe realtime.
  - [x] RPC sửa mẫu in (chủ), ghi `audit_log`.
  - [x] Đối soát ca: thêm "bill in lỗi / không in", tức đơn `paid_shift_id = ca` không có job bill `printed`.
- [x] Dùng lại **id máy** đã có (`owner_device_pin`, `src/pos/activation.ts`) làm `device_id`.
- [x] Cập nhật `supabase/seed.sql`.
- [x] Test DB (10.3): RLS, 2 máy cùng claim thì chỉ 1 máy được, hết hạn sau 2 phút, chủ tạo lệnh, tablet quầy khác không nhận được, đếm bill không in trong đối soát.

### 2. Vẽ phiếu (logic thuần, `src/print/`)
- [x] `layout.ts`: từ đơn + mẫu + loại phiếu (bếp/bill/sửa/thử) → danh sách dòng (chữ, cỡ, căn lề, kẻ ngang). Hàm thuần, không đụng canvas.
- [x] Diff món cho phiếu "ĐÃ SỬA" (thêm/bớt/đổi số lượng/đổi topping), dựa trên `audit_log` before/after hoặc bản đã in gần nhất.
- [x] `render.ts`: danh sách dòng → canvas 384px (font Be Vietnam Pro) → ảnh 1-bit.
- [x] `escpos.ts`: ảnh 1-bit → lệnh `GS v 0` (raster), cộng lệnh khởi tạo, đẩy giấy, cắt (nếu máy hỗ trợ). Chia gói khi gửi.
- [x] Unit test: snapshot layout cho từng loại phiếu, dòng bị tắt thì không xuất hiện, bill không bao giờ có hình thức thanh toán / nợ / nhân viên, phiếu bếp không có giá, bytes ESC/POS cho ảnh nhỏ cố định.

### 3. Lớp máy in (`src/print/printer.ts`)
- [x] Interface `Printer { status, connect(), print(bytes) }` với 3 bản: **Capacitor SPP** (thật), **không hỗ trợ** (PWA), **giả** (test/E2E, lưu lại các lệnh đã in).
- [x] Nhớ máy in đã chọn trên máy (Capacitor Preferences hoặc localStorage), tự kết nối lại khi mở app.
- [x] Hàng đợi in tại chỗ: in lần lượt, không chồng lệnh, báo kết quả về `print_job_finish`.

### 4. App Android (Capacitor)
- [x] Thêm `@capacitor/core`, `@capacitor/android`, cấu hình `server.url` trỏ tới URL Vercel production.
- [ ] Plugin Bluetooth Classic SPP: đã viết plugin Java `android/app/src/main/java/vn/laodai/pos/LaodaiPrinterPlugin.java` (liệt kê máy đã ghép, kết nối, ghi bytes). **Còn: build APK + thử trên máy in thật** (máy dev chưa có Android SDK, chưa compile được).
- [ ] Quyền Bluetooth: đã khai báo (`BLUETOOTH_CONNECT` cho Android 12+, `BLUETOOTH`/`BLUETOOTH_ADMIN` cho ≤ 11). **Còn: kiểm tra trên Android 12+ và Android cũ.**
- [x] Màn hình luôn sáng, ghim màn hình vẫn chạy trong app native.
- [x] Script build APK + hướng dẫn cài/cập nhật trong README.
- [x] Nhận biết đang chạy trong app native (`Capacitor.isNativePlatform()`) để bật lớp máy in thật.

### 5. Giao diện tablet
- [x] Trạng thái máy in + "Kết nối lại" trên hàng đợi.
- [x] Tạo đơn xong (server đã trả mã) thì tự in phiếu bếp nếu bật `auto_print_kitchen`.
- [x] Sửa đơn thì tự in phiếu "ĐÃ SỬA" nếu bật `auto_reprint_kitchen_on_edit`.
- [x] Nút "In lại phiếu bếp" trên thẻ đơn (luôn hiện).
- [x] Thanh toán thành công thì tự in bill nếu bật `auto_print_bill`. **Không** có nút in bill.
- [x] Báo đỏ khi in lỗi (không chặn thao tác).
- [x] Nhận lệnh in từ xa qua realtime → claim → in → finish.
- [x] Test component (RTL) với máy in giả.

### 6. Giao diện chủ
- [x] Quầy của máy này → **Máy in**: chọn máy đã ghép, In thử, trạng thái (chỉ trong app native).
- [x] Cài đặt hồ sơ tablet: 3 công tắc in tự động.
- [x] Cài đặt → **Mẫu in**: form bật/tắt dòng + chữ tự nhập + cỡ mã đơn, **xem trước** (đúng ảnh `render.ts`), In thử (tại chỗ hoặc gửi tới quầy).
- [x] Chi tiết đơn: "In lại bill" / "In lại phiếu bếp" → chọn quầy (mặc định quầy bán) → trạng thái realtime (chờ / đã in / lỗi / hết hạn).
- [x] Nhật ký: lọc theo loại in.
- [x] Báo cáo ca: dòng "bill in lỗi / không in" + danh sách mã đơn.

### 7. E2E & thử thật
- [x] Cypress (máy in giả): tạo đơn → có job bếp; sửa → job "ĐÃ SỬA"; thanh toán → job bill; tắt công tắc → không tự in nhưng in tay được; chủ in lại từ xa → tablet nhận; không có tablet → hết hạn sau 2 phút (`cy.clock`); in lỗi → báo cáo ca đếm đúng.
- [ ] Checklist trên tablet + máy in thật: ghép nối, in tiếng Việt có dấu, mã đơn chữ to rõ, tốc độ in, tắt/bật máy in giữa chừng, hết giấy, mất mạng, 2 tablet cùng quầy nhận lệnh từ xa.

## Rủi ro / cần kiểm tra sớm
- Plugin SPP cho Capacitor: kiểm tra trước khi làm UI (bước 4 có thể chạy song song với bước 1–2).
- Tốc độ in ảnh trên máy in rẻ, gửi qua SPP: có thể phải chia gói hoặc nén.
- Font khi vẽ canvas trên Android WebView cũ: phải đợi font tải xong mới vẽ.
- Realtime + RLS cho `print_jobs`: có thể phải dùng `live_pulse` rồi tải lại, như cách làm với `orders`.

## Ghi chú khi làm (2026-11-20)
- Migration: `supabase/migrations/20261120000002_printing.sql`. RPC: `print_job_create`, `print_job_claim`, `print_job_finish`,
  `owner_set_print_template`, `owner_shift_print_issues`; cron `laodai-expire-print-jobs` (mỗi phút). Đối soát ca giữ nguyên
  `reconcile_shift` (khớp fixture TS), dòng "bill in lỗi / không in" là RPC riêng.
- Tablet nghe lệnh mới thẳng trên `print_jobs` (Realtime + RLS theo quầy), không qua `live_pulse`.
- Quyền Bluetooth: chỉ `BLUETOOTH_CONNECT` (không quét nên không cần `BLUETOOTH_SCAN`).
- Phiếu "ĐÃ SỬA": gom các lần tự lưu liên tiếp (4 giây) thành một phiếu — xem SPEC 12.3.
- E2E dùng máy in giả: build với `VITE_FAKE_PRINTER=1` (đã thêm vào `e2e:serve`) + `localStorage['laodai-fake-printer'] = '1'`.
  Bản production không có máy in giả.
- **Trước khi push `main`**: áp migration lên Supabase cloud trước (frontend mới đọc cột `auto_print_*`).
