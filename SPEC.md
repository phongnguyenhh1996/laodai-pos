# Laodai POS — Đặc tả (Đợt 1)

POS cá nhân cho quán nhỏ: sáng 2 điểm bán xôi chạy song song, trưa 1 điểm cơm gà (dùng lại tablet của một điểm xôi). Mục tiêu: **dễ bấm**, **mọi thao tác có dấu vết**, và **đối chiếu được ba nguồn: hàng giao – đơn bán – tiền thu**.

> Nguyên tắc chống gian lận: phần mềm không chặn được việc thu tiền mà không bấm đơn, nên hệ thống không cố chặn mà **ghi lại mọi thứ để chủ chất vấn**. Nhân viên **không bao giờ thấy doanh thu / tổng số đơn / số kỳ vọng**, nên khi đếm cuối ca họ không thể "đếm cho khớp".

---

## 1. Kiến trúc

| Thành phần | Lựa chọn |
|---|---|
| App | PWA (React + Vite + TypeScript, Tailwind, `vite-plugin-pwa`) — một app, hai chế độ: **Bán hàng** (tablet) và **Chủ** (điện thoại) |
| Dữ liệu trên máy | Không lưu dữ liệu bán hàng trên máy: đọc / ghi thẳng Supabase, cập nhật qua Realtime |
| Backend | Supabase: Postgres + RLS, Auth, Realtime, Edge Functions, `pg_cron` |
| Thông báo | Telegram bot (Edge Function), đồng thời ghi nhật ký trong app |
| Hosting | Cloudflare Pages (free) |
| Thiết bị | Tablet Android cũ (Chrome 90+), bật **ghim màn hình** |

Chi phí vận hành dự kiến: 0đ/tháng (gói free).

### 1.1 Realtime, server là nguồn sự thật
- Không có chế độ offline: nhiều máy có thể dùng chung một hồ sơ tablet (vd. hai tablet ở cùng điểm bán) nên ca, hàng đợi, mã đơn phải có **một bản duy nhất trên server** để không xung đột.
- Mỗi thao tác (mở ca, tạo / sửa / ra món / xóa / thanh toán đơn, thu nợ, đóng ca) gọi thẳng RPC **idempotent** `sync_push` và chỉ coi là xong khi server trả lời. Mất mạng ⇒ báo "Mất kết nối", thao tác không lưu; bấm lại khi có mạng. Gửi lại sau khi mất phản hồi dùng lại `op_id` ⇒ server không ghi hai lần.
- Server cấp **mã đơn** và **số thứ tự** (`device_seq`) trong khóa theo hồ sơ tablet ⇒ hai máy không bao giờ trùng mã / trùng số. Giờ thực hiện là giờ server.
- Tablet nghe thay đổi qua Supabase Realtime trên bảng `live_pulse` (mỗi thay đổi của đơn / ca / danh mục tăng một bộ đếm): máy khác mở ca, tạo / thanh toán đơn, chủ đổi giá ⇒ mọi máy cập nhật ngay. Không nghe thẳng bảng `orders` vì RLS giấu đơn đã thanh toán với tablet.
- Máy khác vừa thanh toán / xóa / đóng ca mà máy này chưa kịp thấy ⇒ server từ chối, tablet báo rõ ("đơn đã được thanh toán ở máy khác") và tải lại.
- Tablet không giữ dữ liệu doanh thu: không có bản sao đơn nào trên máy, RLS chỉ cho đọc đơn đang mở.

### 1.2 Đăng nhập & phân quyền
- **Chủ**: 1 tài khoản (email + mật khẩu), dùng trên nhiều thiết bị.
- **Mọi thiết bị cùng một luồng** (tablet hay điện thoại chủ như nhau): vào app → chủ **đăng nhập 1 lần** → chọn **quầy** (trong dữ liệu là `tablet_profiles`, vd. "Tablet A") → Edge Function cấp **phiên vai trò `tablet`** và hủy phiên chủ trên máy đó. Báo Telegram: "Tablet A vừa được đăng nhập". Không có form đăng nhập chủ riêng cho điện thoại.
  - Vai trò `tablet` bị RLS giới hạn: chỉ đọc menu/nhân viên/khách nợ, chỉ thao tác **đơn đang mở** của hồ sơ tablet mình, không đọc được đơn đã thanh toán, ca đã đóng, báo cáo, nhật ký.
  - ⇒ "Nhân viên không thấy doanh thu" được đảm bảo ở **tầng dữ liệu**, không chỉ ẩn giao diện.
- **Chế độ chủ** (mọi thiết bị): nhập lại mật khẩu chủ, hoặc **mã PIN 6 số của riêng máy đó** (vào bằng mật khẩu trên máy chưa có PIN ⇒ hỏi cài PIN; mỗi máy một PIN, sai 5 lần liền ⇒ PIN máy đó bị xóa, phải nhập mật khẩu; chủ xem / xóa PIN từng máy ở màn "Quầy của máy này") → phiên chủ tạm thời (chỉ trong bộ nhớ, tải lại trang là mất), **tự thoát sau 2 phút** không thao tác, trở lại phiên `tablet`. Mỗi lần vào đều báo Telegram.
- Nhân viên: **chọn tên**, không PIN.

---

## 2. Khái niệm

- **Điểm bán**: Xôi A, Xôi B, Cơm gà. Mỗi điểm dùng một **menu** (Xôi A & Xôi B dùng chung menu "Xôi").
- **Hồ sơ tablet**: tên, danh sách điểm bán được phép, số **mặc định đầu ca** (hộp, dĩa, tiền lẻ). Không có màn quản lý thiết bị/thu hồi.
- **Ca** = 1 nhân viên + 1 hồ sơ tablet + khoảng thời gian. Đơn vị chịu trách nhiệm về **tiền mặt, hộp, dĩa**. Mỗi tablet tại một thời điểm chỉ có 1 ca mở.
- **Đơn** gắn nhãn **điểm bán** (chọn bằng tab trong ca, không cần đóng ca khi chuyển xôi ↔ cơm gà).

---

## 3. Mô hình dữ liệu (Postgres)

