# Laodai POS – Design system (MASTER)

Nguồn: skill [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) – nhóm sản phẩm
*Restaurant/Food Service* + *Food Delivery* (bảng màu cam "appetizing"), cặp font *Vietnamese Friendly*,
quy tắc UX ưu tiên 1→6 (tương phản, vùng chạm, icon SVG thay emoji, token ngữ nghĩa).

Mã nguồn token: `src/index.css` (biến CSS) + `tailwind.config.js` (tên màu Tailwind). **Không dùng màu Tailwind thô
(`stone-*`, `amber-*`…) trong component** – luôn dùng token bên dưới.

## Màu

Bảng màu theo **UI kit Makaryo** (Figma file "Laodai POS – UI hiện tại", page *Makaryo – Tablet (1180×820)* và *Makaryo – Mobile (390×844)*,
bộ biến "Laodai × Makaryo").

| Token | Giá trị | Dùng cho |
|---|---|---|
| `canvas` | #F5F5F5 | nền trang |
| `surface` / `surface-muted` / `surface-sunken` | #FFF / #FAFAFA / #F0F0F0 | thẻ, ô minh họa món, nền nhóm phân đoạn |
| `line` / `line-strong` | #E7E7E7 / #D1D1D1 | viền thẻ / viền nút, ô nhập |
| `ink` / `ink-muted` / `ink-subtle` | #1C1C1C / #4F4F4F / #6D6D6D | chữ chính / phụ / chú thích (đều ≥ 4.5:1 trên trắng) |
| `brand` | #FE4E10 (Orange/500) | viền đang chọn, icon, nền logo, menu đang mở (vòng icon) |
| `brand-strong` / `brand-deep` | #EF3408 / #C62208 | nền nút chính (chữ trắng đậm ≥ 17px) / hover, chữ trên nền cam nhạt |
| `brand-soft` / `brand-tint` / `brand-line` / `brand-light` | #FFF4ED / #FFE6D4 / #FFCAA8 / #FFA471 | nền ô đang chọn, combo, "Cần thu" / ô icon / viền combo / icon minh họa món |
| `success*` | #16A34A … | tiền mặt, Đã thu, Đã ra món, Tiền thối |
| `info*` | #2563EB … | chuyển khoản, Mang về / Tại chỗ |
| `warning*` | #CA8A04 / #A16207 … | ghi nợ, đơn chờ ≥ 5 phút, nhãn điểm bán |
| `danger*` | #DC2626 / #B91C1C … | xóa, lỗi, đơn chờ ≥ 10 phút |

Hình thức thanh toán luôn cùng màu: **TM = success, CK = info, Nợ = warning**.

Lưu ý tương phản: nút cam `brand-strong` + chữ trắng chỉ ≈ 3.9:1 ⇒ chỉ dùng cho chữ đậm cỡ lớn (nút), không dùng cho chữ thường cỡ nhỏ.

## Bố cục (Makaryo)

- **Tablet (md+)**: sidebar trắng 240px (tên quầy, thẻ "Ca đang mở", menu Hàng đợi / Đơn mới / Thu nợ / Đóng ca, Chế độ chủ, kết nối);
  thanh trên 76px mỗi màn. Gọi món / Thanh toán chiếm trọn màn hình (giỏ là cột trắng 380–390px bên phải).
- **Điện thoại**: hàng đợi có header một dòng + thanh đáy (Thu nợ · Đóng ca · Đơn mới); các màn khác có header riêng (nút quay lại + tiêu đề).
  Giỏ là tấm trắng bo góc ở đáy, bảng chọn là tấm trượt từ đáy lên.
- Phần tử có `data-testid` chỉ có **một** bản trong DOM; đổi vị trí theo cỡ màn bằng CSS (test chạy ở 1280×800 và 390×844).

## Chữ

- Font: **Be Vietnam Pro** 400/500/600/700 (gói `@fontsource/be-vietnam-pro`, đóng gói cùng app ⇒ chạy offline, PWA precache `woff2`).
- Toàn app `font-variant-numeric: tabular-nums` (số tiền thẳng cột). Cỡ chữ thân ≥ 16px, nút 18px.
- Nhãn nhóm: lớp `.eyebrow` (chữ nhỏ in hoa, `ink-subtle`).

## Thành phần (`@layer components` trong `src/index.css`)

| Lớp | Ý nghĩa |
|---|---|
| `.btn` | nút cơ bản: ≥ 56px, bo 12px, chuyển màu 150ms, `disabled` mờ 40% |
| `.btn-primary` / `.btn-success` / `.btn-danger` / `.btn-dark` | hành động chính / thu tiền / xóa, ghi nợ / trung tính mạnh |
| `.btn-secondary` / `.btn-danger-outline` / `.btn-brand-outline` | hành động phụ |
| `.btn-choice` | ô chọn (nhân viên, topping, tiền khách đưa) – đang chọn: nền cam nhạt, viền + chữ cam (`aria-pressed` / `aria-selected`) |
| `.btn-segment` + `.segment-group` | nút phân đoạn (Tại chỗ / Mang về / Ship): đang chọn = nền trắng, viền + chữ cam |
| `.card` | thẻ trắng bo 16px, viền `line`, phẳng (không bóng) |
| `.icon-tile` | ô icon bo góc / tròn (thêm `rounded-full`) |
| `.input`, `.field-label` | ô nhập (focus: viền cam + vòng 4px) |
| `.badge`, `.dot` | nhãn tròn, chấm trạng thái |

Trạng thái chọn **luôn** đi kèm `aria-pressed` / `aria-selected` (không chỉ dựa vào màu).

## Icon

`lucide-react`, nét 2px, cỡ 20px (h-5) trong nút, 24px cho nút lớn. Icon cạnh chữ luôn `aria-hidden`.
Không dùng emoji làm icon trong UI (tin Telegram thì vẫn giữ emoji).

## Không làm

- Màu Tailwind thô trong component; chữ trắng cỡ nhỏ trên nền cam; chữ xám nhạt hơn `ink-subtle`.
- `active:scale` (giật bố cục) – dùng đổi màu nền khi bấm.
- Đổi nội dung chữ của phần tử có `data-testid` mà test so sánh chính xác (`have.text`).
