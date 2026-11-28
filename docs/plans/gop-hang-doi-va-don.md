# Plan: Gộp Hàng đợi và Đơn thành màn Bán hàng

SPEC: mục 4.2, 4.3, 4.4, 7, 10.2, 10.4, 12.3, 12.5. Thuật ngữ: Bán hàng, Hàng đợi (dải đơn), Đơn đang chọn (`docs/glossary.md`).
Ảnh tham khảo: POS mẫu "Tasty Station" (dải đơn trên cùng, thực đơn giữa, giỏ + chọn thanh toán bên phải).
File này là danh sách việc. Làm xong mục nào thì đánh dấu `[x]`. Đổi thiết kế thì sửa SPEC trước, rồi mới sửa plan.

## Mục tiêu

Hiện tại nhân viên phải qua lại hai màn: Hàng đợi (xem đơn) và Đơn (gọi món, toàn màn hình), rồi thêm màn Thanh toán.
Đang gọi món thì không thấy các đơn khác, giỏ khó đọc, giao diện cũ.
Gộp thành **một màn Bán hàng**: dải đơn đang mở ở trên, thực đơn ở giữa, giỏ (kèm thanh toán) bên phải. Bấm một thẻ đơn là sửa đơn đó ngay.

**Chỉ cập nhật UX, không thêm chức năng**: mọi thao tác, luật và tín hiệu hiện có vẫn giữ, chỉ đổi chỗ đặt và cách đi tới.

## Quyết định (đã grill 28/11)

Bố cục:
- [x] Có cả **tablet và điện thoại**.
- [x] Tablet (1280×800): sidebar 240px như hiện nay | cột giữa: dải đơn + thực đơn (3 cột thẻ món) | cột giỏ 380px.
      Màn Bán hàng **có sidebar** (màn đơn cũ chiếm trọn màn hình thì nay không còn).
- [x] Sidebar: hai mục "Hàng đợi" và "Đơn mới" gộp thành một mục **"Bán hàng"**.
- [x] Điện thoại (390): đầu màn là chip lọc + dải thẻ đơn nhỏ cuộn ngang (khoảng 72px), giữa là thực đơn, đáy là giỏ thu gọn như hiện nay.
      Thanh menu đáy của hàng đợi cũ (Thu nợ / Chi tiền / Đóng ca / Chế độ chủ) chuyển vào nút **☰** trên header.
- [x] Thẻ món giữ nguyên: không ảnh, không nút −/+ trên thẻ (số lượng sửa trong giỏ).

Dải đơn (Hàng đợi):
- [x] Chip lọc **Tất cả · Chờ ra món · Chờ thanh toán** kèm số đếm. Mặc định Tất cả.
- [x] Thẻ cuộn ngang. Ở Tất cả: chờ ra món trước, chờ thanh toán sau; trong mỗi nhóm đơn cũ nhất trước.
- [x] Thẻ đơn: **mã đơn · nhãn/bàn · số món · đồng hồ chờ** (vàng ≥ 5 phút, đỏ ≥ 10 phút như cũ) **· tổng tiền · badge trạng thái / ship**
      ("+10k ship", "Ship ngoài · trả 10k").
- [x] Bỏ khỏi thẻ: **số thứ tự trong hàng đợi** (đã có mã đơn), tóm tắt món, nút "Đã ra món", nút "In lại phiếu bếp" (chuyển vào giỏ).
- [x] **Bỏ hẳn số thứ tự hàng đợi**, kể cả trên **phiếu bếp** (chủ chốt 28/11): bỏ dòng "Số N" trên phiếu và công tắc
      "Số thứ tự hàng đợi" trong Mẫu in. Mã đơn đã đủ để gọi khách.
- [x] Dải trống: chip vẫn hiện (số 0), vùng thẻ hiện một dòng "Chưa có đơn đang mở".

Đơn đang chọn:
- [x] Không chọn thẻ nào ⇒ giỏ là **đơn mới trống**. Bấm một thẻ ⇒ giỏ sửa đơn đó, thẻ được viền nổi bật.
- [x] **Bỏ chọn** (về đơn mới) như bỏ focus một ô nhập: bấm **vùng trống của dải đơn** (giữa / sau các thẻ, hàng chip), bấm **nút ✕ trên đầu giỏ**,
      hoặc bấm lại chính thẻ đang chọn. Bấm vào thực đơn hoặc giỏ **không** bỏ chọn (đó là đang sửa đơn đó).