```
settings          (singleton) telegram_chat_id, wait_yellow_min=5, wait_red_min=10,
                  daily_summary_time, timezone='Asia/Ho_Chi_Minh'
staff             id, name, active
staff_details     id (= staff.id), phone, id_number (CCCD 12 số / CMND 9 số), birthday (đều tùy chọn),
                  day_rate (lương một ngày)                       -- chỉ chủ đọc (tablet đọc được staff)
payroll_entries   id, staff_id, month (ngày 1), kind (bonus|deduction|advance|payment|days),
                  amount, note, at, voided_at                     -- sổ lương; không sửa/xóa, ghi nhầm thì hủy
staff_day_marks   id, staff_id, day, kind (off|work), reason, at   -- đánh dấu ngày trên lịch (1/ngày); work = có làm không mở ca ⇒ +1 công
menus             id, name                                   -- "Xôi", "Cơm gà"
points            id, name, menu_id, active                  -- Xôi A, Xôi B, Cơm gà
tablet_profiles   id, name, point_ids[], default_boxes, default_plates, default_float,
                  auto_print_kitchen, auto_reprint_kitchen_on_edit, auto_print_bill  -- bool, mục 12
print_template    (singleton) jsonb mẫu in chung cho phiếu bếp + bill (mục 12.4)
print_jobs        id, kind (kitchen|bill|test), order_id, order_rev, tablet_profile_id,
                  source (auto|staff|owner), status (pending|claimed|printed|failed|expired),
                  device_id, detail (jsonb: món thêm/bớt của phiếu "ĐÃ SỬA"),
                  created_at, claimed_at, finished_at, error  -- mục 12.6
products          id, menu_id, name, price, sort, active,
                  boxes_takeaway, boxes_dinein, plates_dinein -- định mức bao bì
toppings          id, menu_id, name, price, extra_box_takeaway bool, sort, active
combos            id, menu_id, name, product_id, topping_ids[], sort, active
price_history     id, entity_type, entity_id, old_price, new_price, changed_at
sold_out          point_id, item_kind (product|topping), item_id, day, at, shift_id, tablet_profile_id,
                  cleared_at, cleared_shift_id                -- hết món trong ngày (mục 4.8); bán lại = ghi cleared_at

shifts            id, tablet_profile_id, staff_id, opened_at, closed_at,
                  open_boxes, open_plates, open_float,           -- lấy từ mặc định
                  close_boxes_left, close_plates_left, close_cash_counted,
                  status (open|closed), recalculated_at
shift_adjustments id, shift_id, kind (boxes|plates|cash), qty, note, at  -- chủ bổ sung giữa ca
shift_expenses    id, shift_id, amount, note, actor_kind (staff|owner), staff_id,  -- khoản chi (4.9)
                  at, voided_at, void_actor_kind              -- amount > 0, bội 1.000; note bắt buộc

orders            id, device_seq, tablet_profile_id, point_id, code,   -- code: "3F5"
                  label, table_no, dine_type (dinein|takeaway|delivery),
                  address, ship_fee,                    -- chỉ đơn ship; ship_fee 0–50.000, bội 1.000, đã nằm trong total
                  ship_mode (shop|external),            -- kiểu ship; không phải đơn ship ⇒ shop
                  ship_payout,                          -- trả shipper ngoài; chỉ external, 1.000–50.000, bội 1.000;
                                                        -- KHÔNG nằm trong total, là tiền mặt lấy từ két
                  status (open|served|paid|deleted),
                  opened_shift_id, paid_shift_id,
                  created_at, served_at, paid_at, deleted_at, delete_reason,
                  total, payment_method (cash|transfer|debt), cash_given,
                  customer_id, owner_edited bool
order_items       id, order_id, product_id, name_snap, unit_price_snap, qty,
                  toppings_snap jsonb  -- [{id,name,price,extra_box}]

customers         id, name, description, phone, merged_into_id, created_by_shift_id
debt_payments     id, customer_id, amount, method (cash|transfer), shift_id, at

audit_log         id, at, synced_at, actor_kind (staff|owner), staff_id,
                  tablet_profile_id, shift_id, action, entity, entity_id,
                  before jsonb, after jsonb, reason
```

Ghi chú:
- Giá trong đơn là **ảnh chụp** (`*_snap`) tại thời điểm bán; đổi giá không làm đổi đơn cũ.
- Dư nợ khách = Σ `orders.total` (payment_method = debt) − Σ `debt_payments.amount`, tính trên khách gốc sau khi gộp.
- Không có hard delete ở bất kỳ bảng nghiệp vụ nào.

---

## 4. Luồng nghiệp vụ

### 4.1 Mở ca (tablet)
1. Chọn tên nhân viên → **Mở ca**. Không nhập gì thêm.
2. Ca nhận `open_boxes / open_plates / open_float` từ mặc định của hồ sơ tablet.
3. Đơn còn mở từ ca trước của tablet này hiển thị tiếp trong hàng đợi.
4. Telegram: "🟢 Lan mở ca – Tablet A – 05:42".

Chủ có thể **bổ sung giữa ca** (vd. "+50 hộp", "+200k tiền lẻ") từ điện thoại → `shift_adjustments`.

### 4.2 Tạo / sửa đơn
- Tab điểm bán ở trên cùng (chỉ các điểm của hồ sơ tablet).
- Lưới **combo** (bấm 1 lần là thêm) + lưới **món chính** → bảng chọn **topping** (cộng giá).
- Nút **Tại chỗ / Mang về** (mặc định: Xôi = Mang về, Cơm gà = Tại chỗ); ô **nhãn** ngắn hoặc số bàn (tùy chọn).
- Nhân viên **thấy giá**, không sửa được giá; không có giảm giá.
- **Ship**: địa chỉ bắt buộc, khách tùy chọn (Telegram báo khi tạo / đổi địa chỉ / đổi khách). Hàng nút **phí ship** +5k · +10k · +15k · +20k (bấm lại mức đang chọn = bỏ phí); phí cộng vào tổng đơn. Đổi sang Tại chỗ / Mang về ⇒ bỏ địa chỉ, khách và phí. Server kiểm `tổng = tiền món + phí ship` (`total_mismatch`), phí sai mức ⇒ `bad_ship_fee`.
  - Điện thoại: bấm Ship không bật bàn phím; một hàng "Địa chỉ, khách" mở bảng nhập riêng. Tablet: ô khách + địa chỉ nằm ngay trong giỏ.
  - **Kiểu ship**: công tắc **Quán ship / Shipper ngoài** ngay trên hàng phí.
    - **Quán ship** (`shop`): như trên, khách trả phí ship, tiền nằm trong két.
    - **Shipper ngoài** (`external`): hàng phí đổi tên thành **"Phụ thu"** (vẫn là `ship_fee`, cùng 4 mức, bấm lại = 0, tính **một lần cho cả đơn**, không theo số món). Thêm hàng **"Trả shipper"** +5k · +10k · +15k · +20k, **bắt buộc chọn** (thiếu ⇒ chưa lưu / ra món / thanh toán được, như thiếu địa chỉ; bấm lại mức đang chọn không bỏ được). Tiền trả shipper **không** cộng vào tổng đơn.
    - **Mặc định theo ca**: đơn ship mới lấy kiểu ship, phụ thu / phí ship và mức trả shipper của **đơn ship gần nhất của ca** (đọc từ server, nên mọi máy dùng chung quầy thấy giống nhau). Đơn ship đầu ca: Quán ship, chưa chọn phí.
    - Đổi qua lại hai kiểu được đến khi thanh toán. Đổi sang Quán ship ⇒ bỏ tiền trả shipper (phí giữ nguyên). Đổi sang Tại chỗ / Mang về ⇒ bỏ cả kiểu ship (về `shop`) và tiền trả shipper.
    - Server kiểm: `shop` ⇒ `ship_payout = 0`; `external` ⇒ `ship_payout` 1.000–50.000, bội 1.000 (`bad_ship_payout`); không phải đơn ship ⇒ `shop`, `0` (bỏ như bỏ địa chỉ). Bốn mức nằm ở client.
- Đơn đang mở (`open`/`served`): nhân viên sửa món & xóa đơn được. Mọi thay đổi ghi `audit_log` (trước/sau).
  - **Xóa đơn** → chọn nhanh lý do (1 chạm: bấm nhầm / khách bỏ về / khách đổi ý / khác) → Telegram ngay, kèm nội dung đơn và trạng thái lúc xóa (đã ra món hay chưa).

### 4.3 Hàng đợi (màn hình chính tablet)
- Hai nhóm: **Chờ ra món** (trên) và **Chờ thanh toán** (dưới), mỗi nhóm xếp theo giờ tạo, đơn cũ nhất ở trên.
- Mỗi thẻ đơn: **số thứ tự trong hàng đợi** (1, 2, 3… đánh lại liên tục), **mã đơn** `3F5`, nhãn/bàn, giờ tạo, **đồng hồ chờ**, tóm tắt món, tổng tiền đơn.
- Đơn ship: badge "+10k ship" (quán ship, khi phí > 0); đơn shipper ngoài thì badge **"Ship ngoài · trả 10k"** để nhắc lấy tiền két đưa shipper.
- Chờ ra món đổi màu: vàng ≥ 5 phút, đỏ ≥ 10 phút (chủ chỉnh).
- Bấm **Đã ra món** → chuyển nhóm, lưu `served_at`.
- Mã đơn: 1 chữ + 2 số, ví dụ `A30` (chữ đầu bỏ `I L O`), ngẫu nhiên, không trùng trong ngày của tablet. Không phản ánh số lượng đơn.

