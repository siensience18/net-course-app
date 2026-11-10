// Локальный сервер для docs/. Запуск: node serve.mjs (или start.bat)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'docs');
// Порт фиксированный: прогресс и вход хранятся в браузере отдельно для каждого адреса.
const PORT = Number(process.env.PORT) || 8765;
const URL_ = `http://localhost:${PORT}/`;
const PING = '/__net-course-ping';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
};

function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${URL_}"` : process.platform === 'darwin' ? `open ${URL_}` : `xdg-open ${URL_}`;
  exec(cmd);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === PING) { res.end('net-course'); return; }
  const file = path.normalize(path.join(ROOT, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${PING}`);
    if ((await r.text()) === 'net-course') {
      console.log('Курс уже запущен, открываю браузер.');
      openBrowser();
      setTimeout(() => process.exit(0), 500);
      return;
    }
  } catch { /* порт занят чем-то другим */ }
  console.error(`Порт ${PORT} занят другой программой. Закройте её или запустите с другим портом: set PORT=8780`);
  process.exitCode = 1;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Курс запущен: ${URL_}`);
  console.log('Не закрывайте это окно, пока занимаетесь. Чтобы остановить — закройте окно.');
  openBrowser();
});