- [x] Bấm sang thẻ khác ⇒ chuyển thẳng sang đơn đó.
- [x] Luật rời đơn giữ như nút Quay lại hiện nay: đơn đã lưu còn món ⇒ tự lưu rồi chuyển, không hỏi. Đơn mới chưa lưu đã có món
      (khi chọn thẻ khác hoặc sang màn khác) ⇒ hỏi **"Bỏ thay đổi?"**. Đơn ship không lưu được (thiếu địa chỉ / trả shipper) ⇒ hỏi bỏ thay đổi, như cũ.
- [x] Lưu / ra món đơn mới ⇒ thẻ của đơn đó xuất hiện trong dải (hiệu ứng như hiện nay), giỏ về đơn mới trống.
      Thanh toán / xóa xong ⇒ toast, giỏ về đơn mới trống.
- [x] Điện thoại: chọn thẻ ⇒ giỏ **tự mở rộng**; đơn mới giữ giỏ thu gọn.

Thanh toán trong giỏ:
- [x] Nút chính **"Thu đủ tiền mặt"** giữ nguyên (1 chạm).
- [x] Nút "Thanh toán…" thay bằng hàng **TM · CK · Ghi nợ** trong giỏ. Bấm ⇒ mở ngay trong giỏ đúng phần của màn thanh toán cũ:
      TM: nút mệnh giá "Khách đưa" + nhập tay (`MoneyInput`) + tiền thối + xác nhận. CK: nút xác nhận đã nhận. Ghi nợ: **sheet** đè lên giỏ
      (tên + gợi ý khách, mô tả, SĐT, xác nhận).
- [x] Dòng "Phí ship" / "Phụ thu" và "Trả shipper −10.000 (lấy từ két)" hiện trong giỏ như màn thanh toán cũ.
- [x] Bỏ màn thanh toán riêng (`/order/:id/pay`).

Thông báo:
- [x] Sự kiện một lần ⇒ **toast**: đã thanh toán, đã xóa, đơn đã thanh toán / xóa ở máy khác, in lỗi.
- [x] Trạng thái kéo dài không dùng toast: máy in chưa kết nối ⇒ icon nhỏ trên header, bấm mở chi tiết + "Kết nối lại".
      Mất kết nối ⇒ vẫn **dải đỏ mỏng** (SPEC 7 bắt buộc).

Mặc định của plan (đổi thì báo):
- [x] Điểm bán, combo, món, topping, Tại chỗ / Mang về / Ship, nhãn, hết món: giữ nguyên cách làm, chỉ đặt lại trong bố cục mới.
- [x] Không đổi dữ liệu, migration, `sync_push`, RLS. Toàn bộ là **cửa hai chiều**.
      Khóa `kitchen.queue_no` trong `print_template` (jsonb) của các mẫu đã lưu cứ để yên, client bỏ qua; không cần migration.

## Không làm

- Thu sidebar thành cột icon (để plan sau, cho tablet hẹp hơn 1280).
- Ảnh món, nút −/+ trên thẻ món.
- Chức năng mới: chia thanh toán, giảm giá, quét QR, in bill tạm từ giỏ, lọc theo điểm bán / tìm đơn trong dải…
- Đổi giao diện chế độ chủ.

## Ticket 1 — Figma (đứng đầu, chặn mọi ticket khác)

File laodai UI, trang Tablet: tiêu đề y=31200, S1–S20 tablet (236:4–236:23) từ y=31360, P1–P14 điện thoại (236:8529–236:8542) từ y=36240.
Dựng từ route tạm `/__preview/sales?s=…` (`src/dev/SalesPreview.tsx`, xóa khi chủ duyệt). Vẽ cả **tablet 1280×800** và **điện thoại 390×844**, dùng kit Makaryo như các màn hiện có.

- [x] Đơn mới trống (dải có đơn / dải trống).
- [x] Đang gọi món đơn mới (giỏ có món, có topping, có ship + phí / shipper ngoài).
- [x] Đang chọn đơn chờ ra món; đang chọn đơn chờ thanh toán (thẻ viền nổi bật, nút ✕ đầu giỏ, nút in lại phiếu bếp).
- [x] Chip lọc ở ba trạng thái; thẻ vàng / đỏ; badge ship.
- [x] Giỏ mở TM (mệnh giá + nhập tay + tiền thối), CK, sheet Ghi nợ.
- [x] Hộp "Bỏ thay đổi?", hộp xóa đơn (lý do).
- [x] Toast (đã thanh toán, đơn đổi ở máy khác, in lỗi); icon máy in + chi tiết; dải mất kết nối.
- [x] Điện thoại: giỏ thu gọn / mở rộng, menu ☰.
- [x] Chủ duyệt.