### 4.4 Thanh toán
Chọn một hình thức (không chia, không nợ một phần). Số cần thu là tổng đơn, **đã gồm phí ship** (màn thanh toán hiện dòng "Phí ship" riêng):
- **Tiền mặt**: nút mệnh giá nhanh "Khách đưa" (đủ tiền, 50k, 100k, 200k, 500k, nhập tay) → hiện tiền thối.
- **Chuyển khoản**: nhân viên xác nhận đã nhận.
- **Ghi nợ**: ô tên (bắt buộc) với **gợi ý khách có sẵn**; ô mô tả ("giáo viên", "20 Lê Lợi") và SĐT tùy chọn; tên mới → tự tạo khách. Telegram ngay.

Sau khi thanh toán, đơn **biến mất khỏi tablet** và nhân viên không sửa được nữa. Tiền tính vào **ca đang mở lúc thu** (`paid_shift_id`), kể cả khi đơn được mở từ ca trước.

Đơn shipper ngoài: màn thanh toán hiện dòng **"Trả shipper −10.000 (lấy từ két)"** dưới tổng để nhắc; số cần thu vẫn là tổng đơn. Tiền trả shipper **luôn là tiền mặt từ két**, bất kể khách trả TM / CK / Nợ, và được tính vào **ca thanh toán đơn** (`paid_shift_id`). Đơn bị xóa ⇒ không có khoản chi (đã đưa tiền shipper rồi mới xóa thì chủ ghi chú lúc đối soát).

### 4.5 Thu nợ (tablet)
Chọn khách → thấy dư nợ của khách đó → nhập số tiền + hình thức → lưu `debt_payments` vào ca hiện tại. Tiền mặt thu nợ tính vào két ca. Telegram ngay.

### 4.6 Đóng ca (đếm mù)
1. Nhân viên nhập: **số hộp còn lại**, **số dĩa sạch còn lại**, **tiền mặt đếm được**.
2. Xác nhận → màn hình chỉ hiện "Đã đóng ca". Không hiện số kỳ vọng hay chênh lệch.
3. Không chặn nếu còn đơn mở; đơn mở vẫn thuộc ca cũ và chuyển tiếp sang ca sau.
4. Server tính đối soát (mục 5) → Telegram báo cáo ca.

### 4.7 Chủ sửa đơn đã thanh toán
Chỉ trên chế độ chủ. Sửa món / hình thức thanh toán / khách nợ, có log trước/sau, `owner_edited = true`. Với đơn ship, chủ sửa được thêm **kiểu ship, phí ship / phụ thu, tiền trả shipper** (cùng luật như 4.2; tổng mới = tiền món mới + phí ship mới). Không sửa những thứ này thì giữ nguyên. Nếu ca đã đóng → **tính lại** đối soát, đánh dấu "đã điều chỉnh".

### 4.8 Hết món
- Màn đơn có nút **"Báo hết món"** → chế độ đánh dấu: bấm món hoặc topping để báo **hết** / **bán lại**. Bấm **Xong** để về bán tiếp.
- Hết món tính **theo điểm bán đang chọn** (Xôi A hết xôi gấc thì Xôi B vẫn bán) và **chỉ trong ngày kinh doanh** (giờ VN): sang ngày mới thì tự bán lại, không cần ai bỏ.
- Món hết: mờ, gạch tên, nhãn **"Hết"**, không bấm được. Combo có món chính hoặc topping đang hết cũng bị khóa. Topping hết không chọn thêm được trong bảng topping.
- Cần ca đang mở. Ghi qua `sync_push` (`set_sold_out`), mọi máy cập nhật ngay qua `live_pulse`. Tablet đọc bằng RPC `sold_out_today()` (chỉ điểm bán của quầy mình).
- Server **không chặn** đơn có món đang hết (máy khác có thể vừa báo hết lúc nhân viên đang bấm đơn). Chỉ khóa trên giao diện.
- Báo hết / bán lại ghi `audit_log` (kèm tên nhân viên, điểm bán), xem ở Nhật ký, lọc "Hết món". Không báo Telegram.

### 4.9 Khoản chi giữa ca
Lấy **tiền mặt từ két** của ca để mua đồ (đá, ga…). Chỉ chi, chỉ tiền mặt; chi phí trả bằng CK / tiền túi chủ không ghi ở đây. Xem [ADR 0006](docs/adr/0006-khoan-chi-giua-ca.md).
- **Tablet**: menu phụ của hàng đợi → **Chi tiền** (cần ca đang mở). Nhập số tiền (nhập theo nghìn, mục 7) + **ghi chú bắt buộc**. Hàng nút **ghi chú gần đây**: tối đa 8 ghi chú dùng nhiều nhất 30 ngày qua, mọi quầy, so khớp không phân biệt hoa thường / khoảng trắng thừa; bấm nút chỉ điền ghi chú, **không** điền số tiền. Lưu → màn xác nhận to "Chi **50.000đ** – mua đá?" → `sync_push` (`create_expense`). Mất mạng ⇒ không lưu, như mọi thao tác ([ADR 0001](docs/adr/0001-server-la-nguon-su-that.md)).
- Màn Chi tiền liệt kê các khoản chi của **ca đang mở** (cả khoản chủ ghi, nhãn "Chủ ghi") và tổng chi của ca. Không thấy ca khác.
- **Hủy**: nhân viên hủy được khoản chính nhân viên ghi khi ca còn mở (`void_expense`, `voided_at`); không sửa — nhầm thì hủy rồi ghi lại. Khoản chủ ghi thì nhân viên không hủy được.
- **Chủ**: ở chi tiết ca, nút **Ghi khoản chi** (cạnh bổ sung giữa ca), được cả với ca đã đóng; hủy hoặc sửa số tiền / ghi chú mọi khoản. Ca đã đóng ⇒ **tính lại** đối soát, đánh dấu "đã điều chỉnh".
- Mọi ghi / hủy / sửa ghi `audit_log` và báo Telegram ngay (mục 6). Không hạn mức, không chụp ảnh.

---

## 5. Đối soát cuối ca (tính ở server)

**Tiền mặt**
```
kỳ vọng = open_float + Σ adjustments(cash)
        + Σ orders.total (cash, paid_shift = ca này)
        + Σ debt_payments.amount (cash, shift = ca này)
        − Σ orders.ship_payout (mọi hình thức, status = paid, paid_shift = ca này)
        − Σ shift_expenses.amount (shift = ca này, voided_at is null)
chênh lệch = close_cash_counted − kỳ vọng
```
Phí ship / phụ thu nằm trong `orders.total` nên đã có trong doanh thu và tiền mặt kỳ vọng. Doanh thu vẫn = Σ `total` (không trừ tiền trả shipper). Kỳ vọng có thể giảm vì một đơn CK / Nợ shipper ngoài: đúng, vì tiền thật đi ra khỏi két.

**Thống kê ship** (báo cáo ca / ngày / tháng, chỉ chủ; mỗi dòng chỉ hiện khi > 0), tính trên đơn thu trong kỳ:
- Số đơn **quán ship** / **shipper ngoài**.
- **Phí ship** (Σ `ship_fee`, quán ship) và **phụ thu ship ngoài** (Σ `ship_fee`, shipper ngoài).
- **Trả shipper ngoài** (Σ `ship_payout`).
- **Lãi/lỗ ship ngoài** = phụ thu ship ngoài − trả shipper ngoài.

Dòng cũ "trong đó phí ship" đổi thành các dòng trên.

