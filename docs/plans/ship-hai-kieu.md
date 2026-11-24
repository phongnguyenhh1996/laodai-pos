# Plan: Phí ship hai kiểu (Quán ship / Shipper ngoài)

SPEC: mục 3 (`orders.ship_mode`, `ship_payout`), 4.2, 4.3, 4.4, 4.7, 5 (tiền mặt kỳ vọng + thống kê ship), 6, 7, 12.4.
Thuật ngữ: kiểu ship, shipper ngoài, phụ thu, trả shipper (`docs/glossary.md`).
File này là danh sách việc. Làm xong mục nào thì đánh dấu `[x]`. Đổi thiết kế thì sửa SPEC trước, rồi mới sửa plan.

## Mục tiêu

Hiện app chỉ có **quán ship**: khách trả phí ship, tiền vào két. Thêm **shipper ngoài**: khách trả **phụ thu**
(`ship_fee`, một lần cho cả đơn), quán lấy **tiền mặt từ két** trả shipper (`ship_payout`). Tiền mặt kỳ vọng
của ca phải trừ khoản này để đếm mù cuối ca vẫn khớp, và chủ phải thấy đủ số liệu để chất vấn.

## Quyết định (đã grill 24/11)

- [x] Công tắc **Quán ship / Shipper ngoài** trên đơn ship. Mặc định = đơn ship gần nhất **của ca** (kiểu, phí, mức trả shipper), lấy từ server. Đầu ca: Quán ship, chưa chọn phí.
- [x] Phụ thu: `ship_fee`, 5k/10k/15k/20k hoặc 0, **một lần cho cả đơn**, nằm trong `total`.
- [x] Trả shipper: 5k/10k/15k/20k, **bắt buộc** với shipper ngoài, **không** nằm trong `total`.
- [x] Trả shipper luôn là **tiền mặt từ két**, kể cả khách CK / Nợ. Chỉ tính khi đơn **đã thanh toán**, vào **ca thanh toán**. Đơn xóa ⇒ không có khoản chi.
- [x] Bill: phụ thu in là "Phí ship"; không in kiểu ship / tiền trả shipper. Màn thanh toán nhắc "Trả shipper −10.000 (lấy từ két)".
- [x] Thống kê (chỉ chủ, ca / ngày / tháng): số đơn mỗi kiểu, phí ship, phụ thu ship ngoài, trả shipper ngoài, lãi/lỗ ship ngoài.
- [x] Chống gian lận: Telegram khi tạo đơn ship và khi đổi kiểu / tiền trả shipper; nhật ký trước/sau; danh sách đơn của chủ hiện kiểu ship + tiền trả shipper.
- [x] Chủ sửa đơn đã thanh toán: sửa được kiểu ship, phí, tiền trả shipper; ca đã đóng ⇒ tính lại đối soát.
- [x] Hàng đợi: badge "Ship ngoài · trả 10k".

## Không làm

- Ghi khoản chi shipper cho đơn bị xóa (chủ ghi chú tay lúc đối soát). Làm sau nếu hay xảy ra.
- Mức phụ thu / trả shipper trong Cài đặt của chủ: bốn mức cố định ở client như phí ship hiện tại.
- Phụ thu theo số món; chia tiền trả shipper theo hình thức khác ngoài tiền mặt.
- Thống kê theo điểm bán / theo giờ cho ship.

## Các bước

Mỗi bước chỉ xong khi test của bước đó pass. Thứ tự deploy: **migration trước, frontend sau**.

### 0. SPEC + thuật ngữ
- [x] SPEC mục 3, 4.2, 4.3, 4.4, 4.7, 5, 6, 7, 12.4.
- [x] Glossary: kiểu ship, shipper ngoài, phụ thu, trả shipper.

### 1. Dữ liệu (Supabase): migration `20261124000001_ship_external.sql` — **cửa một chiều**
- [x] `orders.ship_mode text not null default 'shop'` check `in ('shop','external')`;
      `orders.ship_payout int not null default 0`. Check: `ship_mode = 'shop' ⇒ ship_payout = 0`;
      `external ⇒ dine_type = 'delivery' and ship_payout between 1000 and 50000 and ship_payout % 1000 = 0`.
      Đơn cũ: `shop`, `0` (không cần backfill).
