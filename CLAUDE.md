# Laodai POS — hướng dẫn cho agent

POS (PWA + app Android Capacitor) cho quán xôi / cơm gà. Backend Supabase. Tiếng Việt là ngôn ngữ của sản phẩm, UI và tài liệu.

## Đọc trước khi làm

| File | Khi nào |
|---|---|
| [docs/glossary.md](docs/glossary.md) | Luôn đọc. Dùng đúng thuật ngữ ở đây trong code, UI, commit, câu hỏi |
| [docs/adr/](docs/adr/) | Trước khi đổi kiến trúc, phân quyền, đồng bộ, in, sao lưu |
| [docs/coding-standards.md](docs/coding-standards.md) | Trước khi viết code và khi review |
| [SPEC.md](SPEC.md) | Đặc tả nghiệp vụ đầy đủ. Đọc mục liên quan, không cần đọc hết |
| [README.md](README.md) | Chạy local, cấu trúc thư mục, sao lưu / khôi phục |
| `docs/plans/` | Kế hoạch các tính năng lớn (mỗi tính năng một file) |

## Lệnh

```bash
npm run check        # typecheck + lint + unit test. Chạy trước khi báo xong mọi task; CI chạy đúng lệnh này
npm run lint         # ESLint, không cho phép cảnh báo (eslint.config.js)
npm run test:db      # test RLS / RPC / SQL (cần Supabase local đang chạy)
npm run test:e2e     # Cypress headless
npm run test:all     # unit + db + e2e
```

## Luồng làm việc

1. **Grill trước khi code**: hỏi đến khi rõ phạm vi. Từ mới thì thêm vào glossary, quyết định khó đảo ngược thì viết ADR.
2. **Task lớn**: viết kế hoạch vào `docs/plans/<ten>.md` (mục tiêu, phạm vi, không làm, tiêu chí xong), chia thành ticket nhỏ, mỗi ticket một phiên.
3. **Implement**, rồi `npm run check`. Đụng SQL / RLS thì chạy thêm `npm run test:db`.
4. **Review**: (a) đúng và chỉ đúng phạm vi kế hoạch, (b) khớp `docs/coding-standards.md`.
5. **Retro**: điều gì phải nhắc agent lần này? Ưu tiên biến nó thành test / kiểm tra tự động; không được thì thêm vào coding standards.

## Mức rủi ro khi merge

- **Cửa một chiều** (migration xóa / đổi cột, RLS, `sync_push`, công thức đối soát, sao lưu / khôi phục, plugin native cần cài lại APK): con người đọc kỹ, cố tìm cách làm hỏng.
- **Cửa hai chiều** (UI, copy, màn chủ, test): lướt diff, dựa vào test.
