# Laodai POS – Design system (MASTER)

Nguồn: skill [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) – nhóm sản phẩm
*Restaurant/Food Service* + *Food Delivery* (bảng màu cam "appetizing"), cặp font *Vietnamese Friendly*,
quy tắc UX ưu tiên 1→6 (tương phản, vùng chạm, icon SVG thay emoji, token ngữ nghĩa).

Mã nguồn token: `src/index.css` (biến CSS) + `tailwind.config.js` (tên màu Tailwind). **Không dùng màu Tailwind thô
(`stone-*`, `amber-*`…) trong component** – luôn dùng token bên dưới.

## Màu

| Token | Giá trị | Dùng cho |
|---|---|---|
| `canvas` | #F3F5F8 | nền trang |
| `surface` / `surface-muted` / `surface-sunken` | #FFF / #F8FAFC / #EEF2F6 | thẻ, ô trong thẻ, nền segmented |
| `line` / `line-strong` | #E2E8F0 / #CBD5E1 | viền thẻ / viền nút, ô nhập |
| `ink` / `ink-muted` / `ink-subtle` | #0F172A / #475569 / #64748B | chữ chính / phụ / chú thích (đều ≥ 4.5:1 trên trắng) |
| `brand` | #EA580C | viền focus, điểm nhấn (không dùng làm nền chữ trắng) |
| `brand-strong` / `brand-deep` | #C2410C / #9A3412 | nút chính (chữ trắng 5.2:1) / hover, chữ trên nền nhạt |
| `brand-soft` / `brand-line` | #FFF7ED / #FDBA74 | nền combo, "Cần thu", icon menu |
| `success*` | #047857 … | tiền mặt, Đã thu, Đã ra món, ca đang mở |
| `info*` | #2563EB … | chuyển khoản, điểm bán |
| `warning*` | #D97706 / #92400E … | ghi nợ, đơn chờ ≥ 5 phút, xác nhận đóng ca |
| `danger*` | #DC2626 / #B91C1C … | xóa, lỗi, đơn chờ ≥ 10 phút |

Hình thức thanh toán luôn cùng màu: **TM = success, CK = info, Nợ = warning**.

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
| `.btn-choice` | ô chọn (nhân viên, topping, tiền khách đưa) – tự đổi màu theo `aria-pressed` / `aria-selected` |
| `.btn-segment` | nút phân đoạn nền tối khi chọn – theo `aria-pressed` / `aria-selected` |
| `.card` | thẻ trắng bo 16px, viền `line`, bóng `shadow-card` |
| `.input`, `.field-label` | ô nhập (focus: viền cam + vòng 4px) |
| `.badge`, `.dot` | nhãn tròn, chấm trạng thái |

Trạng thái chọn **luôn** đi kèm `aria-pressed` / `aria-selected` (không chỉ dựa vào màu).

## Icon

`lucide-react`, nét 2px, cỡ 20px (h-5) trong nút, 24px cho nút lớn. Icon cạnh chữ luôn `aria-hidden`.
Không dùng emoji làm icon trong UI (tin Telegram thì vẫn giữ emoji).

## Không làm

- Màu Tailwind thô trong component; nền cam #EA580C với chữ trắng; chữ xám nhạt hơn `ink-subtle`.
- `active:scale` (giật bố cục) – dùng đổi màu nền khi bấm.
- Đổi nội dung chữ của phần tử có `data-testid` mà test so sánh chính xác (`have.text`).
