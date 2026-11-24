# Plan: Khoản chi giữa ca + nhập tiền theo nghìn

SPEC: mục 3 (`shift_expenses`), 4.9, 5 (tiền mặt kỳ vọng, khoản chi, Telegram đóng ca), 6, 7 (Chi tiền, nhập theo nghìn), 10.2, 10.3.
ADR: [0006](../adr/0006-khoan-chi-giua-ca.md). Thuật ngữ: khoản chi, ghi chú gần đây, nhập theo nghìn (`docs/glossary.md`).
File này là danh sách việc. Làm xong mục nào thì đánh dấu `[x]`. Đổi thiết kế thì sửa SPEC trước, rồi mới sửa plan.

## Mục tiêu

Giữa ca nhân viên lấy tiền két đi mua đá, ga… Hiện không có chỗ ghi nên két lệch và chênh lệch tiền mặt mất ý nghĩa.
Thêm **khoản chi**: nhân viên hoặc chủ ghi số tiền + ghi chú, tiền mặt kỳ vọng của ca trừ đi khoản này, chủ thấy từng khoản
trên Telegram. Đồng thời mọi ô tiền chuyển sang **nhập theo nghìn** (gõ `50` = 50.000đ) để bớt gõ nhầm số 0.

## Quyết định (đã grill 24/11)

- [x] Chỉ **chi**, chỉ **tiền mặt từ két** của một ca. Không có thu khác, không ghi chi phí trả bằng CK / tiền túi chủ.
- [x] Nhân viên ghi trên tablet (menu phụ hàng đợi → **Chi tiền**, cần ca mở). Chủ ghi ở chi tiết ca, kể cả ca đã đóng.
- [x] Không danh mục. Số tiền + **ghi chú bắt buộc**. **Ghi chú gần đây**: tối đa 8 ghi chú dùng nhiều nhất 30 ngày, chung mọi quầy,
      chuẩn hóa (chữ thường, gộp khoảng trắng); bấm nút chỉ điền ghi chú, **không** điền số tiền.
- [x] Màn xác nhận to trước khi lưu: "Chi **50.000đ** – mua đá?". Không hạn mức, không chụp ảnh.
- [x] Tablet thấy các khoản chi (kể cả khoản chủ ghi, nhãn "Chủ ghi") và tổng chi của **ca đang mở** của quầy mình.
- [x] Nhân viên chỉ **hủy** (`voided_at`) khoản chính nhân viên ghi, khi ca còn mở; không sửa. Chủ hủy / sửa mọi khoản;
      ca đã đóng ⇒ tính lại đối soát, "đã điều chỉnh".
- [x] Telegram ngay khi ghi / hủy / chủ sửa; `audit_log` trước/sau. Báo cáo đóng ca thêm "Chi: N khoản · X". Tổng kết ngày thêm tổng chi.
- [x] Báo cáo chủ: tổng chi + cộng theo nhóm ghi chú giống nhau.
- [x] Mất mạng ⇒ không lưu, báo như mọi thao tác ([ADR 0001](../adr/0001-server-la-nguon-su-that.md)).
- [x] **Nhập theo nghìn** cho mọi ô tiền (tablet + chủ). Đuôi `.000đ` cố định, không có số lẻ dưới 1.000. Một component `MoneyInput`.
      Ô dùng chung (bổ sung giữa ca, sổ lương) chỉ nhập theo nghìn khi đang chọn loại tiền.
      Màn xác nhận đóng ca hiện lại số đầy đủ, vẫn không hiện kỳ vọng.

## Không làm

- Danh mục chi, hạn mức / PIN chủ cho khoản lớn, ảnh hóa đơn.
- Thu khác giữa ca (bán ve chai…); sổ chi phí chung, lãi / lỗ.
- Ứng lương lấy từ két (nếu có thì chưa được hỗ trợ; không ghi thành khoản chi).
- Nhân viên sửa khoản chi; nhân viên xem khoản chi của ca đã đóng.
- Ghi chú gần đây do chủ soạn / ghim.

## Ticket 1 — `MoneyInput` (nhập theo nghìn) — cửa hai chiều

Làm trước; ticket 2 dùng lại. Chỉ đổi client, không đổi dữ liệu.

- [x] Figma: trạng thái ô (trống, đang gõ `1.500` + `.000đ`, lỗi, disabled) ở tablet và chế độ chủ. Chủ duyệt rồi mới code.
      Frame MI1 trang Tablet; chủ chốt thêm: ô trống chỉ hiện "0đ" (24/11).
- [x] `src/domain/money.ts` (hàm thuần, test trước): `thousandsFromInput(raw)` (chỉ nhận chữ số, bỏ dấu chấm / khoảng trắng, trả số nghìn
      hoặc null), `toVnd(thousands)`, `thousandsText(vnd)` để hiện lại khi sửa giá trị cũ (giá trị không chia hết 1.000 ⇒ báo rõ, không làm tròn ngầm),
      giới hạn số chữ số an toàn (6 chữ số nghìn, vừa cột `int`). Thay chỗ dùng `parseMoneyInput` (`src/domain/catalog.ts`); bỏ hậu tố `k` vì không còn cần.
