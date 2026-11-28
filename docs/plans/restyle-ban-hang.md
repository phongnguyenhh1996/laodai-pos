# Plan: Restyle màn Bán hàng theo Makaryo

Màn Bán hàng (đã gộp Hàng đợi và Đơn, xem [gop-hang-doi-va-don.md](gop-hang-doi-va-don.md)) chạy đúng nhưng nhìn chưa giống kit Makaryo
và chế độ chủ đã làm lại. Thuật ngữ: Bán hàng, Hàng đợi (dải đơn), Đơn đang chọn (`docs/glossary.md`).
File này là danh sách việc. Làm xong mục nào thì đánh dấu `[x]`.

## Mục tiêu

Đổi **giao diện** màn Bán hàng (tablet + điện thoại) cho cùng một ngôn ngữ với chế độ chủ: nền xám, thẻ trắng viền mảnh,
tiêu đề khu vực có số đếm, chip lọc dạng segmented, thẻ đơn / thẻ món / dòng giỏ có ô icon, phần tóm tắt giỏ dạng sheet,
ô "Hình thức thanh toán", nút chính màu cam.

## Phạm vi

- Mọi trạng thái của màn Bán hàng: dải đơn, thực đơn, giỏ, thanh toán trong giỏ (TM / CK / Ghi nợ), hộp thoại, toast,
  máy in, mất kết nối, menu ☰ điện thoại.
- Sidebar tablet khi ở màn Bán hàng.
- Cửa hai chiều: chỉ đổi UI, không đổi dữ liệu, RLS, `sync_push`, luật đơn.

## Không làm

- Thêm / bớt chức năng, đổi luồng bấm (số chạm "Thu đủ tiền mặt" giữ 1 chạm).
- Ảnh món thật (ô ảnh chỉ là icon), tìm kiếm món / đơn.
- Các màn khác của nhân viên (Mở ca, Thu nợ, Chi tiền, Đóng ca).

## Thay đổi giao diện đáng chú ý (chủ đã thấy trong Figma)

- Nút chính màu cam: "Thu đủ tiền mặt" (trước xanh lá), "Đã thu tiền", "Đã nhận chuyển khoản", "Ghi nợ …" (trước đỏ).
  "Đã ra món" thành nút viền trắng (trước nền đen).
- "Chờ thanh toán" màu xanh dương (như màn Đơn của chủ); màu chờ (vàng ≥ 5′, đỏ ≥ 10′) chỉ ở đồng hồ, viền thẻ không đổi màu.
- Thẻ đơn: ô icon loại đơn tô theo trạng thái, dòng "3 món • Bàn 3"; đơn ship chỉ ghi "N món" + badge ship.
- Combo chỉ tô ô ảnh, không tô cả thẻ. Topping là dòng phụ dưới tên món trong giỏ.
- Hộp thoại tablet căn giữa màn; điện thoại: Ghi nợ, Bỏ thay đổi, menu ☰ là sheet trồi từ đáy.
- Điện thoại: khi chọn đơn, nút in lại phiếu bếp lên đầu sheet cạnh ✕ (bỏ nút "In lại phiếu bếp" riêng).

## Ticket 1 — Figma (đứng đầu, chặn mọi ticket khác)

File laodai UI, trang Tablet: tiêu đề y=38400. Tablet BH1–BH19 (1280×800) từ y=38560, 4 khung / hàng.
Điện thoại BHP1–BHP13 (390×844) từ y=43440, 7 khung / hàng.

- [x] Đợt 1 duyệt hướng (BH1–BH4, BHP1–BHP2). Chủ OK 28/11.
- [x] Đủ trạng thái: dải trống, ship quán giao / shipper ngoài, chọn đơn chờ ra món, chip lọc, TM chưa nhập (shipper ngoài),
      CK, sheet Ghi nợ, Bỏ thay đổi?, Xóa đơn, 3 toast, chi tiết máy in, mất kết nối; điện thoại tương ứng + menu ☰.
- [x] Chủ duyệt bản cuối (28/11).

## Luật chung cho các ticket code

- Mỗi ticket một phiên, làm theo thứ tự (T3–T8 đều đụng `OrderEditor.tsx` / `QueueStrip.tsx`, không chạy song song).
- **Giữ nguyên mọi `data-testid`, `data-*`, `aria-*`** và hành vi; chỉ đổi class / cấu trúc hiển thị. Test hỏng vì đổi DOM ⇒ sửa selector, không sửa ý.
- So số đo với khung Figma (Browser pane, `getBoundingClientRect` so với dump khung, lệch ≤ 4px), xong thì gắn badge DONE lên khung.
- Chưa có khung nên **chỉ nhận màu / nút chung, không đổi bố cục**: sheet topping (`ToppingSheet`), chế độ "Báo hết món",
  ô chọn khách khi ship (`ShipCustomerPicker`), `ShipSheet` (điện thoại). Muốn làm lại sâu ⇒ vẽ Figma trước.
