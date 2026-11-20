// Cầu nối cục bộ giữa trang app (đẩy JSON chụp DOM) và tab Figma (lấy JSON để dựng). Xem README.md.
// Chỉ nghe 127.0.0.1; dữ liệu giữ trong bộ nhớ, tắt là mất.
import http from 'node:http';
import fs from 'node:fs';

const PORT = 8799;
const FILES = new Set(['ser.js', 'build.js']); // chỉ phục vụ đúng 2 script này
const store = new Map();

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    // Chrome chặn trang https (figma.com) gọi localhost nếu thiếu header này.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.end();
    const key = req.url;
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        store.set(key, b);
        res.end(JSON.stringify({ ok: true, size: b.length }));
      });
      return;
    }
    if (key.startsWith('/file/')) {
      const name = key.slice(6);
      if (!FILES.has(name)) {
        res.statusCode = 404;
        return res.end('nf');
      }
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(fs.readFileSync(new URL(`./${name}`, import.meta.url)));
    }
    if (key === '/__list') return res.end(JSON.stringify([...store.keys()].map((k) => [k, store.get(k).length])));
    if (!store.has(key)) {
      res.statusCode = 404;
      return res.end('nf');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(store.get(key));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`figma-sync bridge on ${PORT}`));
