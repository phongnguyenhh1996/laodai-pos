# Plan: Cải thiện kiến trúc (deepening)

Nguồn: báo cáo [architecture-review-2026-11-27.html](../research/architecture-review-2026-11-27.html), skill `improve-codebase-architecture`.
File này là danh sách việc để làm dần. Mỗi ứng viên: **grill trước** (skill `grilling`), chốt hình dạng module rồi mới tách ticket.
Làm xong mục nào thì đánh dấu `[x]`. Ứng viên bị loại vì lý do quan trọng ⇒ ghi ADR để lần review sau không gợi ý lại.

Từ vựng kiến trúc (giữ nguyên tiếng Anh): **module**, **interface**, **seam**, **adapter**, **deep / shallow**, **leverage**, **locality**.

## Mục tiêu

Gom logic đang rải nhiều chỗ về các module deep có interface nhỏ, để thêm tính năng ít file hơn
(ship hai kiểu chạm 48 file, khoản chi chạm 41) và test được qua interface thay vì qua DOM / Cypress.

## Không làm

- Không đổi hành vi nghiệp vụ, không đổi UI. Chỉ tái cấu trúc, test cũ phải còn pass (trừ test bị thay bằng test ở interface mới).
- Không đi ngược ADR 0001–0005. ADR 0006 chỉ mở lại nếu chốt ứng viên 2.

## Lỗi thật phát hiện khi review (sửa riêng, không đợi tái cấu trúc)

- [ ] Chi tiết ca không sắp món theo `sort`: `src/owner/shifts/api.ts` select `order_items(name_snap,qty,toppings_snap,removed_at)`, không có `sort`.

## Ứng viên

### 1. Gom hợp đồng ghi đơn (Strong, đề xuất làm trước)

Luật ship / payload tạo và sửa đơn nằm ở `pos/ops.ts`, `domain/cart.ts`, `domain/ownerEdit.ts`, `test-utils/fakeServer.ts`, SQL.
Fake đã lệch SQL (không kiểm `point_not_allowed`, `point_inactive`, `price_mismatch`, `product_inactive`, cắt nhãn 40 / bàn 10, `bad_shift`).
`tests/support/ops.ts` `TabletSim` vẫn gửi `device_seq`, `code`, `status` cũ.

- [x] Grill (2026-11-27), đã chốt:
  - **Phạm vi**: luật nằm trong module chỉ gồm `create_order` / `update_order` (ship, địa chỉ, khách, nhãn, bàn, tổng). 11 `kind` của `sync_push` chỉ được gõ kiểu payload. `owner_edit_order` không vào contract suite; `ownerEdit` chỉ dùng chung luật ship (bắt buộc tiền trả shipper ngoài, mức phí hợp lệ).
  - **Module** `src/domain/orderWrite.ts` (thuần): kiểu payload tạo / sửa đơn, `RejectReason`, luật ship, hàm chuẩn hóa trả `{ ok: true, payload, order } | { ok: false, reason }` (không ném). Cắt nhãn 40 / bàn 10 đúng như SQL.
  - **Caller**: `ops` đổi `reason` ⇒ `PosError(rejectMessage(reason), reason)`; `fakeServer` ném `Reject(reason)`; `cart` có `draftProblem(draft)`, bỏ `draftShipMode` / `draftShipPayout` / `draftShipFee` / `draftAddress` / `needsAddress` / kiểm tiền trả shipper (hàm thao tác nháp giữ lại). Lỗi tại máy và lỗi server cùng một câu thông báo; UI không đổi.
  - **Fake** dùng chung hàm chuẩn hóa, tự kiểm thêm phần chỉ server biết: `point_not_allowed`, `point_inactive`, `price_mismatch`, `product_inactive`, `bad_shift`. Contract suite chứng minh fake khớp SQL.
  - **`WireOp`**: union phân biệt theo 11 `kind`, ở `src/pos/types.ts`, import kiểu payload từ `orderWrite`.
  - **`RejectReason`**: union các lý do `sync_push` trả; câu thông báo vẫn ở `ops.ts`. Danh mục đầy đủ + test so migrations + ~19 câu thiếu ⇒ ứng viên 6.
  - **Contract suite**: danh sách ca ở `src/pos/orderWrite.contract.ts` (mỗi lý do từ chối của tạo / sửa đơn một ca + ca chuẩn hóa: cắt nhãn / bàn, không phải ship ⇒ shop / 0 / bỏ địa chỉ / khách, khách mới). Chạy ở `src/pos/orderWrite.contract.test.ts` (FakeServer, `npm test`) và `tests/db/order-write-contract.test.ts` (`liveTablet`, `npm run test:db`). Ca trùng trong `sync.test.ts` / `ship-external.test.ts` chuyển sang suite rồi xóa.
  - **`TabletSim`**: dựng op bằng builder có kiểu; test cố tình gửi payload sai / cũ giữ `op()` thô, có ghi chú.
  - Không đụng UI ⇒ không cần ticket Figma.
