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
    // Gửi file (sao lưu hằng đêm): multipart; lưu caption vào `text`, nội dung file dạng base64.
    const d = url.pathname.match(/^\/bot([^/]*)\/sendDocument$/);
    if (req.method === 'POST' && d) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = await new Request('http://mock/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: Buffer.concat(chunks) }).formData();
      const file = form.get('document');
      if (!file || typeof file === 'string') return send(400, { ok: false, description: 'document required' });
      messages.push({
        token: d[1],
        chat_id: String(form.get('chat_id')),
        text: String(form.get('caption') ?? ''),
        document: { filename: file.name, base64: Buffer.from(await file.arrayBuffer()).toString('base64') },
        at: new Date().toISOString(),
      });
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