## Ticket 2 — Khung màn Bán hàng + dải đơn

- [x] Route `/` thành màn Bán hàng khi có ca (đơn đang chọn nằm trên URL, vd. `/?order=<id>`, để realtime / reload giữ đúng đơn).
      Bỏ `/order/new`, `/order/:id` (chuyển hướng về `/`, `/?order=<id>`).
- [x] Sidebar: mục "Bán hàng" thay "Hàng đợi" + "Đơn mới". Màn Bán hàng có sidebar trên tablet.
- [x] Component dải đơn: chip + số đếm, thẻ mới (bỏ số thứ tự, tóm tắt, nút ra món), thứ tự theo quyết định, viền thẻ đang chọn,
      bấm vùng trống / bấm lại thẻ ⇒ bỏ chọn. Giữ `useQueueMotion` cho hiệu ứng xuất hiện.
- [x] Ghép thực đơn + giỏ của `OrderScreen` vào cột giữa / cột phải; nút ✕ đầu giỏ; luật rời đơn (tự lưu / "Bỏ thay đổi?").
- [x] Sau lưu / ra món đơn mới ⇒ giỏ về đơn mới trống.
- [x] Đơn đang chọn bị thanh toán / xóa ở máy khác ⇒ toast + về đơn mới trống (tạm dùng thông báo nổi `queue-flash`; toast thật ở ticket 4).

Ghi chú khi làm: `QueueScreen.tsx` → `QueueStrip.tsx` (dải đơn), `OrderScreen.tsx` → `OrderEditor.tsx` (thực đơn + giỏ, dựng lại khi đổi đơn đang chọn),
màn mới `SalesScreen.tsx`; route preview tạm `/__preview/sales` đã xóa. Điện thoại đã có nút ☰ cơ bản (thanh đáy cũ không còn chỗ vì giỏ ở đáy);
ticket 4 hoàn thiện phần điện thoại. `PrintBar` tạm nằm dưới dải đơn tới ticket 4. Nút "Thanh toán…" vẫn mở `/order/:id/pay` tới ticket 3 (đã xong).
Test component đã sửa cho màn mới và thêm test bỏ chọn / "Bỏ thay đổi?"; Cypress để ticket 6.

## Ticket 3 — Thanh toán trong giỏ

- [x] Tách phần TM / CK / Ghi nợ của `PayScreen` thành component dùng trong giỏ; Ghi nợ là sheet.
- [x] Hàng TM · CK · Ghi nợ thay nút "Thanh toán…"; "Thu đủ tiền mặt" giữ nguyên.
- [x] Bỏ route + màn `PayScreen`.

Ghi chú khi làm: `src/tablet/CartPay.tsx` (`CartPay` = nút "‹ Giỏ" + "Cần thu" + hàng TM · CK · Ghi nợ + phần TM / CK; `DebtSheet` đè lên cột giỏ).
Bấm TM / CK / Ghi nợ trong giỏ ⇒ lưu đơn trước (đơn mới ⇒ tạo đơn) rồi mở phần thanh toán; "‹ Giỏ" ⇒ sửa tiếp đơn đó.
Đóng sheet Ghi nợ ⇒ về hình thức đang mở trước đó, hoặc về giỏ nếu mở thẳng từ giỏ. `/order/:id/pay` chuyển hướng như `/order/:id`.
Bỏ state điều hướng `SalesFlash` / `initialPaid` (không còn màn nào điều hướng về kèm thông báo).
Cypress: đã đổi test id (`order-pay-cash|transfer|debt`, `cart-pay`); kiểm tra bố cục nút trên điện thoại (C, dòng "Ba nút dưới cùng nằm trên một hàng") để ticket 6.

## Ticket 4 — Toast, máy in, menu điện thoại

- [x] Component toast dùng chung; chuyển các thông báo một lần sang toast (bỏ dải "Đã thanh toán", flash của hàng đợi).
- [x] `PrintBar` thành icon trên header + chi tiết; in lỗi ⇒ toast.
- [x] Điện thoại: dải thẻ nhỏ, chọn thẻ ⇒ giỏ mở rộng, menu ☰ thay thanh đáy.