- [x] Component `MoneyInput` (value: `Money | null`, `onChange`, `size` tablet/chủ, `label`, `testId`): `inputMode="numeric"`, phần nghìn có dấu chấm
      khi gõ, đuôi `.000đ` xám cố định, con trỏ luôn trước đuôi.
- [x] Thay ở mọi ô tiền:
      - Tablet: tiền khách đưa nhập tay ([PayScreen.tsx](../../src/tablet/PayScreen.tsx)), tiền mặt đóng ca ([CloseShiftScreen.tsx](../../src/tablet/CloseShiftScreen.tsx)), thu nợ ([DebtScreen.tsx](../../src/tablet/DebtScreen.tsx)).
      - Chủ: thu nợ ([DebtPages.tsx](../../src/owner/debts/DebtPages.tsx)), bổ sung giữa ca khi chọn tiền ([ShiftPages.tsx](../../src/owner/shifts/ShiftPages.tsx)),
        sổ lương khi không phải ngày công ([PayrollPages.tsx](../../src/owner/payroll/PayrollPages.tsx)), trường `kind: 'money'` của Cài đặt (giá món, giá topping, lương một ngày, tiền lẻ đầu ca — [entities.ts](../../src/owner/settings/entities.ts), [SettingsPages.tsx](../../src/owner/settings/SettingsPages.tsx)).
- [x] Màn xác nhận đóng ca: hiện lại "Tiền mặt: 2.080.000đ" (và số hộp / dĩa / lon đã nhập) trước khi gửi.
- [x] Kiểm tra tự động không ai thêm ô tiền kiểu cũ (làm: `no-restricted-syntax` cấm `unit` / `suffix` = "đ" trong JSX; `parseMoneyInput` đã xóa): ưu tiên luật ESLint (`no-restricted-imports` cho `parseMoneyInput` cũ ngoài `src/domain`,
      hoặc `no-restricted-syntax` theo `data-testid` / prop). Không làm được thì thêm vào `docs/coding-standards.md` mục UI.
- [x] Test: unit `money.ts` (`50` → 50.000, `1.500` → 1.500.000, rỗng / chữ ⇒ null, quá dài ⇒ null); unit / component `MoneyInput`;
      Cypress dùng ô tiền (thanh toán TM nhập tay, đóng ca, thu nợ, cài giá, bổ sung giữa ca) đổi sang gõ theo nghìn.
- [x] `npm run check` + `npm run test:e2e`.

## Ticket 2 — Khoản chi giữa ca — cửa một chiều (migration, `sync_push`, công thức đối soát)

Thứ tự deploy: **migration trước, frontend sau**.

### 0. SPEC + thuật ngữ + ADR
- [x] SPEC mục 3, 4.9, 5, 6, 7, 10.2, 10.3. Glossary. ADR 0006.

### 1. Figma
- [ ] Tablet: mục Chi tiền trong menu phụ; màn Chi tiền (danh sách khoản của ca + tổng, nút hủy, nhãn "Chủ ghi", khoản đã hủy gạch ngang);
      form (MoneyInput + ghi chú + hàng nút ghi chú gần đây); màn xác nhận; trạng thái mất kết nối.
- [ ] Chủ: khối "Khoản chi" ở chi tiết ca (danh sách, Ghi khoản chi, sửa / hủy); dòng khoản chi trong báo cáo ngày / tháng.
- [ ] Chủ duyệt.

### 2. Dữ liệu (Supabase): migration `2026112xxxxxxx_shift_expenses.sql`
- [ ] Bảng `shift_expenses`: `id uuid pk` (client sinh, như `customers`), `shift_id` fk, `amount int` check `> 0 and % 1000 = 0`,
      `note text not null` check `length(btrim(note)) between 1 and 80`, `actor_kind` (`staff`|`owner`), `staff_id` (null nếu chủ),
      `at timestamptz default now()`, `voided_at`, `void_actor_kind`. Index `(shift_id)`, `(at)`.
- [ ] RLS: `tablet` chỉ `select` dòng của ca **đang mở** của quầy mình; không `insert` / `update` / `delete` trực tiếp. Chủ đọc tất cả.
      Không ai hard delete.
- [ ] `sync_push`: thêm `create_expense` (ca phải đang mở và thuộc quầy; idempotent theo `op_id`; `actor_kind = staff`, `staff_id` = nhân viên của ca)
      và `void_expense` (chỉ khoản `staff` của ca đang mở của quầy mình, chưa hủy; hủy lại ⇒ không đổi). Lỗi: `bad_expense_amount`,
      `bad_expense_note`, `shift_not_open`, `expense_not_voidable`.