- Sidebar và `Sheet` trong `parts.tsx` dùng chung với Thu nợ / Chi tiền / Đóng ca: các màn đó đổi theo là đúng ý, nhưng phải xem lại bằng mắt.
- Mỗi ticket: `npm run check`; ticket đụng luồng bấm thì chạy thêm Cypress `c-sales`, `d-debt`, `i-print`, `k-sold-out` liên quan.

## Ticket 2 — Thành phần dùng chung

- [x] Gom primitive kiểu Makaryo cho màn nhân viên, ưu tiên dùng lại `src/owner/ui.tsx` (`TONE`, `IconTile`, `BTN`), thêm cái còn thiếu:
      badge nhỏ theo tone, segmented có icon + số đếm (nút đang chọn nền trắng, đổ bóng nhẹ), ô "Hình thức thanh toán"
      (dọc: ô icon + nhãn dưới; ngang: icon + nhãn trong ô, cho điện thoại), tay nắm sheet, ô ảnh món (nền xám, icon).
- [x] Nút: chính = cam (`brand`), phụ = viền trắng, xóa = đỏ nhạt (`danger` mềm), tắt = xám. Bỏ nút xanh lá / nền đen ở màn Bán hàng.
- [x] Không đổi màn nào ở ticket này (chỉ thêm + unit test nhỏ nếu có logic).

Đã có ở [src/app/kit.tsx](../../src/app/kit.tsx) (`owner/ui.tsx` re-export `card`, `TONE`, `IconTile` từ đây): `Badge`, `AreaTitle`
(tiêu đề + số đếm), `Segmented` (`stretch` chia đều / chip lọc có chấm + số đếm), `PayMethodTile` (+ `PAY_METHOD_LOOK`), `SheetHandle`,
`ItemThumb`, `staffBtn(kind, size)` (primary / secondary / danger / dangerSolid, cỡ md 45 / lg 50, tắt = xám), `iconBtn()` (40 / 36).

## Ticket 3 — Sidebar tablet + dải đơn

Khung: BH1, BH5, BH9 (tablet); BHP1, BHP3, BHP5 (điện thoại).

- [ ] Sidebar (`TabletHome.tsx`): logo 40 + tên quầy, thẻ "Ca đang mở" (avatar chữ cái), mục đang chọn nền cam, chân: ô "Chế độ chủ" có ô icon, badge "Đã kết nối" / "Mất kết nối".
- [ ] `QueueStrip.tsx`: tiêu đề "Đơn đang mở (N đơn)" + segmented lọc + nút máy in bên phải (tablet); điện thoại chỉ segmented.
- [ ] Thẻ đơn tablet 212: ô icon loại đơn tô theo nhóm (vàng chờ ra món / xanh dương chờ thanh toán), `#mã`, đồng hồ chờ màu theo `card.color`;
      dòng "N món • nhãn" (đơn ship: "N món" + badge ship); badge trạng thái + tổng `formatK`. Thẻ luôn trắng, đang chọn viền cam 2px.
- [ ] Thẻ nhỏ điện thoại 150: chấm nhóm + mã + nhãn, đồng hồ + icon xe, tổng.
- [ ] Dải trống: khung viền đứt + "Chưa có đơn đang mở".
- [ ] `PrinterButton`: chưa sẵn sàng ⇒ nền vàng nhạt, viền vàng, chấm vàng góc.

## Ticket 4 — Thực đơn

Khung: BH1 (có món hết), BH2; BHP1.

- [ ] `MenuBoard.tsx`: tablet có tiêu đề "Thực đơn (N món)" + nút "Báo hết món" bên phải; điện thoại nút này ở dòng "Combo".
- [ ] Ô điểm bán kiểu danh mục Makaryo (tròn icon, đang chọn nền cam nhạt + viền cam). Tiêu đề nhóm "Combo (2)", "Món (4)".
- [ ] Thẻ món: ô ảnh 64 (combo nền cam nhạt + icon cam, món nền xám), tên 14, badge (Combo / điểm bán) + giá. Hết món: mờ, badge "Hết", giá gạch.

## Ticket 5 — Giỏ tablet + phần tóm tắt

Khung: BH1, BH2, BH3, BH6, BH7, BH8.

