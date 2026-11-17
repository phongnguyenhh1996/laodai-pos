// Telegram mock: lưu mọi tin nhận được; GET /__messages để test kiểm tra nội dung.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createMockServer() {
  let messages = [];
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/__health') return send(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/__messages') return send(200, messages);
    if ((req.method === 'DELETE' || req.method === 'POST') && url.pathname === '/__messages/clear') {
      messages = [];
      return send(200, { ok: true });
    }
    const m = url.pathname.match(/^\/bot([^/]*)\/sendMessage$/);
    if (req.method === 'POST' && m) {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      messages.push({ token: m[1], chat_id: body.chat_id, text: body.text, at: new Date().toISOString() });
      return send(200, { ok: true, result: { message_id: messages.length } });
    }
    send(404, { ok: false });
  });
  return {
    server,
    listen: (port = Number(process.env.TELEGRAM_MOCK_PORT ?? 8787)) =>
      new Promise((resolve) => server.listen(port, '::', () => resolve(server))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.TELEGRAM_MOCK_PORT ?? 8787);
  await createMockServer().listen(port);
  console.log(`Telegram mock: http://localhost:${port}`);
}