**Khoản chi** (báo cáo ca / ngày / tháng, chỉ chủ): số khoản và tổng chi (không tính khoản đã hủy), cộng theo **nhóm ghi chú giống nhau** (chuẩn hóa như ghi chú gần đây), ví dụ "mua đá · 12 lần · 240.000". Báo cáo ca liệt kê từng khoản, kể cả khoản đã hủy (gạch ngang).

**Hộp** (dùng để tham khảo, không cảnh báo tự động)
```
thực dùng = open_boxes + Σ adjustments(boxes) − close_boxes_left
theo đơn  = Σ trên đơn opened_shift = ca này, status ≠ deleted:
              takeaway: qty × (boxes_takeaway + số topping có extra_box_takeaway)
              dinein:   qty × boxes_dinein
```
**Dĩa**: `thực dùng = open_plates + adj − close_plates_left`; `theo đơn = Σ qty × plates_dinein` (đơn tại chỗ).

Báo cáo liệt kê riêng **bao bì của các đơn đã xóa sau khi ra món**. Đây là tín hiệu rõ nhất của kiểu gian lận "ra món, thu tiền, rồi xóa đơn".

**Telegram báo cáo ca** (ví dụ):
```
🔴 Đóng ca – Lan – Tablet A (05:42–10:15)
Doanh thu: 2.350.000 (TM 1.600.000 · CK 650.000 · Nợ 100.000)
Tiền mặt: đếm 2.080.000 / kỳ vọng 2.100.000 → −20.000
Hộp: dùng 118 / theo đơn 112 → +6
Dĩa: dùng 0 / theo đơn 0
Chi: 3 khoản · 120.000
Xóa: 2 đơn (1 đã ra món) · Đơn còn mở: 1
```
Dòng "Chi" chỉ hiện khi có khoản chi.

---

## 6. Telegram & nhật ký

Gửi vào **một nhóm Telegram**, đồng thời lưu `audit_log` và xem được trong app (lọc theo loại / nhân viên / ngày).

| Sự kiện | Báo ngay |
|---|---|
| Tablet đăng nhập; vào chế độ chủ trên tablet | ✅ |
| Mở ca; đóng ca (kèm báo cáo) | ✅ |
| Xóa đơn | ✅ |
| Đơn ship mới; đổi địa chỉ / khách / kiểu ship / tiền trả shipper của đơn ship (tin ghi kiểu ship, phí ship hoặc phụ thu, tiền trả shipper) | ✅ |
| Ghi nợ; thu nợ | ✅ |
| Ghi / hủy / chủ sửa khoản chi (mục 4.9): `💸 Chi 20.000 – mua đá · Lan · Tablet A`, `↩️ Hủy chi 20.000 – mua đá · Lan` (chủ hủy thì ghi "(chủ)"), chủ sửa thì trước → sau | ✅ |
| Chủ sửa đơn đã thanh toán | ✅ |
| Phát hiện lỗ hổng `device_seq` | ✅ |
| Sửa món trong đơn đang mở | chỉ log |
| Báo hết món / bán lại (mục 4.8) | chỉ log |
| In / in lại / in lỗi phiếu bếp, bill; đổi mẫu in | chỉ log (mục 12) |
| Tổng kết ngày (giờ chủ đặt), có tổng chi | ✅ theo lịch (`pg_cron`) |

Mỗi tin có link mở thẳng chi tiết trong app chủ.

---

## 7. Màn hình

### Tablet (chế độ bán hàng)
1. **Đăng nhập**: đăng nhập chủ → chọn quầy (chỉ một lần).
2. **Mở ca**: danh sách tên nhân viên → Mở ca.
3. **Hàng đợi** (màn hình chính): hai nhóm đơn, nút lớn **+ Đơn mới**, menu phụ: Thu nợ · Chi tiền · Đóng ca · Chế độ chủ.
4. **Đơn**: tab điểm bán, combo, món, topping, Tại chỗ/Mang về, nhãn → Lưu / Đã ra món / Thanh toán / Xóa; nút **Báo hết món** (mục 4.8).
5. **Thanh toán**: TM / CK / Ghi nợ.
6. **Thu nợ**.
7. **Chi tiền** (mục 4.9).
8. **Đóng ca**: các ô đếm → Xác nhận; màn xác nhận hiện lại số đã nhập dạng đầy đủ ("2.080.000đ"), vẫn không hiện kỳ vọng.

**Nhập theo nghìn** (`MoneyInput`, mọi ô tiền ở tablet và chế độ chủ: tiền khách đưa, đếm tiền đóng ca, thu nợ, khoản chi, bổ sung giữa ca và sổ lương khi đang chọn loại tiền, giá món / topping, lương một ngày, tiền lẻ đầu ca): gõ `50` = 50.000đ; ô hiện phần nghìn có dấu chấm (`1.500`) và đuôi `.000đ` cố định màu xám; không nhập được số lẻ dưới 1.000.

In ấn (mục 12): trạng thái máy in + "Kết nối lại" trên hàng đợi, nút "In lại phiếu bếp" trên thẻ đơn, báo đỏ khi in lỗi.

Thiết kế: nút ≥ 56px, chữ to, tối đa 2–3 chạm cho một đơn combo, hiện trạng thái kết nối (đã kết nối / đang kết nối / mất kết nối; mất kết nối thì có dải báo đỏ).

### Chế độ chủ (vào bằng mật khẩu chủ trên bất kỳ máy nào đã chọn quầy; giao diện tối ưu cho điện thoại)
1. **Tổng quan** (realtime): doanh thu hôm nay theo điểm; các ca đang mở; đơn đang chờ lâu.
2. **Ca**: danh sách ca → chi tiết đối soát (mục 5), đơn của ca, bổ sung hộp/dĩa/tiền giữa ca, khoản chi (ghi / sửa / hủy, mục 4.9).
3. **Đơn**: lọc theo ngày/điểm/nhân viên/hình thức/trạng thái (bao gồm đã xóa); sửa đơn đã thanh toán. Dòng đơn ship hiện kiểu ship (badge "Ship ngoài · trả 10k" như hàng đợi); chi tiết đơn có dòng phí ship / phụ thu và "Trả shipper".
4. **Báo cáo**: doanh thu theo ngày/điểm/ca/nhân viên; tỷ lệ TM/CK/Nợ theo nhân viên; **tổng CK theo ngày/điểm** để đối chiếu app ngân hàng; món bán chạy; số lần sửa/xóa theo nhân viên; **thống kê ship** và **khoản chi theo ghi chú** (mục 5).
5. **Sổ nợ**: khách, dư nợ, lịch sử; **chuyển khoản nợ** sang khách khác; ghi thu nợ.
6. **Nhật ký**.
7. **Lương** (theo tháng, **chỉ tính theo ngày**, không tính theo giờ): ngày công = số ngày nhân viên có mở ca (giờ VN, mở nhiều ca trong ngày vẫn là 1 ngày; ca tính vào tháng của ngày mở ca) + ngày chủ đánh "có làm" trên lịch (không trùng ngày có ca) ± ngày công chủ chỉnh (khi nhân viên làm mà không mở ca, hoặc mở ca nhầm). Lương tháng = ngày công × lương một ngày + thưởng − trừ; còn phải trả = lương tháng − ứng − đã trả. Sinh nhật trong tháng. Lịch tháng của từng nhân viên: ngày có mở ca (tổng giờ), bấm ngày để xem ca hoặc đánh dấu "nghỉ" / "có làm" kèm lý do không bắt buộc (đổi qua lại / bỏ được; nghỉ không đổi lương, có làm +1 công; đánh trước được cho ngày sắp tới).
8. **Cài đặt**: menu / món / topping (cờ "thêm hộp") / combo / giá (có lịch sử), nhân viên (SĐT, CCCD, sinh nhật, lương một ngày), điểm bán, hồ sơ tablet + mặc định đầu ca + 3 công tắc in tự động, **mẫu in** (xem trước, in thử — mục 12.5), Telegram, ngưỡng màu chờ, giờ tổng kết ngày, mật khẩu.