- [ ] Đầu giỏ: ô icon 44, "Đơn mới" / "Đơn #mã", dòng phụ "Chưa lưu" hoặc badge "Đã lưu" + trạng thái; nút in lại + ✕ khi đang chọn đơn.
- [ ] Segmented Tại chỗ / Mang về / Ship; khi Ship: segmented Quán giao / Shipper ngoài, hàng chip "Phí ship" / "Phụ thu" / "Trả shipper (tiền két)" có nhãn bên trái, ô địa chỉ, ô nhãn.
- [ ] Dòng món: ô ảnh 52, tên, topping là dòng phụ xám, thành tiền cam đậm, nút −/+ 36 nền xám.
- [ ] Giỏ trống: vòng tròn icon túi + "Chưa có món".
- [ ] Tóm tắt dạng sheet bo góc trên + tay nắm + đổ bóng lên: Số món, phí / phụ thu, Tổng 24, dòng đỏ "Trả shipper (lấy từ két)", kẻ,
      "Hình thức thanh toán" + 3 ô dọc, nút cam "Thu đủ tiền mặt · X", hàng nút phụ (Đã ra món / Tạo đơn hoặc Xóa đơn).
- [ ] Vùng loại đơn + món cuộn chung khi Ship làm cột chật (BH7).

## Ticket 6 — Thanh toán trong giỏ

Khung: BH4, BH10, BH11, BH12; BHP6, BHP7, BHP8.

- [ ] `CartPay.tsx`: nền xám, nút "‹ Giỏ" + "Đơn #mã · N món"; thẻ "Cần thu" (Tiền món, phụ thu, kẻ, Cần thu 26 cam, dòng trả shipper);
      thẻ "Hình thức thanh toán" (tablet ô dọc trong thẻ, điện thoại ô ngang không thẻ).
- [ ] TM: thẻ "Khách đưa" lưới 3 cột, `MoneyInput` là ô cuối của lưới; "Tiền thối" xanh lá khi đủ, xám "—" khi chưa; nút cam "Đã thu tiền" (tắt khi chưa đủ).
- [ ] CK: ghi chú xanh dương + nút "Đã nhận chuyển khoản". Ghi nợ: `DebtSheet` kiểu sheet (ô icon vàng, gợi ý khách trong thẻ, khối "khách mới" nền xám), nút cam "Ghi nợ X".

## Ticket 7 — Hộp thoại, toast, máy in, mất kết nối

Khung: BH13–BH19; BHP10–BHP13.

- [ ] `Sheet` (`parts.tsx`): tablet hộp 420–440 bo 20, đổ bóng; điện thoại sheet bo 24 + tay nắm. "Bỏ thay đổi?" (Ở lại / Bỏ thay đổi đỏ), "Xóa đơn #mã?" (ô icon đỏ, 4 lý do đỏ nhạt 2×2, Không xóa).
- [ ] `Toast.tsx`: viên tối bo 14 + icon (đã thu: dấu tích xanh lá, máy khác: info xám); in lỗi: đỏ đậm + nút trắng "In lại".
- [ ] `PrinterStatus.tsx`: ô chi tiết 320 (điện thoại 358) bo 16, ô icon vàng, "Kết nối lại" nút viền.
- [ ] Dải mất kết nối đỏ nhạt (tablet trên cột giữa + giỏ; điện thoại dưới header), header điện thoại đổi icon kết nối sang wifi-off đỏ.

## Ticket 8 — Điện thoại

Khung: BHP1, BHP2, BHP4, BHP9.

- [ ] Header trắng: logo 36, tên quầy, badge tên nhân viên, nút kết nối / máy in / ☰ 40.
- [ ] Giỏ là sheet bo 24: hàng tóm tắt (ô túi + số món, tiêu đề, tổng, mũi tên hoặc in lại + ✕ khi đang chọn đơn), segmented loại đơn,
      nút cam "Thu đủ tiền mặt", 3 ô ngang TM / CK / Ghi nợ, hàng nút phụ. Mở rộng: ô nhãn + danh sách món (ô ảnh 44).
- [ ] Bỏ nút "In lại phiếu bếp" riêng trong giỏ mở rộng (đã lên đầu sheet); giữ test id trên nút mới.
- [ ] Menu ☰: sheet có đầu "Ca của …" (avatar, giờ mở · quầy · phiên bản) + 4 dòng có ô icon và mũi tên.

## Ticket 9 — Rà soát cuối

- [ ] Duyệt lại toàn bộ khung BH1–BH19, BHP1–BHP13 so với app (1280 và 390), gắn badge DONE còn thiếu.
- [ ] Xem bằng mắt các màn dùng chung sidebar / `Sheet` (Thu nợ, Chi tiền, Đóng ca, topping, Báo hết món).
- [ ] `npm run check` + `npm run test:e2e`. Retro: điều gì phải nhắc agent ⇒ test hoặc coding standards.
