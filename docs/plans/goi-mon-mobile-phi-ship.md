# Plan: Gọi món trên điện thoại (rộng, dễ bấm) + phí ship

Thiết kế: Figma trang **Makaryo – Mobile (390×844)**, hai frame
[MS1 — gọi món Ship](https://www.figma.com/design/4pn7uPIndfCso8R6LA9Hj0/Laodai-POS-%E2%80%93-UI-hi%E1%BB%87n-t%E1%BA%A1i?node-id=77-6) và
[MS2 — nhập địa chỉ](https://www.figma.com/design/4pn7uPIndfCso8R6LA9Hj0/Laodai-POS-%E2%80%93-UI-hi%E1%BB%87n-t%E1%BA%A1i?node-id=77-123) (21/11).
File này là danh sách việc. Làm xong mục nào thì đánh dấu `[x]`. Đổi thiết kế thì sửa SPEC trước, rồi mới sửa plan.

Vấn đề hiện tại (ảnh chụp 21/11): chọn Ship là ô khách tự focus ⇒ bàn phím che hết thực đơn; giỏ + nút chiếm
quá nửa màn; thẻ món nhỏ, phải cuộn mới bấm được; chưa có phí ship.

## Quyết định

Đã chốt theo Figma:
- [x] Phí ship là **một hàng 4 nút**: +5k, +10k, +15k, +20k. Bấm lại mức đang chọn ⇒ bỏ phí (phí = 0). Không bắt buộc chọn.
- [x] Phí ship **cộng vào tổng đơn**: 15.000 món + 10.000 phí ⇒ "Thu đủ 25.000". Thanh toán, ghi nợ, tiền thối đều theo tổng này.
- [x] Chọn Ship **không mở bàn phím**. Địa chỉ + khách chỉ nhập trong bảng MS2, mở khi bấm dòng "Địa chỉ, khách — bấm để nhập".
- [x] Địa chỉ vẫn bắt buộc với đơn ship; khách vẫn tùy chọn (giữ luật hiện tại).
- [x] Tại chỗ / Mang về: ẩn hàng phí và dòng địa chỉ. Đổi từ Ship sang loại khác ⇒ phí về 0 (như địa chỉ hiện nay).

Chủ đã chốt (21/11):
- [x] Phí ship **tính vào doanh thu và tiền mặt kỳ vọng** của ca (khách trả, tiền nằm trong két).
      Báo cáo ca / báo cáo ngày tách dòng "trong đó phí ship".
- [x] **Tablet (md+) cũng có hàng phí ship**, cùng 4 mức trong cột giỏ; ô địa chỉ / khách trên tablet giữ inline.
- [x] **Ô "Nhãn / số bàn" trên điện thoại** chuyển vào phần giỏ mở rộng (bấm dòng tóm tắt).
- [x] **Combo trên điện thoại giữ lưới như hiện tại**; điểm bán có combo thì chấp nhận cuộn.

Mặc định của plan (đổi thì báo):
- [x] Server chỉ nhận phí: `0 ≤ phí ≤ 50.000`, bội số 1.000, và chỉ đơn ship. Bốn mức nằm ở client (đổi mức không cần migration).
- [x] Chủ sửa đơn đã thanh toán (4.7): **giữ nguyên phí ship**, chưa cho sửa phí (để sau nếu cần).

## Các bước

Mỗi bước chỉ xong khi test của bước đó pass (SPEC mục 10).

### 0. SPEC
- [x] 4.2: thêm Ship + phí ship (4 mức, bấm lại để bỏ), luồng nhập địa chỉ trên điện thoại (MS2), không tự mở bàn phím.
- [x] 4.4 / 5: tổng đơn = tiền món + phí ship; doanh thu và tiền mặt kỳ vọng tính cả phí, báo cáo tách "trong đó phí ship".
- [x] 12.4: bill có dòng "Phí ship" trước "TỔNG" (chỉ khi phí > 0).
- [x] 6: tin Telegram đơn ship có phí ship.

### 1. Dữ liệu (Supabase) — migration `20261121000001_ship_fee.sql`
- [x] `orders.ship_fee int not null default 0`, check `ship_fee >= 0 and ship_fee <= 50000 and ship_fee % 1000 = 0`
      và `dine_type = 'delivery' or ship_fee = 0`.
- [x] `private.order_ship_fee(p jsonb)`: đọc + kiểm phí (lỗi `bad_ship_fee`), trả 0 nếu không phải đơn ship.
- [x] `op_create_order`, `op_update_order` (bản mới nhất ở `20261119000001_delivery_customer.sql`): ghi `ship_fee`,
      đổi kiểm tổng thành `v_calc + v_fee <> v_total ⇒ total_mismatch`.
- [x] `owner_edit_order`: sửa món ⇒ `v_total := write_items(...) + o.ship_fee` (hiện tại sẽ làm mất phí).
- [x] `op_pay_order`: không đổi (đã so với `o.total`).
- [x] `print_doc`: thêm `ship_fee` (và `address` nếu muốn in trên bill). — làm: chỉ thêm `ship_fee` (bill chưa in địa chỉ).
- [x] `order_json` tự có `ship_fee` (dùng `to_jsonb(o)`) ⇒ audit + Telegram có sẵn, chỉ cần kiểm.
- [x] Báo cáo: `reconcile_shift` / RPC báo cáo thêm tổng `ship_fee` (doanh thu và tiền mặt kỳ vọng vẫn theo `orders.total`).
- [x] Tương thích ngược: client cũ không gửi `ship_fee` ⇒ 0, tổng vẫn khớp. Áp migration trước khi đẩy frontend.
- [x] `supabase/seed.sql`: một đơn ship có phí. — bỏ: `seed.sql` không có đơn nào (chỉ danh mục); đơn có phí nằm trong fixture đối soát `ship-co-phi`.
- [x] Test DB: tổng có phí khớp / lệch; phí sai (7.500, 60.000, âm) bị từ chối; đơn mang về có phí bị từ chối;
      chủ sửa món giữ phí; đối soát tiền mặt tính đúng. — đổi: đơn mang về gửi kèm phí **không bị từ chối** mà phí bị bỏ
      (lưu 0), giống cách bỏ địa chỉ.

### 2. Domain (`src/domain/`, hàm thuần)
- [x] `types.ts`: `Order.ship_fee: Money`.
- [x] Hằng `SHIP_FEES = [5000, 10000, 15000, 20000]`.
- [x] `cart.ts`: `CartDraft.ship_fee`; `draftShipFee(d)` (0 nếu không phải ship); `toggleShipFee(d, fee)` (bấm lại ⇒ 0);
      `draftTotal` = tiền món + phí; `draftChanged` so cả phí; `newDraft` phí = 0.
- [x] `pricing.ts`: giữ `orderTotal(items)` là tiền món; thêm hàm tổng đơn có phí để mọi nơi dùng chung.
- [x] `ownerEdit.ts`: `after` cộng `original.ship_fee`.
- [x] `audit.ts`: dòng "Phí ship: 10.000 → 15.000" khi đổi phí.
- [x] Unit test cho từng hàm trên.

### 3. Lớp POS (`src/pos/`) + server giả
- [x] `ops.ts` `createOrder` / `updateOrder`: gửi `ship_fee`, `total` có phí; `OrderDraft` thêm `ship_fee`.
- [x] `backend.ts`, `src/owner/orders/api.ts`, `src/owner/debts/api.ts`: map cột `ship_fee`. — `debts/api.ts` không cần (sổ nợ chỉ dùng `total`).
- [x] `src/test-utils/fakeServer.ts`: kiểm tổng có phí, kiểm phí như server.

### 4. Màn gọi món trên điện thoại — MS1 (`OrderScreen.tsx`, dưới `md`)
Số đo theo Figma (khung 390×844):
- [x] Đầu màn 56px: "Hàng đợi" bên trái, "Đơn mới / Chưa lưu" bên phải (gần như hiện tại).
- [x] Tab điểm bán cao 52px, hai cột.
- [x] Thẻ món điện thoại **cao 140px**, bỏ ô minh họa (tablet giữ), tên 18px đậm, nhãn điểm bán + giá ở đáy thẻ.
      Bốn món (2×2) vừa màn, không cuộn.
- [x] **Số lượng trong giỏ** trên góc phải thẻ (chấm cam, vd "1") — `MenuBoard` / `Tile` nhận thêm số lượng theo món.
- [x] Nút "Báo hết món" trên điện thoại thu thành nút nhỏ cạnh tiêu đề "Món" để không đẩy lưới xuống.
- [x] Giỏ (dock, bo góc trên 24px):
  - [x] Dòng tóm tắt 56px: túi + số món, "Ship · 1× Xôi xéo", dòng phụ "15.000 + phí 10.000", tổng bên phải.
        Bấm ⇒ mở chi tiết giỏ (dòng món, +/−, đổi món, ô nhãn) như hiện tại.
  - [x] Tại chỗ / Mang về / Ship: segment 48px. — làm: 40px trên điện thoại (44px tablet) để đủ chỗ cho 4 thẻ món khi giỏ mở hàng phí.
  - [x] Chỉ khi Ship: tiêu đề "Phí ship" + 4 nút 52px (`aria-pressed`, nút đang chọn viền cam nền cam nhạt).
  - [x] Chỉ khi Ship: dòng 44px "Địa chỉ, khách — bấm để nhập". Đã nhập ⇒ hiện địa chỉ (+ tên khách).
        Thiếu địa chỉ ⇒ chữ đỏ "Thiếu địa chỉ ship" (thay cho dòng phụ đỏ hiện ở tóm tắt).
  - [x] Bỏ `autoFocus` của ô khách / ô địa chỉ trên điện thoại.
  - [x] "Thu đủ 25.000" 52px.
  - [x] Ba nút một hàng 44px, biểu tượng **cạnh** chữ, đủ chữ: Thanh toán, Đã ra món, Tạo đơn (thay `ACTION_BTN` xếp dọc).
        Đơn đã lưu: Tạo đơn → Xóa đơn như hiện tại.

### 5. Bảng nhập địa chỉ — MS2 (component mới `src/tablet/ShipSheet.tsx`)
- [x] Bảng từ dưới lên, nền mờ phía sau; tiêu đề "Giao hàng", nút X; dòng "Phí đang chọn +10.000 · tổng 25.000".
- [x] "Địa chỉ giao" (bắt buộc, tự focus — bàn phím chỉ mở ở bước này), dưới là "Khách (tuỳ chọn)" dùng lại
      `ShipCustomerPicker` (gợi ý khách, thêm khách mới, chọn khách ⇒ điền sẵn địa chỉ).
- [x] Nút "Xong" 52px: đóng bàn phím, về MS1, món và phí giữ nguyên. Chưa có địa chỉ ⇒ Xong bị khóa; X vẫn đóng được.
- [x] Đang mở bảng ⇒ tạm dừng tự lưu (`typingAddress`), bấm Xong mới lưu ⇒ một tin Telegram cho mỗi lần đổi địa chỉ.
- [x] Nút Back Android đóng bảng (`NativeBackButton`).
- [x] Bàn phím không che ô nhập: kiểm `interactive-widget=resizes-content` trong `index.html` và `adjustResize`
      của Activity Android; bảng bám theo `visualViewport` nếu cần.

### 6. Tablet (md+)
- [x] Cột giỏ: thêm hàng phí ship dưới segment khi Ship. Ô khách / địa chỉ giữ inline.
- [x] Khối tổng: thêm dòng "Phí ship" khi phí > 0, "Tổng" có phí.

### 7. Phí ship ở các màn / kênh khác
- [x] `PayScreen.tsx`: dưới tổng ghi "Món 15.000 + phí ship 10.000"; nút tiền nhanh theo tổng có phí. — làm: dòng "Phí ship" riêng dưới danh sách món, "Cần thu" là tổng có phí.
- [x] `QueueScreen.tsx`: thẻ đơn ship ghi "+10k ship" cạnh tổng.
- [x] Chủ: `OrderDetail.tsx` dòng "Phí ship"; báo cáo ca / ngày dòng "trong đó phí ship".
- [x] Bill (`src/print/layout.ts`): dòng "Phí ship" trước "TỔNG"; phiếu bếp không đổi (không có giá).
- [x] Telegram (`supabase/functions/_shared/format.ts`, `delivery_order`): "Phí ship 10.000 · Tổng 25.000". — làm: dòng "Phí ship: 10.000" ngay trên "Tổng"; báo cáo ca có "Trong đó phí ship".

### 8. Test
- [x] RTL (`TabletFlow.test.tsx`): chọn Ship không có ô nào được focus; bấm +10k ⇒ tổng 25.000, bấm lại ⇒ 15.000;
      mở MS2 nhập địa chỉ ⇒ Xong ⇒ `create_order` có `ship_fee: 10000, total: 25000`; Thu đủ gửi `cash_given: 25000`;
      đổi sang Mang về ⇒ ẩn hàng phí, phí 0; đơn ship cũ (phí 0) mở lại không bị coi là đã sửa.
- [x] Snapshot bill + tin Telegram có phí.
- [ ] Cypress viewport 390×844: 4 thẻ món nằm trọn trong màn khi giỏ thu gọn; chọn Ship không mở bàn phím
      (`document.activeElement` là body); luồng đầy đủ tạo đơn ship có phí rồi thu tiền. — đã có C18 (Ship không focus ô
      nào, phí cộng / bỏ, 3 nút một hàng, bảng MS2, server + Telegram); **chưa** đo 4 thẻ món nằm trọn màn.
- [ ] Thử trên điện thoại Android thật (Chrome PWA + app Capacitor): bàn phím, nút Back, máy màn thấp (~720px).

## Rủi ro / cần kiểm tra sớm
- Điện thoại màn thấp hơn 844px: dock ~388px + đầu màn + tab ⇒ có thể chỉ vừa 1 hàng món. Đo trên máy thật của quán.
- Bàn phím Android trong WebView Capacitor: bảng MS2 có thể bị che nếu Activity không `adjustResize`.
- Thứ tự deploy: migration trước, frontend sau (client cũ vẫn chạy vì phí mặc định 0).
