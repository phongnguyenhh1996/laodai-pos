# Laodai POS

POS cá nhân (PWA) cho quán xôi / cơm gà. Đặc tả: [SPEC.md](SPEC.md).

## Chạy local

Cần Docker đang chạy.

```bash
npm install
TELEGRAM_API_BASE=http://host.docker.internal:8787 TELEGRAM_BOT_TOKEN=test-token APP_URL=http://localhost:4173 npx supabase start
npx supabase status -o env   # chép API_URL / ANON_KEY / SERVICE_ROLE_KEY / DB_URL vào .env.local (xem .env.example)
npm run dev
```

Tài khoản chủ local (seed): `owner@laodai.test` / `laodai-owner-123`.

## App Android cho tablet quầy (in phiếu bếp + bill, SPEC mục 12)

App Capacitor (`android/`) mở thẳng web production (`capacitor.config.ts` → `server.url`), nên push `main` thì tablet tự cập nhật.
Chỉ khi đổi phần native (plugin máy in `LaodaiPrinterPlugin.java`, quyền, `capacitor.config.ts`) mới phải build + cài lại APK.

Cần Android Studio (Android SDK + JDK 21).

```bash
npm run android:apk          # build web + cap sync + gradlew assembleDebug
```

APK nằm ở `android/app/build/outputs/apk/debug/app-debug.apk`: chép sang tablet rồi mở để cài (bật "Cài ứng dụng không rõ nguồn gốc"),
hoặc `adb install -r` qua cáp. Cài đè bản cũ giữ nguyên dữ liệu (phiên tablet, máy in đã chọn).
Thử với bản local: `CAP_SERVER_URL=http://<ip-máy-dev>:5173 npm run android:apk`.

Trên tablet: ghép đôi máy in trong Cài đặt Android → Bluetooth, rồi trong app vào Chế độ chủ → Quầy của máy này → Máy in → chọn máy → In thử.

## Kiểm thử (mục 10)

| Lệnh | Nội dung |
|---|---|
| `npm test` | Unit + component (Vitest; tablet chạy với server giả trong bộ nhớ `src/test-utils/fakeServer.ts`) |
| `npm run test:coverage` | Như trên, ngưỡng ≥ 90% dòng/nhánh cho `src/domain`, `src/pos` |
| `npm run test:db` | RLS / RPC / đối soát SQL / cron / Telegram qua Edge Function (cần Supabase local; tự bật Telegram mock) |
| `npm run test:e2e` | Cypress headless trên bản build `vite preview` + Telegram mock |
| `npm run test:all` | Cả ba |

## Cấu trúc

```
src/domain/        logic nghiệp vụ thuần (giá, giỏ hàng, bao bì, tiền thối, mã đơn, hàng đợi, đối soát, sổ nợ, mô tả nhật ký,
                   chủ sửa đơn đã thanh toán, tỷ lệ TM/CK/Nợ & đơn chờ lâu cho báo cáo)
src/pos/           tablet realtime (không lưu dữ liệu bán hàng trên máy, nhiều máy dùng chung một hồ sơ được):
                   `backend.ts` (RPC `sync_push`, đọc ca + đơn đang mở, nghe Realtime trên `live_pulse`),
                   `store.ts` (TabletStore: danh mục + ca + đơn đang mở, tải lại khi server báo / có mạng / quay lại màn hình / định kỳ),
                   `ops.ts` (Pos: thao tác bán hàng ghi thẳng lên server, gửi lại an toàn cùng op_id),
                   `catalog.ts` (menu/giá/điểm bán/nhân viên/hồ sơ/khách nợ + dư nợ), `activation.ts` (hồ sơ kích hoạt trong localStorage),
                   `legacy.ts` (chuyển tiếp một lần từ bản offline: gửi nốt outbox IndexedDB cũ rồi xóa)
src/lib/pos.ts     store + Pos của app (chạy từ lúc vào màn bán hàng) + chỉ báo `conn-status`
src/lib/auth.ts    đăng nhập chủ, kích hoạt tablet, chế độ chủ trên tablet (phiên tạm, tự thoát 2 phút)
src/print/         in phiếu (SPEC mục 12): `layout.ts` (phiếu → dòng, hàm thuần), `diff.ts` (món thêm / bớt khi sửa),
                   `render.ts` (canvas 384 điểm → ảnh 1-bit), `escpos.ts` (GS v 0), `printer.ts` (máy in: SPP thật / giả / không có),
                   `service.ts` (tạo / nhận / báo kết quả lệnh `print_jobs`, nghe lệnh từ xa), `native.ts` (cầu nối plugin Capacitor)
src/lib/print.ts   nối in vào bán hàng: tự in theo công tắc quầy, gom phiếu "ĐÃ SỬA", `usePrint()` cho giao diện
src/tablet/        màn bán hàng: mở ca → hàng đợi → tạo / sửa / xóa đơn → thanh toán (TM, CK, ghi nợ) → thu nợ → đóng ca (đếm mù)
src/app|owner      khung app, chế độ chủ; trang đầu = Tổng quan hôm nay (realtime, `owner/live.ts`),
                   `owner/orders/` = Đơn (lọc ngày / điểm / nhân viên / hình thức / trạng thái) + sửa đơn đã thanh toán,
                   `owner/reports/` = Báo cáo (ngày / điểm / ca / nhân viên, đối chiếu chuyển khoản, món bán chạy),
                   `owner/settings/` = Cài đặt, `owner/shifts/` = Ca (đối soát, bổ sung giữa ca),
                   `owner/debts/` = Sổ nợ (dư nợ, lịch sử, chuyển nợ, chủ ghi thu),
                   `owner/log/` = Nhật ký (lọc loại / nhân viên / ngày) + chi tiết đơn (đích link trong tin Telegram)
supabase/migrations   schema, RLS, RPC `sync_push` (server cấp mã đơn / số thứ tự, trả dữ liệu vừa ghi), `live_pulse` (nhịp realtime), `reconcile_shift`, RPC của chủ (`owner_dashboard`, `owner_orders`,
                      `owner_report`, `owner_edit_order`…), cron tổng kết ngày,
                      ràng buộc danh mục (combo cùng menu, hồ sơ tablet trỏ điểm bán có thật, không đổi menu)
supabase/functions    `telegram-dispatch`, `activate-tablet`, `owner-pin-unlock` (vào chế độ chủ bằng PIN), `_shared/format.ts` (định dạng tin)
tests/fixtures/reconcile-cases.json  bộ dữ liệu đối soát dùng chung cho test TS và SQL
tests/db/          test DB (Vitest + Supabase local); `pos-client.test.ts` chạy tablet realtime thật: hai máy cùng hồ sơ, Realtime, idempotent
tests/telegram-mock/  server giả Telegram (`GET /__messages`)
cypress/           E2E
```
