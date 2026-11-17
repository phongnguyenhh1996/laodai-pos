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

## Kiểm thử (mục 10)

| Lệnh | Nội dung |
|---|---|
| `npm test` | Unit + component (Vitest, `fake-indexeddb`) |
| `npm run test:coverage` | Như trên, ngưỡng ≥ 90% dòng/nhánh cho `src/domain`, `src/sync` |
| `npm run test:db` | RLS / RPC / đối soát SQL / cron / Telegram qua Edge Function (cần Supabase local; tự bật Telegram mock) |
| `npm run test:e2e` | Cypress headless trên bản build `vite preview` + Telegram mock |
| `npm run test:all` | Cả ba |

## Cấu trúc

```
src/domain/        logic nghiệp vụ thuần (giá, bao bì, tiền thối, mã đơn, hàng đợi, đối soát, sổ nợ)
src/sync/          offline-first: Dexie, outbox, device_seq, thao tác tablet, engine đồng bộ
src/lib/auth.ts    đăng nhập chủ, kích hoạt tablet, chế độ chủ trên tablet (phiên tạm, tự thoát 2 phút)
src/app|tablet|owner  giao diện (đang dựng theo mục 8)
supabase/migrations   schema, RLS, RPC `sync_push`, `reconcile_shift`, RPC của chủ, cron tổng kết ngày
supabase/functions    `telegram-dispatch`, `activate-tablet`, `_shared/format.ts` (định dạng tin)
tests/fixtures/reconcile-cases.json  bộ dữ liệu đối soát dùng chung cho test TS và SQL
tests/db/          test DB (Vitest + Supabase local)
tests/telegram-mock/  server giả Telegram (`GET /__messages`)
cypress/           E2E
```