- [ ] RPC `recent_expense_notes()` (`tablet` + chủ): ≤ 8 ghi chú, 30 ngày, mọi quầy, chưa hủy, nhóm theo `lower(regexp_replace(btrim(note), '\s+', ' ', 'g'))`,
      xếp theo số lần rồi lần gần nhất, trả bản viết gần nhất của nhóm. **Chỉ trả chữ**, không số tiền / số lần.
- [ ] RPC chủ: `owner_create_expense(shift, amount, note)`, `owner_edit_expense(id, amount, note)`, `owner_void_expense(id)`;
      ca đã đóng ⇒ `recalculated_at`. Audit trước/sau.
- [ ] `private.reconcile_shift` (bản mới nhất: `20261124000001_ship_external.sql`): kỳ vọng tiền mặt `− Σ amount (voided_at is null)`;
      thêm vào kết quả `expenses: {count, total}`.
- [ ] Báo cáo / tổng quan chủ (`private.revenue_json` hoặc hàm chung mới `private.expense_stats`): tổng chi + nhóm theo ghi chú chuẩn hóa cho ngày / tháng / ca.
      Chi tiết ca trả danh sách khoản (kể cả đã hủy).
- [ ] Telegram: tin ghi / hủy / sửa (mẫu ở SPEC mục 6); báo cáo đóng ca thêm dòng "Chi" khi có; `build_daily_summary` thêm tổng chi
      (hàm đang không chạy theo lịch — migration `20261120000004` — nhưng để bật lại là có).
- [ ] `tests/fixtures/reconcile-cases.json`: thêm ca `khoan-chi` (2 khoản nhân viên, 1 khoản chủ, 1 khoản đã hủy). Mọi ca cũ có `expenses` = 0, `cash` giữ nguyên.
- [ ] Test DB (`tests/db/expenses.test.ts`): constraint (0, 7.500, ghi chú rỗng / toàn khoảng trắng); `create_expense` idempotent;
      ca đóng / quầy khác ⇒ từ chối; RLS tablet không đọc khoản của ca đã đóng / quầy khác; tablet không hủy khoản chủ ghi / ca đóng;
      `recent_expense_notes` gộp "Mua đá" / " mua  đá " và không lộ số tiền; chủ sửa khoản ca đóng ⇒ kỳ vọng đổi + `recalculated_at`;
      audit + Telegram cho mỗi thao tác; đóng ca ⇒ RPC vẫn chỉ trả `ok`.

### 3. Domain (`src/domain/`, hàm thuần)
- [ ] `types.ts`: `ShiftExpense`.
- [ ] `expenses.ts`: `normalizeExpenseNote`, `validateExpense` (amount, note), `activeExpenseTotal`.
- [ ] `reconcile.ts`: trừ khoản chi; khối `expenses`. Chạy chung fixture với test SQL.
- [ ] `audit.ts`: nhãn "Ghi khoản chi", "Hủy khoản chi", "Sửa khoản chi: 20.000 → 25.000".
- [ ] Telegram format (`supabase/functions/_shared/format.ts`): ba tin + dòng "Chi" trong báo cáo ca; cập nhật snapshot.

### 4. Tablet
- [ ] `src/pos`: op `create_expense`, `void_expense` qua `sync_push` với `op_id` (gửi lại dùng lại `op_id`).
- [ ] Menu phụ hàng đợi: "Chi tiền" (cạnh Thu nợ).
- [ ] Màn Chi tiền theo Figma: danh sách + tổng, form, ghi chú gần đây, xác nhận, hủy (có hỏi lại), mất kết nối.
- [ ] Nghe `live_pulse` để thấy khoản chủ vừa ghi.

### 5. Chế độ chủ
- [ ] Chi tiết ca: khối Khoản chi (ghi / sửa / hủy), ca đã đóng hiện "đã điều chỉnh"; số kỳ vọng / chênh lệch cập nhật.
- [ ] Báo cáo ngày / tháng: tổng chi + nhóm theo ghi chú. Nhật ký: lọc "Khoản chi".

### 6. E2E (Cypress)
- [ ] Nhân viên ghi chi 20k "mua đá" → đóng ca đếm đúng (kỳ vọng đã trừ) → chủ thấy chênh lệch 0 và khoản chi trong chi tiết ca.
- [ ] Ghi chú gần đây xuất hiện ở lần sau, bấm chỉ điền ghi chú.
- [ ] Nhân viên hủy khoản của mình; không thấy nút hủy ở khoản "Chủ ghi".
- [ ] Chủ sửa khoản chi của ca đã đóng ⇒ "đã điều chỉnh".

### 7. Xong khi
- [ ] `npm run check`, `npm run test:db`, `npm run test:e2e` pass.
- [ ] Review: đúng phạm vi plan; khớp `docs/coding-standards.md`; người đọc kỹ migration + `sync_push` + công thức (cửa một chiều).
- [ ] Retro: điều gì phải nhắc agent lần này → test / lint hoặc coding standards.