- [x] `private.order_ship_mode(p)` / `private.order_ship_payout(p)`: không phải đơn ship ⇒ `shop`, 0;
      `external` mà payout sai / thiếu ⇒ `bad_ship_payout`; `shop` gửi kèm payout ⇒ bỏ (lưu 0).
      — thêm: kiểu ship lạ ⇒ `bad_ship_mode`.
- [x] `op_create_order`, `op_update_order` (bản mới nhất: `20261121000001_ship_fee.sql`): ghi hai cột.
      Kiểm tổng giữ nguyên `tiền món + ship_fee = total`.
- [x] `op_pay_order`: không đổi số cần thu. Kiểm lại: đơn `external` luôn có payout (check constraint đã đảm bảo). — không sửa hàm.
- [x] `notify_delivery`: gửi thêm khi đổi `ship_mode` hoặc `ship_payout` (như đổi địa chỉ / khách).
- [x] `owner_edit_order` (bản mới nhất: `20261121000001_ship_fee.sql`): nhận thêm `ship_mode`, `ship_fee`, `ship_payout`
      (không gửi ⇒ giữ nguyên; về `shop` ⇒ payout 0; sang `external` mà đơn chưa có payout ⇒ phải gửi); tổng mới = tiền món + phí mới; audit trước/sau; tính lại ca đã đóng.
- [x] `private.reconcile_shift` (bản mới nhất: `20261121000002_cans_counts.sql`): kỳ vọng tiền mặt
      `− Σ ship_payout` (đơn paid, `paid_shift` = ca này, mọi hình thức). Thêm vào kết quả:
      `ship: {shop_orders, external_orders, shop_fee, external_fee, payout, external_profit}`.
      Giữ `revenue.ship_fee` (= tổng hai loại phí) cho client cũ đến khi bước 4 xong.
- [x] `owner_report`, `owner_dashboard` (`20261117000004_owner.sql`, `20261117000006_dashboard.sql`, hoặc bản mới hơn): cộng khối `ship` theo kỳ.
      — làm: thêm `ship` vào `private.revenue_json` (dùng cho cả hai, kể cả `by_point`); hàm chung `private.ship_stats`.
      Thêm `ship_fee` / `ship_mode` / `ship_payout` vào dòng `owner_orders` (cho badge bước 5).
- [x] RPC mới `shift_ship_defaults(p_shift uuid)` (vai trò `tablet`, chỉ ca của quầy mình): trả `ship_mode`, `ship_fee`,
      `ship_payout` của đơn ship gần nhất (theo `created_at`, kể cả đã thanh toán, trừ đã xóa) của ca đó.
      Cần vì RLS giấu đơn đã thanh toán với tablet. Không lộ tổng tiền / số đơn.
- [x] `print_doc`: không thêm gì (bill không in kiểu ship / payout); kiểm rằng payout không lọt vào payload.
- [x] `tests/fixtures/reconcile-cases.json`: thêm ca `ship-ngoai` (TM + CK + Nợ shipper ngoài, một đơn xóa có payout,
      một đơn shipper ngoài chưa thanh toán ⇒ không trừ). Dùng chung cho test SQL và `src/domain/reconcile.ts`.
- [x] Test DB: check constraint; `bad_ship_payout` (0, 7.500, 60.000, thiếu); mang về gửi external ⇒ lưu shop/0;
      đổi kiểu ⇒ audit + Telegram; chủ sửa payout ⇒ tính lại ca đóng; `shift_ship_defaults` RLS (quầy khác bị chặn);
      client cũ không gửi hai trường ⇒ shop/0, chạy như trước.
      — `tests/db/ship-external.test.ts`; ca đã đóng cũ không đổi số: mọi ca cũ trong fixture có thêm `ship` toàn 0, `cash` giữ nguyên.

