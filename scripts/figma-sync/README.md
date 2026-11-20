# figma-sync — chụp UI app thật vào Figma

Dựng lại một màn hình của app (DOM đang hiển thị) thành layer Figma: đúng vị trí, màu, viền, bo góc, bóng, chữ (Be Vietnam Pro), icon SVG, ảnh, checkbox. Không dùng Figma MCP (hết quota gói Starter) — chạy Plugin API qua biến `figma` có sẵn trong tab Figma trên Chrome.

| File | Chạy ở đâu | Việc |
| --- | --- | --- |
| `server.mjs` | Node, `127.0.0.1:8799` | Cầu nối: app `POST /<key>` JSON, Figma `GET /<key>`; phục vụ `ser.js`, `build.js` |
| `ser.js` | trang app (localhost) | `__push(key, {fullHeight})` chụp DOM → gửi lên cầu nối |
| `build.js` | tab Figma (Chrome) | `__build(key, frameId, {height})` xoá nội dung frame rồi dựng lại |

## Dùng

1. `node scripts/figma-sync/server.mjs`
2. Chạy app (`npm run dev`; muốn có thanh máy in như app Android thì chạy với `VITE_FAKE_PRINTER=1` và đặt `localStorage['laodai-fake-printer']='1'`). Đặt viewport 1180×820 (tablet) hoặc 390×844 (mobile), đưa app tới trạng thái cần chụp.
3. Trong trang app (console / javascript tool):
   ```js
   eval(await fetch('http://127.0.0.1:8799/file/ser.js').then((r) => r.text()));
   await __push('t04');                       // chỉ khung nhìn
   await __push('m21', { fullHeight: true }); // trang cuộn dài (chế độ chủ)
   ```
4. Trong tab Figma (file `4pn7uPIndfCso8R6LA9Hj0`):
   ```js
   eval(await fetch('http://127.0.0.1:8799/file/build.js').then((r) => r.text()));
   await __build('t04', '15:158');               // id frame đích
   await __build('m28', '34:3584', { height: 2200 }); // cắt bớt trang quá dài
   ```

## Lưu ý

- Kết quả là layer tuyệt đối (không auto layout, không gắn biến màu).
- Chờ dữ liệu tải xong và thông báo tạm (toast) tắt rồi mới chụp.
- Chế độ chủ tự khoá sau một lúc ⇒ chụp theo lô nhỏ, nhập lại mật khẩu khi cần.
- Đã xử lý: phần tử `fixed` / `z-index` nổi lên trên, `display: contents`, vùng `overflow` cao 0 (ẩn), chữ xuống dòng giữa chừng (tách theo dòng), checkbox gốc của trình duyệt.
