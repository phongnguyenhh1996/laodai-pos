// Bật Telegram mock cho test DB (nếu chưa có ai chạy ở cổng 8787).
import { createMockServer } from '../telegram-mock/server.mjs';

export default async function setup() {
  const up = await fetch('http://localhost:8787/__health').then((r) => r.ok).catch(() => false);
  if (up) return;
  const mock = createMockServer();
  await mock.listen(8787);
  return () => mock.close();
}