---

## 8. Thứ tự xây dựng Đợt 1

Mỗi bước chỉ được tính là **xong** khi các test ghi trong ngoặc (xem mục 10) đã pass.

1. Khởi tạo dự án (Vite + PWA + Tailwind), dựng sẵn khung Vitest, Cypress, Supabase local, Telegram mock; Supabase schema + RLS + seed. *(chạy được `npm run test:all` với test mẫu)*
2. Auth chủ, kích hoạt tablet, vai trò `tablet`, chế độ chủ trên tablet. *(10.3 RLS; E2E A1–A5, E27)*
3. Lớp dữ liệu tablet: RPC idempotent `sync_push`, server cấp mã đơn / `device_seq`, Realtime (`live_pulse`). *(unit `src/pos`; 10.3 idempotent + nhiều máy)* — ban đầu là lớp offline (Dexie + outbox), đã thay bằng realtime.
4. Cài đặt của chủ: menu/món/topping/combo/giá, nhân viên, điểm bán, hồ sơ tablet. *(unit pricing; E2E G32, G37)*
5. Mở ca → tạo/sửa/xóa đơn → hàng đợi → ra món → thanh toán. *(unit pricing/packaging/cash/orderCode/queue; E2E B6–B9, C10–C16)*
6. Ghi nợ, thu nợ, sổ nợ (chuyển nợ). *(unit debt; E2E D17–D20)*
7. Đóng ca, đếm mù, đối soát server-side. *(unit + SQL reconcile dùng chung bộ dữ liệu mẫu; E2E E23, E25)*
8. Audit log + Telegram + tổng kết ngày. *(snapshot format; E2E E21, E22, H38)*
9. Dashboard & báo cáo của chủ, sửa đơn đã thanh toán + tính lại ca. *(E2E E24, G33–G36)*
10. Chạy toàn bộ E2E nhiều máy / mất kết nối (F28–F31) và gian lận (E21–E27); thử trên tablet thật theo checklist: mất mạng, ghim màn hình, tốc độ.

## 9. Đợt 2
Sơ đồ bàn (tùy chọn theo điểm bán), ~~in bill Bluetooth 58mm~~ (đã chốt thiết kế, xem **mục 12**), **gộp khách nợ**, báo cáo nâng cao (thời gian ra món trung bình, so sánh nhân viên).

---

## 10. Kiểm thử

Mục tiêu: **mọi quy tắc chống gian lận đều có test chứng minh**, không chỉ test "chạy được". Mỗi bước trong mục 8 chỉ xong khi test của bước đó pass.

### 10.1 Công cụ & môi trường

| Tầng | Công cụ | Chạy trên |
|---|---|---|
| Unit (logic thuần) | **Vitest** + `fake-indexeddb` | Node, không cần mạng |
| Unit component | Vitest + **React Testing Library** | jsdom |
| Database / RLS / RPC | Vitest gọi **Supabase local** (`supabase start`, Docker) | Postgres thật, reset + seed mỗi file test |
| E2E | **Cypress** | App build `vite preview` + Supabase local + **Telegram mock** |

- **Telegram mock**: Edge Function đọc `TELEGRAM_API_BASE` từ env. Khi test, biến này trỏ tới một server mock nhỏ, server này lưu lại mọi tin nhận được và có endpoint `GET /__messages` để test kiểm tra nội dung tin.
- **Seed cố định** (`supabase/seed.sql`): 2 hồ sơ tablet (A: Xôi A + Cơm gà, B: Xôi B), 3 nhân viên, menu Xôi + Cơm gà có đủ món, topping (gồm topping có cờ "thêm hộp"), combo, 2 khách nợ có sẵn.
- **Viewport**: tablet `1280×800` (bán hàng) và điện thoại `390×844` (chủ).
- **Thời gian**: dùng `cy.clock()` / `vi.useFakeTimers()` cho đồng hồ chờ, tự thoát chế độ chủ sau 2 phút, tổng kết ngày.
- **Selector**: chỉ dùng `data-testid`, không dùng text tiếng Việt hay class CSS.
- **Lệnh**:
  - `npm run test` để chạy unit + component.
  - `npm run test:db` để chạy test DB (cần Supabase local).
  - `npm run test:e2e` để chạy Cypress headless.
  - `npm run test:all` để chạy cả ba.
- **Ngưỡng coverage** (unit, thư mục `src/domain` và `src/sync`): ≥ 90% dòng và nhánh. Coverage chỉ dùng để phát hiện chỗ chưa test, test mới là bằng chứng.

### 10.2 Unit test (Vitest)

Toàn bộ logic nghiệp vụ phía client nằm trong `src/domain/` dưới dạng hàm thuần, để test không cần UI.

**Giỏ hàng & giá** (`domain/pricing`)
- Tổng đơn = Σ (giá món + Σ giá topping) × số lượng. Combo = đúng tổng các thành phần.
- Giá trong đơn là ảnh chụp: đổi giá menu sau khi tạo đơn không làm đổi `unit_price_snap`.
- Món hoặc topping đã ngừng bán (`active = false`) không xuất hiện trong lưới chọn.
- Số lượng 0 hoặc âm bị từ chối.

**Bao bì** (`domain/packaging`)
- Xôi mang về và xôi tại chỗ: mỗi phần 1 hộp.
- Cơm mang về: 1 hộp, cộng 1 hộp cho mỗi topping có cờ `extra_box_takeaway`. Có test cho trường hợp 2 topping có cờ.
- Cơm tại chỗ: 1 dĩa, 0 hộp, kể cả khi có topping gắn cờ.
- Số lượng > 1 được nhân đúng.

**Tiền thối** (`domain/cash`)
- Các nút mệnh giá nhanh chỉ hiện mệnh giá ≥ tổng đơn. "Khách đưa" nhỏ hơn tổng thì không cho xác nhận.

**Mã đơn** (`domain/orderCode`)
- Dạng 1 chữ + 2 số, ví dụ `A30`, `F15`. Chữ đầu không có `I L O` ⇒ 23 × 100 = 2.300 mã mỗi ngày cho mỗi hồ sơ tablet. Đơn cũ (trước 20/11/2026) giữ mã 3 ký tự cũ.
- Không trùng với các mã đã dùng trong ngày của tablet. Có test sinh 2.000 mã liên tiếp, không mã nào trùng.
- Không suy ra được số thứ tự đơn: dùng hàm sinh ngẫu nhiên có seed để kiểm tra.

**Hàng đợi** (`domain/queue`)
- Xếp theo `created_at` tăng dần, nhóm "Chờ ra món" trước nhóm "Chờ thanh toán".
- Số thứ tự trong hàng đợi đánh lại liên tục 1, 2, 3… khi có đơn rời hàng.
- Màu theo thời gian chờ: < 5 phút thường, ≥ 5 phút vàng, ≥ 10 phút đỏ. Ngưỡng lấy từ cài đặt. Đơn đã ra món không đổi màu.

**Đối soát** (`domain/reconcile`, dùng chung công thức với hàm SQL, xem 10.3)
- Tiền mặt kỳ vọng tính đủ: tiền lẻ đầu ca, tiền chủ bổ sung, đơn trả tiền mặt **theo ca thu**, tiền mặt thu nợ; trừ trả shipper và khoản chi chưa hủy.
- Không tính: đơn chuyển khoản, đơn ghi nợ, đơn đã xóa, đơn mở ở ca này nhưng thu ở ca khác.
- Hộp và dĩa tính **theo ca mở đơn**, bỏ qua đơn đã xóa. Danh sách "bao bì của đơn bị xóa sau khi ra món" chỉ gồm đơn có `served_at` trước thời điểm xóa.
- Chủ sửa đơn đã thanh toán (ví dụ đổi tiền mặt thành chuyển khoản) thì kết quả đối soát tính lại phải thay đổi đúng.

