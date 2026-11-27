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

## Sao lưu hằng đêm

Gói Supabase miễn phí không có khôi phục theo thời điểm, nên app tự sao lưu:

- **03:00 giờ VN** pg_cron gọi Edge Function `nightly-backup`. Function chụp mọi bảng `public` (trừ dữ liệu tạm
  `live_pulse`, `print_jobs`, `sync_ops` và `owner_device_pins` gắn với tài khoản auth) thành
  `laodai-YYYY-MM-DD.zip` (mỗi bảng một file JSON + `manifest.json`: số dòng, migration của DB nguồn) rồi **gửi file
  vào chat Telegram** `settings.backup_chat_id`, để trống thì gửi vào `settings.telegram_chat_id`.
- **03:30** chưa gửi được thì thử lại. **04:00** vẫn chưa được thì gửi tin "⚠️ Sao lưu đêm … không gửi được" vào chat
  chính. Mỗi lần chạy ghi một dòng `backup_runs` (trạng thái, dung lượng, lỗi).
- File nằm trong chat Telegram, không lưu trên Supabase. Telegram giới hạn file 50MB; quá thì function báo lỗi.
- Không có trong bản sao lưu: tài khoản đăng nhập (auth: chủ, tablet), PIN chủ, `private.config`, secret của Edge Function.

Chạy tay (vd sau khi deploy):

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/nightly-backup
```

Mỗi ngày chỉ gửi một bản thành công; gọi lại sẽ trả `already_sent`.

### Khôi phục từ bản sao lưu

Chỉ khôi phục vào **một dự án Supabase mới, chưa có dữ liệu**. Script từ chối chạy nếu DB đích đã có đơn / ca / khách /
nhân viên / món / điểm bán.

1. Tải file `laodai-YYYY-MM-DD.zip` mới nhất từ chat Telegram.
2. Tạo dự án Supabase mới (region Singapore), lấy connection string ở Project Settings → Database.
3. Áp migration và nạp dữ liệu (một transaction; số dòng lệch manifest thì hủy, DB vẫn trống):

   ```bash
   DATABASE_URL='postgresql://postgres:<mật khẩu>@db.<ref>.supabase.co:5432/postgres' npm run db:restore -- laodai-2026-11-23.zip
   ```

   Script tự chạy `supabase db push` trước; thêm `--skip-migrations` nếu đã áp migration. Trigger tắt trong lúc nạp
   (không sinh nhật ký / tin Telegram), tin chưa gửi ở dự án cũ không gửi lại, tablet bị bỏ liên kết tài khoản cũ.
4. Đặt URL Edge Functions cho pg_net:
   `insert into private.config (key, value) values ('functions_url', 'https://<ref>.supabase.co/functions/v1');`
5. Deploy các Edge Function (`telegram-dispatch`, `activate-tablet`, `owner-pin-unlock`, `nightly-backup`, cùng
   `verify_jwt = false`) và đặt secret `TELEGRAM_BOT_TOKEN` (`supabase secrets set`).
6. Tạo lại tài khoản chủ: Authentication → Add user, rồi
   `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"owner"}' where email = '<email chủ>';`
7. Vercel: đổi `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sang dự án mới rồi redeploy.
8. Chủ đăng nhập, kích hoạt lại từng tablet, đặt lại PIN chủ trên máy.

`npm run test:db` có test sao lưu → zip → nạp vào DB trống rồi so từng dòng của mọi bảng (`tests/db/backup.test.ts`).

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
supabase/functions    `telegram-dispatch`, `activate-tablet`, `owner-pin-unlock` (vào chế độ chủ bằng PIN), `nightly-backup` (sao lưu hằng đêm),
                      `_shared/format.ts` (định dạng tin), `_shared/backup.ts` (đọc bản chụp)
scripts/db-restore.mjs  khôi phục DB từ file sao lưu (`scripts/restore/lib.mjs`)
tests/fixtures/reconcile-cases.json  bộ dữ liệu ghim kết quả đối soát của `reconcile_shift` (test SQL)
tests/db/          test DB (Vitest + Supabase local); `pos-client.test.ts` chạy tablet realtime thật: hai máy cùng hồ sơ, Realtime, idempotent
tests/telegram-mock/  server giả Telegram (`GET /__messages`)
cypress/           E2E
```