Ghi chú khi làm: `src/tablet/Toast.tsx` (`ToastHost` bọc cả `TabletHome`, `useToast()`; testid `toast`): viên tối (in lỗi: viên đỏ đậm có "In lại"),
không nút ✕, tự ẩn sau 4 giây (in lỗi 10 giây ⇒ `dismissFailure`); tablet giữa cột thực đơn ở y=78, điện thoại ngay dưới header (S16–S18, P11).
`PrintBar.tsx` → `PrinterStatus.tsx`: `PrinterButton` = nút 44px, tablet ở cuối hàng chip của dải đơn, điện thoại trên header; chưa sẵn sàng ⇒ vàng + chấm;
bấm ⇒ ô chi tiết 320px ngay dưới nút (`printer-detail`, "Kết nối lại") (S19, P13). `OrderDone.flash` → `toast: { text, tone }`.
Điện thoại: ☰ mở bảng có đầu "Ca của …" (giờ mở · quầy · phiên bản) + Thu nợ · Chi tiền · Đóng ca · Chế độ chủ (P10); chip ca trên header chỉ còn tên.
Dải thẻ nhỏ và giỏ tự mở khi chọn thẻ đã có từ ticket 2. Đã so số đo với Figma qua trình duyệt (S18, S19, P10, P13 khớp, lệch ≤ 4px).
Test: `queue-flash` → `toast` (unit + Cypress); `printer-reconnect` giờ phải bấm `printer-status` trước (unit đã sửa; Cypress I chỉ đọc `data-state`).

## Ticket 5 — Bỏ số thứ tự trên phiếu bếp

Không phụ thuộc Figma màn Bán hàng (chỉ bớt một dòng trên phiếu và một công tắc), làm được song song.

- [x] `src/print/layout.ts`: bỏ dòng "Số N" và tham số `queueNo`; `src/print/service.ts`: bỏ `queueNo` / `setQueueNo` và chỗ gọi.
- [x] `src/print/types.ts`: bỏ `kitchen.queue_no` khỏi kiểu và mẫu mặc định (mẫu cũ còn khóa này thì bỏ qua).
- [x] `src/owner/settings/PrintTemplatePage.tsx`: bỏ công tắc "Số thứ tự hàng đợi".
- [x] `src/domain/queue.ts`: bỏ `position` (không còn ai dùng).
- [x] Sửa `print.test.ts`, `service.test.ts`, `queue.test.ts`; Cypress mẫu in (M) nếu có bấm công tắc này.

Ghi chú khi làm: `normalizeTemplate` chỉ giữ các khóa `kitchen` có trong mẫu mặc định (`pickKnown`) ⇒ mẫu cũ còn `queue_no` không hiện, lưu lại thì mất khóa;
mặc định SQL trong migration `20261120000002_printing.sql` vẫn còn `queue_no` (để yên, không migration). Cypress M đổi sang bấm `tpl-kitchen-time`.
Cypress C14 / C15 (`c-sales.cy.ts`) còn đọc `data-position` (thẻ đã bỏ từ ticket 2): sửa ở ticket 6.

## Ticket 6 — Test

- [ ] Sửa `TabletFlow.test.tsx`, `TabletPrint.test.tsx`, `SoldOut.test.tsx` theo màn mới.
- [ ] Unit: thứ tự thẻ ở ba chip; luật bỏ chọn (vùng trống, ✕, bấm lại thẻ; bấm thực đơn không bỏ chọn).
- [ ] Cypress (SPEC 10.4): sửa B/C theo màn mới (14, 15, 29); thêm: chọn thẻ ⇒ sửa đơn, đổi thẻ khi đơn mới chưa lưu ⇒ "Bỏ thay đổi?",
      thanh toán TM / CK / Ghi nợ trong giỏ, combo + "Thu đủ" ≤ 3 chạm từ màn Bán hàng. Chạy cả 1280 và 390.
- [ ] `npm run check` + `npm run test:e2e`.

## Tiêu chí xong

- Không còn màn Hàng đợi, màn Đơn, màn Thanh toán riêng trên tablet và điện thoại; mọi thao tác cũ làm được từ màn Bán hàng.
- Không đổi dữ liệu / server; mọi test cũ (đã sửa theo màn mới) và test mới pass.
- Giao diện khớp Figma đã duyệt.