**Sổ nợ** (`domain/debt`)
- Dư nợ = tổng các đơn ghi nợ − tổng tiền đã trả.
- Chuyển một khoản nợ sang khách khác: tổng nợ toàn hệ thống không đổi.
- Gợi ý khách: tìm không phân biệt dấu ("dung" khớp "Dũng"), khớp cả phần mô tả, khách đã bị gộp vào người khác không hiện.

**Lớp realtime** (`src/pos`, server giả trong bộ nhớ `src/test-utils/fakeServer.ts`)
- Thao tác chỉ xong khi server trả lời; kết quả (đơn / ca) vào hàng đợi ngay. Mất mạng ⇒ báo lỗi, không mất đơn đang soạn.
- Lỗi mạng ⇒ gửi lại cùng `op_id`; mất phản hồi rồi bấm lại đúng thao tác đó ⇒ dùng lại `op_id` (không tạo đơn / thu tiền hai lần).
- Server báo thay đổi ⇒ tải lại đúng phần đổi (ca + đơn hoặc danh mục); kênh realtime rớt ⇒ tải lại khi nối lại, khi có mạng, khi quay lại màn hình và định kỳ.
- Kết quả tải về trễ hơn một thao tác ghi thì bị bỏ và tải lại (không đè dữ liệu mới bằng dữ liệu cũ).
- Máy đang chạy bản offline cũ: hồ sơ kích hoạt được chuyển sang, thao tác còn kẹt trong IndexedDB được gửi nốt rồi xóa (`legacy.ts`).

**Định dạng Telegram** (`supabase/functions/_shared/format`)
- Snapshot test cho từng loại tin: mở ca, đóng ca, xóa đơn, ghi nợ, thu nợ, chủ sửa đơn, lỗ hổng số đơn, tablet đăng nhập, vào chế độ chủ, tổng kết ngày.
- Tiền định dạng kiểu `1.600.000`. Thao tác đồng bộ trễ (chỉ còn ở thao tác cũ của bản offline) thì tin hiện cả "thời điểm thực hiện" và "thời điểm đồng bộ".

### 10.3 Test database / RLS / RPC (Vitest + Supabase local)

Đây là tầng chứng minh nhân viên **không thể** lấy được doanh thu, kể cả khi gọi API trực tiếp. Mỗi test đăng nhập bằng đúng vai trò cần kiểm tra.

**Vai trò `tablet` KHÔNG được:**
- Đọc đơn `paid` hoặc `deleted`, đọc `shifts` đã đóng, đọc `audit_log`, `shift_adjustments`, `price_history`, `settings`.
- Đọc đơn của hồ sơ tablet khác.
- Sửa giá (`products`, `toppings`, `combos`), sửa `staff`, `tablet_profiles`.
- Sửa đơn đã `paid` (cả qua `UPDATE` trực tiếp lẫn qua RPC).
- Hard delete bất kỳ bảng nào.
- Gửi `total` sai: server tự tính lại tổng từ giá menu hiện hành và từ chối nếu không khớp.
- Đọc số kỳ vọng hay chênh lệch của ca vừa đóng (RPC đóng ca chỉ trả về `ok`).

**Vai trò `tablet` ĐƯỢC:** đọc menu, nhân viên, danh sách khách và dư nợ; tạo, sửa, xóa mềm đơn đang mở của hồ sơ tablet mình; mở và đóng ca; ghi thu nợ; ghi / hủy khoản chi của ca đang mở của quầy mình, đọc khoản chi của ca đó và ghi chú gần đây. **Không** đọc khoản chi của ca đã đóng / quầy khác, không hủy khoản chủ ghi, không sửa khoản chi.

**Vai trò chủ:** đọc và sửa tất cả; sửa đơn đã thanh toán thì có log trước/sau và đặt `owner_edited = true`.

**RPC & trigger:**
- Gửi lại cùng một RPC đồng bộ hai lần thì chỉ có một bản ghi.
- Mỗi thay đổi trên đơn sinh đúng một dòng `audit_log`, có `before` và `after`.
- Server cấp `device_seq` và mã đơn (bỏ qua số / mã máy gửi lên): hai máy cùng hồ sơ tạo đơn cùng lúc ⇒ số liên tiếp, mã khác nhau, không lỗ hổng.
- Hai máy cùng hồ sơ: chung một ca; máy này thanh toán thì máy kia thu lại bị từ chối; máy nghe Realtime thấy đơn mới và thấy đơn biến mất khi được thanh toán ở máy khác. Tablet chỉ đọc được `live_pulse` của chính hồ sơ mình + danh mục.
- Hàm đối soát SQL cho **cùng kết quả** với `domain/reconcile` trên cùng một bộ dữ liệu mẫu (bảng dữ liệu kiểm thử dùng chung, đặt trong `tests/fixtures/reconcile-cases.json`).
- Chủ sửa đơn của ca đã đóng thì `recalculated_at` được cập nhật.
- Mỗi tablet chỉ có một ca mở: mở ca thứ hai trên cùng tablet bị từ chối.
- `pg_cron` tổng kết ngày gọi Edge Function với đúng khoảng thời gian (theo múi giờ `Asia/Ho_Chi_Minh`).

### 10.4 Cypress E2E

Mỗi kịch bản bắt đầu bằng `cy.task('db:reset')` để reset và seed lại dữ liệu, kèm `cy.task('telegram:clear')`. Lệnh tùy biến: `cy.activateTablet('A')`, `cy.openShift('Lan')`, `cy.loginOwner()`, `cy.waitLive()`, `cy.telegramMessages()`.

**A. Kích hoạt & phân quyền**
1. Tablet chưa kích hoạt thì mọi đường dẫn đều chuyển về màn hình kích hoạt.
2. Kích hoạt tablet A bằng tài khoản chủ: thấy màn hình chọn nhân viên, Telegram nhận tin "Tablet A đăng nhập".
3. Sau khi kích hoạt, gõ URL trang chủ (`/owner/...`) thì bị yêu cầu nhập mật khẩu.
4. Vào chế độ chủ bằng mật khẩu: Telegram nhận tin. Sau 2 phút không thao tác (`cy.clock`) thì tự trở về màn hình bán hàng.
5. Mở app trên một trình duyệt khác chưa kích hoạt (giả lập điện thoại nhân viên) thì không vào được màn hình bán hàng.

**B. Ca**

6. Mở ca: chỉ cần chọn tên rồi bấm Mở ca. Ca nhận đúng số mặc định của tablet A. Telegram nhận tin "mở ca".
7. Chủ (viewport điện thoại) bổ sung 50 hộp giữa ca: báo cáo ca phản ánh đúng.
8. Đóng ca còn 1 đơn mở: không bị chặn. Ca sau trên cùng tablet vẫn thấy đơn đó và thu tiền được. Báo cáo ghi người mở và người thu.
9. Màn hình sau khi đóng ca chỉ có dòng "Đã đóng ca". Kiểm tra DOM **không chứa** số tiền kỳ vọng hay chênh lệch.

**C. Bán hàng**

10. Bấm combo 1 lần rồi thanh toán tiền mặt "đủ tiền": tối đa 3 chạm từ hàng đợi đến lúc xong đơn.
11. Món + 2 topping, mang về: tổng tiền đúng, nút Tại chỗ/Mang về mặc định đúng theo điểm bán.
12. Chuyển tab Xôi ↔ Cơm gà trong cùng ca: đơn được gắn nhãn điểm bán đúng.
13. Nhân viên không có ô nào để sửa giá hay giảm giá.
14. Hàng đợi: tạo 3 đơn, đơn cũ nhất ở trên. Sau 5 phút đơn chuyển vàng, sau 10 phút chuyển đỏ (`cy.clock`). Bấm "Đã ra món" thì đơn xuống nhóm "Chờ thanh toán".
15. Mã đơn hiển thị đúng dạng 1 chữ + 2 số. Số thứ tự trong hàng đợi đánh lại sau khi thanh toán một đơn.
16. Thanh toán xong, đơn biến mất khỏi tablet. Không có màn hình nào cho xem lại đơn đã thanh toán.