- [x] T1: `WireOp` có kiểu cho 11 `kind` + `RejectReason` (`npm run check`). `OpPayloads` / `WireOp` ở `pos/types.ts`, payload tạo / sửa đơn + `RejectReason` ở `domain/orderWrite.ts`; `FakeServer.lastOp(kind)` cho test đọc payload có kiểu; `legacy.ts` ép kiểu một chỗ (payload bản offline cũ)
- [x] T2: `orderWrite.ts`; `ops`, `cart`, `ownerEdit` gọi chung (`npm run check`). `normalizeOrderWrite` trả `{ ok, order }` (đơn đã chuẩn hóa), payload dựng bằng `createOrderPayload` / `updateOrderPayload`; `shipFields` / `shipProblem` / `SHIP_MESSAGES` dùng chung cho tablet và form chủ. `cart` còn `draftProblem` + `draftShip`; ops kiểm theo thứ tự SQL (loại đơn → địa chỉ → ship → khách → món), lỗi tại máy có `reason`. Thêm câu cho `bad_qty`, `bad_dine_type`
- [x] T3: `fakeServer` dùng `orderWrite` + contract suite trên cả hai adapter `PosBackend` (`npm run check` + `npm run test:db`). Fake kiểm theo thứ tự `op_create_order` / `op_update_order`: ca của quầy → đơn trùng → ca mở → điểm bán (`point_not_allowed`, `point_inactive` chỉ khi tạo) → `normalizeOrderWrite` → khách (`order_customer`, theo `merged_into_id`) → dòng (`write_items`: dòng giữ nguyên / dòng mới, giá hiện hành, ngừng bán, `item_id_conflict`) → tổng; chỉ ghi khi mọi bước qua. Bản giả không có lịch sử giá (ca đổi giá vẫn ở `sync.test.ts`). Suite bắt được hai chỗ lệch SQL ở `orderWrite`: phí âm trên đơn không ship ⇒ `bad_ship_fee`; `ship_mode` rỗng ⇒ quán ship. Test ops dùng id dòng riêng cho mỗi đơn (trước đây fake nhận id trùng giữa các đơn)
- [ ] T4: `TabletSim` dùng builder có kiểu, bỏ `device_seq` / `code` / `status` / `served_at` / `paid_at` / `opened_at` (`npm run check` + `npm run test:db`)

### 2. Đối soát: một implementation, một kiểu kết quả (Strong, trái ADR 0006)

`reconcileShift` trong `src/domain/reconcile.ts` không có caller production. `supabase/functions/_shared/format.ts` khai lại `Reconcile` / `ShipStats` / `CountItem`.

- [ ] Grill: xóa bản TS hay giữ làm spec dễ đọc; cập nhật ADR 0006 theo quyết định
- [ ] File kiểu kết quả dùng chung cho app và Edge Function

### 3. Seam dữ liệu màn chủ (Strong)

8 file `src/owner/*/api.ts` nhận `SupabaseClient` thô, mỗi file một lớp lỗi; `RemotePrint.tsx` query thẳng.
Chuẩn hóa `order_items` viết 5 lần; `EXPENSE_COLUMNS` và cột ca lặp. Lưu cài đặt hai bước trong `SettingsPages.tsx` L355-364.

- [ ] Grill: một module hay theo nhóm màn; có viết adapter fake thật không (một adapter = seam giả định)
- [ ] Chuẩn hóa đơn / món dùng chung với `pos/backend.ts`
- [ ] Test màn chủ bằng Testing Library + fake

### 4. Phiên sửa đơn ra khỏi `OrderScreen`; tự in ra khỏi biến global (Strong)

`src/tablet/OrderScreen.tsx` L100-240 (ghi tuần tự, id tạo, autosave, gộp từ xa), `src/lib/print.ts` L84-124 (`pendingEdits`, `setEditDelay`).
Giữ ADR 0001: chỉ xong khi server trả lời, không thành hàng đợi offline.

- [ ] Grill: interface của phiên sửa đơn, ai giữ đồng hồ / debounce
- [ ] Object phiên sửa đơn + test với FakeServer và fake timers
- [ ] Object tự in nhận sự kiện `Pos`, công tắc, đồng hồ

### 5. Gộp `Pos` và `TabletStore` thành phiên tablet (Worth exploring)

`Pos` gọi 13 member public của store; `setSoldOut` chép luật ngày của server. Nên làm sau 1 và 4.

- [ ] Grill

### 6. Danh mục action nhật ký / thông báo / lý do từ chối (Worth exploring)

`domain/audit.ts`, `owner/log/visual.ts`, `_shared/format.ts` (tên khác: `expense_created` vs `expense_create`), `REJECT_MESSAGES` thiếu ~19 lý do.

- [ ] Grill
- [ ] Test so danh mục với chuỗi action trong migrations

### 7. Nghe realtime + poll một chỗ; chuẩn hóa dữ liệu cũ ở cửa đọc (Speculative)

4 bản subscribe / poll / visibility; ~42 lần `?? 'shop'` / `?? 0`; `src/pos/legacy.ts` còn nối vào `lib/pos.ts`, `lib/auth.ts`.

- [ ] Grill
- [ ] Xóa `legacy.ts` khi không còn máy có outbox cũ

## Tiêu chí xong (mỗi ứng viên)

- `npm run check` pass; đụng SQL thì `npm run test:db` pass.
- Test mới nằm ở interface module mới; test cũ ở module shallow đã bị thay thì xóa.
- Thuật ngữ mới vào `docs/glossary.md`.