### 2. Domain (`src/domain/`, hàm thuần)
- [x] `types.ts`: `ShipMode = 'shop' | 'external'`; `Order.ship_mode`, `Order.ship_payout`.
- [x] `pricing.ts`: `SHIP_PAYOUTS = [5000, 10000, 15000, 20000]` (dùng chung nhãn `shipFeeLabel`).
- [x] `cart.ts`: `CartDraft.ship_mode`, `ship_payout`; `setShipMode(d, mode)` (về shop ⇒ payout 0);
      `toggleShipPayout(d, v)` (bấm lại **không** bỏ); `draftShipPayout(d)`; `newDraft(point, defaults)` nhận mặc định theo ca (+ `withShipDefaults` cho mặc định đến muộn, không đè lựa chọn đã bấm — cờ `ship_touched`);
      đổi loại đơn khỏi ship ⇒ shop/0; `draftChanged` so cả hai; hàm `draftBlocker(d)` trả "thiếu địa chỉ" / "chưa chọn tiền trả shipper".
- [x] `reconcile.ts`: trừ payout khỏi tiền mặt kỳ vọng; khối `ship` như SQL (`shipStats`, dùng lại cho báo cáo). Chạy chung fixture với test SQL.
- [x] `ownerEdit.ts`: nhận sửa kiểu / phí / payout.
- [x] `audit.ts`: "Kiểu ship: Quán ship → Shipper ngoài", "Trả shipper: 10.000 → 15.000", "Phụ thu" thay "Phí ship" khi external. Nhãn kiểu ship `SHIP_MODE_LABELS` ở `types.ts`.
- [x] Unit test cho từng hàm trên.

### 3. Lớp POS (`src/pos/`) + server giả
- [x] `ops.ts` `createOrder` / `updateOrder`: gửi `ship_mode`, `ship_payout`.
- [x] `backend.ts`: map hai cột; gọi `shift_ship_defaults` khi mở đơn mới (cache theo ca, cập nhật sau mỗi lần lưu đơn ship).
      — làm: `backend.loadShipDefaults` chỉ gọi RPC; cache nằm ở `Pos` (`shipDefaults()` / `cachedShipDefaults()`): tạo đơn ship ⇒ nhớ ngay,
      sửa đúng đơn ship mới nhất đã biết ⇒ cập nhật; mất mạng ⇒ dùng bản đã biết.
- [x] `src/owner/orders/api.ts`: map hai cột; `ownerEditOrder` gửi trường mới.
- [x] `src/test-utils/fakeServer.ts`: kiểm như server, `shift_ship_defaults`, đối soát có payout.
      — server giả không tính đối soát (chỉ ghi số đếm), nên phần đối soát chỉ có ở test SQL + `reconcile.ts`.

### 4. Giao diện tablet / điện thoại
- [x] `OrderScreen.tsx` (cả hai layout): công tắc **Quán ship / Shipper ngoài** trên hàng phí (`aria-pressed`).
      Shipper ngoài: tiêu đề hàng phí "Phụ thu"; thêm hàng "Trả shipper" 4 nút; chưa chọn ⇒ chữ đỏ "Chưa chọn tiền trả shipper",
      khóa Lưu / Đã ra món / Thanh toán như thiếu địa chỉ. Đơn mới lấy mặc định theo ca.
      — làm: tiêu đề hàng là "Trả shipper (tiền két)"; chữ đỏ hiện độc lập với "thiếu địa chỉ". Khối tổng tablet ghi "Phụ thu" thay "Phí ship".
- [x] Tóm tắt giỏ (điện thoại): dòng phụ "15.000 + phụ thu 5.000 · trả ship 10.000".
- [x] `ShipSheet.tsx`: dòng tóm tắt ghi kiểu ship.
- [x] `PayScreen.tsx`: dòng "Phụ thu" thay "Phí ship" khi external; dòng nhắc "Trả shipper −10.000 (lấy từ két)".
- [x] `QueueScreen.tsx`: badge "Ship ngoài · trả 10k" (`externalShipBadge` ở `pricing.ts`, dùng chung với danh sách đơn của chủ).