**D. Ghi nợ & thu nợ**

17. Ghi nợ: gõ "dung" thì gợi ý "Dũng (giáo viên)". Chọn khách đó, Telegram nhận tin.
18. Ghi nợ cho tên mới kèm mô tả: hệ thống tự tạo khách mới. SĐT để trống vẫn lưu được.
19. Thu nợ 50.000 tiền mặt: dư nợ giảm đúng, tiền kỳ vọng của ca tăng 50.000.
20. Chủ chuyển khoản nợ từ "Dũng (phường B)" sang "Dũng (giáo viên)": dư nợ của hai khách cập nhật đúng.

**E. Kịch bản gian lận** (mỗi kịch bản phải để lại dấu vết mà chủ thấy được)

21. **Ra món, thu tiền rồi xóa đơn**: tạo đơn, bấm Đã ra món, xóa với lý do "khách bỏ về". Telegram nhận tin có trạng thái "đã ra món". Báo cáo ca liệt kê đơn này trong mục "bao bì của đơn bị xóa sau khi ra món".
22. **Bớt món sau khi ra món**: sửa đơn từ 2 phần xuống 1. Nhật ký có bản trước/sau, báo cáo đếm số lần sửa của nhân viên đó.
23. **Đếm thiếu tiền**: đóng ca nhập ít hơn kỳ vọng 20.000. Telegram báo chênh lệch `−20.000`, nhân viên không thấy.
24. **Ghi chuyển khoản nhưng thực ra nhận tiền mặt**: tổng chuyển khoản trên dashboard chủ cao hơn thực tế, nên số liệu đối soát chuyển khoản theo ngày/điểm hiển thị đúng để chủ so với app ngân hàng.
25. **Dùng hộp không có đơn**: đóng ca khai còn ít hộp hơn số đơn tương ứng. Báo cáo hiện chênh lệch hộp.
26. ~~Xóa dữ liệu tablet trước khi sync~~: không còn áp dụng — tablet không giữ đơn trên máy, server cấp số thứ tự nên không có lỗ hổng số.
27. **Gọi API trực tiếp từ tablet**: dùng `cy.request` với token tablet để đọc đơn đã thanh toán, nhận 0 dòng hoặc 401/403.

**F. Nhiều máy & mất kết nối** (đã có ở test component `TabletFlow.test.tsx` với server giả và test DB `pos-client.test.ts` với Supabase thật)

28. Máy khác cùng hồ sơ mở ca ⇒ máy này tự vào hàng đợi của ca đó; không mở được ca thứ hai.
29. Máy khác tạo / sửa / thanh toán đơn ⇒ hàng đợi và màn đơn / thanh toán đang mở trên máy này cập nhật ngay (đơn đã thanh toán ở máy khác ⇒ về hàng đợi kèm thông báo).
30. Mất mạng: thao tác báo "mất kết nối", đơn đang soạn còn nguyên; có mạng lại bấm lại là lưu, không bị trùng.
31. Mở app lúc mất mạng: báo cần mạng, có nút Thử lại.

**G. Chủ (viewport điện thoại)**

32. Đổi giá món: đơn đang mở trên tablet giữ giá cũ, đơn mới dùng giá mới. Lịch sử giá có bản ghi mới.
33. Sửa đơn đã thanh toán của ca đã đóng: báo cáo ca có nhãn "đã điều chỉnh", số liệu đối soát thay đổi, Telegram nhận tin.
34. Dashboard realtime: tablet thanh toán một đơn thì doanh thu trên điện thoại chủ tăng mà không cần reload.
35. Báo cáo theo nhân viên: tỷ lệ tiền mặt/chuyển khoản/ghi nợ và số lần sửa/xóa khớp với dữ liệu seed.
36. Nhật ký: lọc theo nhân viên và loại sự kiện ra đúng kết quả.
37. Cài đặt hồ sơ tablet: bỏ "Cơm gà" khỏi tablet A thì tab Cơm gà biến mất trên tablet A ngay (realtime).

**H. Tổng kết ngày**

38. Tua đồng hồ hệ thống đến giờ tổng kết (gọi thẳng endpoint cron trong test): Telegram nhận đủ doanh thu theo điểm, hình thức thanh toán, số đơn xóa và chênh lệch của từng ca.

### 10.5 Quy ước

- Mỗi lỗi tìm thấy khi dùng thật phải có **một test tái hiện lỗi đó** trước khi sửa.
- Đổi công thức đối soát thì phải cập nhật `reconcile-cases.json`, và cả test TS lẫn test SQL đều phải pass.
- Cypress chạy ở chế độ headless trong CI. Khi test fail thì lưu ảnh chụp màn hình và video.
- Tạm thời không làm test trên tablet thật bằng công cụ tự động. Việc kiểm tra trên thiết bị thật (ghim màn hình, tốc độ trên máy cũ) là checklist thủ công ở bước 10 của mục 8.

---

## 11. Giả định cần chủ xác nhận
1. **Hồ sơ tablet** (Tablet A/B: điểm bán được phép + số mặc định) có trong Cài đặt. Đây không phải màn quản lý/thu hồi thiết bị.
2. **Giá combo = tổng giá món + topping**, không có giá combo riêng (tránh giảm giá ngầm).
3. **Xóa đơn** bắt chọn lý do 1 chạm (không bắt gõ chữ).
4. Bao bì tính theo **ca mở đơn**, tiền tính theo **ca thu tiền**.
5. Vai trò `tablet` riêng ở tầng dữ liệu, để nhân viên rành kỹ thuật cũng không lấy được doanh thu từ tablet.
6. Giờ tổng kết ngày mặc định **14:30** (sau ca cơm gà), chủ chỉnh được. *(20/11/2026: tạm tắt cron tự gửi tổng kết ngày — chủ xem báo cáo trong app; hàm vẫn giữ để bật lại.)*

---

## 12. In phiếu bếp & bill thanh toán

Chốt thiết kế ngày 2026-11-20. Kế hoạch triển khai: [`docs/plans/in-phieu-bep-va-bill.md`](docs/plans/in-phieu-bep-va-bill.md).

Mục đích: **làm không nhầm, đưa đúng khách** (phiếu bếp) và **bill giấy cho khách** (bill thanh toán). Bill đồng thời chống gian lận theo biển **"Không có bill = miễn phí"**: bill chỉ in được từ đơn đã lưu trên server, nên thu tiền mà không bấm đơn thì không có bill đưa khách.

### 12.1 Nền tảng & máy in
- Tablet quầy chạy **app Android (Capacitor)**. App mở thẳng web trên Vercel, nên push `main` thì tablet vẫn tự cập nhật. Chỉ khi đổi phần native mới phải cài lại APK (cài trực tiếp, không qua Play Store).
- In qua **Bluetooth Classic (SPP)**, lệnh **ESC/POS**, chỉ hỗ trợ **khổ 58mm**. Không yêu cầu máy in hỗ trợ BLE, không cài app trung gian.
- Phiếu được **vẽ thành ảnh đen trắng rộng 384 điểm** rồi gửi lệnh in ảnh, để giữ đúng dấu tiếng Việt và in được chữ to.
- Điện thoại chủ và trình duyệt vẫn dùng PWA, **không in trực tiếp được**. Muốn in thì gửi lệnh in từ xa (12.6).
- **Ghép nối máy in theo từng máy** (lưu trên máy, không lưu theo quầy). Chỉ chọn hoặc đổi máy in trong **chế độ chủ**: Quầy của máy này → Máy in → chọn máy Bluetooth đã ghép → In thử. Nhân viên chỉ thấy trạng thái máy in (đã kết nối hay chưa) và nút "Kết nối lại".