### 5. Chủ + kênh khác
- [x] `OrderPages.tsx` (danh sách đơn): badge kiểu ship + tiền trả shipper.
- [x] `OrderDetail.tsx`: dòng phí / phụ thu, "Trả shipper"; form sửa đơn có công tắc kiểu + hai hàng nút.
- [x] `ShiftPages.tsx`, `ReportPage.tsx`, `OwnerHome.tsx`: thay "trong đó phí ship" bằng khối thống kê ship (chỉ dòng > 0).
      — làm: `shipStatLines` (`src/domain/report.ts`) + `ShipStatsLine` (`src/owner/ui.tsx`); lãi/lỗ hiện khi có đơn shipper ngoài (kể cả lỗ).
      Thẻ Tiền mặt của ca có thêm dòng "Trả shipper ngoài (từ két)" khi > 0.
- [x] Telegram (`supabase/functions/_shared/format.ts`): tin đơn ship ghi "Shipper ngoài · phụ thu 5.000 · trả shipper 10.000";
      báo cáo ca thêm dòng "Ship ngoài: 3 đơn · phụ thu 15.000 · trả 30.000 → −15.000".
      — làm: đơn quán ship cũng có dòng kiểu ("Quán ship · phí ship 10.000" thay "Phí ship: 10.000"); "Trong đó phí ship" chỉ còn phí quán ship;
      tin chủ sửa đơn có dòng "Ship: … → …" khi đổi kiểu / phí / trả shipper.
- [x] Bill (`src/print/layout.ts`): phụ thu in "Phí ship" (không đổi code nếu chỉ dựa vào `ship_fee`); snapshot kiểm không có payout. — không đổi code; test `print.test.ts`.

### 6. Test
- [x] RTL (`TabletFlow.test.tsx`): chọn Shipper ngoài ⇒ hàng Trả shipper hiện, chưa chọn thì khóa thanh toán; chọn 10k ⇒
      `create_order` có `ship_mode: 'external', ship_payout: 10000`, `total` không cộng payout; đơn ship thứ hai trong ca
      mặc định Shipper ngoài + 10k; đổi sang Mang về ⇒ shop/0; màn thanh toán có dòng nhắc.
- [x] Snapshot Telegram (tin đơn ship, báo cáo ca) + bill. — bill: test văn bản trong `print.test.ts` (bill không dùng snapshot).
- [x] Cypress `c-sales.cy.ts`: luồng shipper ngoài đầy đủ (tạo, thanh toán CK, đóng ca đếm đúng = kỳ vọng đã trừ payout ⇒ chênh 0);
      hai máy cùng quầy thấy cùng mặc định. — C19; "máy thứ hai" là phiên tablet giả lập phía server (task `sim:shipOrder` / `sim:shipDefaults`).
- [x] `npm run check` + `npm run test:db` + `npm run test:e2e` pass (24/11: 344 unit, 144 DB, 54 Cypress).
      G37 (`settings.test.ts`, realtime) fail một lần khi chạy cả bộ DB, pass khi chạy riêng và ở lần chạy cả bộ sau: chập chờn, không liên quan ship.

## Tiêu chí xong

- Ca có 1 đơn shipper ngoài thu CK 30.000 (phụ thu 5.000, trả shipper 10.000), nhân viên đếm tiền = tiền lẻ − 10.000 ⇒ chênh lệch 0.
- Báo cáo ca / ngày / tháng hiện đủ 5 số của thống kê ship; nhân viên không thấy số nào trong đó.
- Mọi lần đổi kiểu ship / tiền trả shipper có trong nhật ký và Telegram.
- Client cũ (chưa cập nhật) vẫn tạo đơn ship được sau khi áp migration.

## Rủi ro / cần kiểm tra sớm
- Đổi công thức đối soát (cửa một chiều): ca đã đóng trước migration không bị tính lại (payout = 0 ⇒ số không đổi), nhưng kiểm bằng test.
- `shift_ship_defaults` không được lộ số đơn / doanh thu cho tablet (ADR 0002).
- Nhân viên quên lấy tiền két đưa shipper (hoặc lấy hai lần) ⇒ lệch tiền cuối ca; badge + dòng nhắc là biện pháp duy nhất.