### 12.2 Cài đặt theo quầy (`tablet_profiles`)
Có 3 công tắc. Công tắc **chỉ bật hoặc tắt việc in tự động**. Bấm in tay lúc nào cũng in được.
| Công tắc | Khi bật |
|---|---|
| `auto_print_kitchen` | Tự in phiếu bếp khi tạo đơn |
| `auto_reprint_kitchen_on_edit` | Tự in lại phiếu bếp khi sửa đơn đang mở |
| `auto_print_bill` | Tự in bill khi thanh toán xong |

### 12.3 Phiếu bếp
- Tự in **sau khi server trả mã đơn** (nếu bật công tắc).
- **Sửa đơn** thì in lại nguyên phiếu, có dòng **"ĐÃ SỬA" kèm giờ sửa**, ghi rõ món thêm hoặc bớt (nếu bật công tắc). **Xóa đơn** thì không in.
  - Màn đơn tự lưu từng chạm ⇒ các lần sửa liên tiếp được **gom thành một phiếu** (in sau khi ngừng sửa khoảng 4 giây, hoặc ngay khi thu tiền). Sửa rồi sửa lại như cũ thì không in.
  - Sửa rồi thu tiền ngay: phiếu "ĐÃ SỬA" vẫn in được trong 10 phút sau khi thanh toán.
- Nội dung: **mã đơn chữ to**, số thứ tự hàng đợi, Tại chỗ/Mang về, nhãn hoặc bàn, giờ tạo, món kèm topping và số lượng. **Không in giá.**
- Nút **"In lại phiếu bếp"** trên thẻ đơn **luôn hiện** khi đơn còn trong hàng đợi, bất kể công tắc. Chủ in lại được từ xa.

### 12.4 Bill thanh toán
- Tự in **sau khi thanh toán thành công**, kể cả đơn ghi nợ (nếu bật công tắc).
- Nội dung: tên quán, tên điểm bán, SĐT, địa chỉ, **mã đơn chữ to**, giờ thanh toán, Tại chỗ/Mang về, nhãn hoặc bàn, các dòng món (số lượng, đơn giá, thành tiền), dòng **Phí ship** (khi > 0), **Tổng**, "Cảm ơn quý khách", dòng chân trang tự nhập, "Không có bill = miễn phí".
- Đơn shipper ngoài: phụ thu in giống hệt dòng **Phí ship** (với khách hai kiểu như nhau).
- **Không in**: hình thức thanh toán, tiền khách đưa và tiền thối, thông tin nợ, tên nhân viên, kiểu ship, tiền trả shipper.
- **Tablet không có nút in hay in lại bill.** Bill in lỗi thì chỉ ghi lại (12.7). Server cũng chặn: tablet chỉ tạo được **một** lệnh bill cho mỗi đơn, trong 10 phút sau khi thanh toán (gọi API trực tiếp cũng không in lại được bill cũ). Chỉ **chủ in lại từ xa**. Bản in lại **giống hệt bản gốc** (không đóng dấu "bản in lại"), theo nội dung hiện tại của đơn (kể cả khi chủ đã sửa đơn sau thanh toán) và mẫu hiện tại.

### 12.5 Mẫu in (`print_template`, một mẫu chung)
Chủ chỉnh trong **Cài đặt → Mẫu in**:
- **Bật/tắt từng dòng**:
  - Bill: tên quán, điểm bán, SĐT, địa chỉ, giờ, Tại chỗ/Mang về, nhãn hoặc bàn, đơn giá, "Cảm ơn quý khách", "Không có bill = miễn phí".
  - Phiếu bếp: số thứ tự hàng đợi, Tại chỗ/Mang về, nhãn hoặc bàn, giờ tạo, topping.
- **Chữ tự nhập**: tên quán, SĐT, địa chỉ, 1–3 dòng chân trang. Tên điểm bán tự lấy theo điểm bán của đơn.
- **Cỡ chữ mã đơn**: to hoặc rất to.
- **Luôn in, không tắt được**: mã đơn, món kèm số lượng, Tổng (trên bill), "ĐÃ SỬA" kèm giờ sửa (trên phiếu bếp).
- **Xem trước**: hiện chính ảnh sẽ gửi sang máy in, vẽ bằng một đơn mẫu, đổi ngay khi chỉnh. Có nút **"In thử"**: trên tablet có máy in thì in luôn, trên điện thoại thì gửi lệnh in thử (`kind = test`) tới một quầy.
- Mỗi lần đổi mẫu đều ghi `audit_log`.

### 12.6 In từ xa (`print_jobs`)
- Ở chi tiết đơn trong app chủ có nút **"In lại bill"** và **"In lại phiếu bếp"**.
- Mặc định gửi tới **quầy đã bán đơn**, chủ đổi được quầy.
- Tablet nghe Realtime. **Máy đầu tiên** thuộc quầy đó đang mở app và có máy in kết nối sẽ **nhận lệnh**. Server khóa lệnh (`pending → claimed`, nguyên tử) để chỉ một máy in.
- Chủ thấy trạng thái theo thời gian thực: *đang chờ → đã in* hoặc *lỗi (kèm lý do)*.
- Sau **2 phút** không có máy nào nhận thì lệnh **hết hạn** (`expired`), chủ được báo "Không có máy in nào sẵn sàng". Lệnh **không bao giờ in muộn**.
- Lệnh in tại chỗ (tự in, nhân viên bấm in lại phiếu bếp) cũng ghi vào `print_jobs` (máy tự nhận luôn), để mọi lần in nằm chung một chỗ.
- Nội dung in do server dựng từ đơn hiện tại lúc nhận lệnh (`print_doc`, kèm mẫu in hiện tại). Tablet không đọc được đơn đã thanh toán, nhưng nhận được nội dung bill qua lệnh in của chính quầy mình.
- Máy nhận lệnh rồi không báo kết quả sau 5 phút ⇒ server ghi lỗi "Máy in không báo kết quả".

### 12.7 Lỗi & theo dõi
- Máy in lỗi, hết giấy hoặc mất kết nối thì **không bao giờ chặn** tạo đơn hay thanh toán. Tablet hiện báo đỏ. Với phiếu bếp thì có nút "In lại".
- Mọi lần in, in lại, in lỗi đều ghi `print_jobs` và `audit_log`, xem được trong Nhật ký. **Không báo Telegram.**
- **Báo cáo ca** có dòng **"bill in lỗi / không in"**, tức số đơn thanh toán trong ca mà không có lệnh bill nào in thành công, kèm danh sách mã đơn.

### 12.8 App Android
- Plugin Java `LaodaiPrinter` (Bluetooth Classic SPP, RFCOMM `00001101-…`): chỉ liệt kê máy **đã ghép đôi** trong Cài đặt Android (không quét) ⇒ Android 12+ chỉ hỏi quyền "Thiết bị ở gần" (`BLUETOOTH_CONNECT`), Android ≤ 11 dùng `BLUETOOTH` có sẵn khi cài.
- Màn hình luôn sáng trong app; ghim màn hình dùng tính năng của Android như trước.
- Web nhận biết app native bằng `Capacitor.isNativePlatform()` + plugin có mặt; trình duyệt / PWA ⇒ không có máy in, không tự tạo lệnh in.

### 12.9 Chưa làm
Phiếu tạm tính có VietQR chuyển khoản, bill điện tử hoặc chia sẻ online, phiếu thu nợ, khổ 80mm, máy in LAN/WiFi.
