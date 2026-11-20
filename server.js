// マギア・ラボを http://localhost:8765/ で開くための小さなサーバー
// index.html を直接開く（file://）と、ブラウザがマイクの許可を覚えず、唱えるたびに許可を求められる。
// localhost で開けば、一度「許可」を押すとブラウザが覚えてくれる。
// このパソコンの中からしかアクセスできない（127.0.0.1 だけで待ち受ける）。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.MAGIA_PORT) || 8765;
const URL_TOP = `http://localhost:${PORT}/`;
const ALLOWED_HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${URL_TOP}"` : process.platform === 'darwin' ? `open "${URL_TOP}"` : `xdg-open "${URL_TOP}"`;
  exec(cmd, () => {});
}

const server = http.createServer((req, res) => {
  // ほかのサイトから読み込まれないよう、自分宛ての Host だけ受け付ける
  if (!ALLOWED_HOSTS.includes(String(req.headers.host || '').toLowerCase())) { res.writeHead(403); return res.end('Forbidden'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, URL_TOP).pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.resolve(ROOT, '.' + rel);
  // ゲームのフォルダーの外は見せない
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(abs).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // すでに起動しているときは、ブラウザで開くだけにする
    console.log(`Already running: ${URL_TOP}`);
    if (process.argv.includes('--open')) openBrowser();
    setTimeout(() => process.exit(0), 300);
  } else { console.error(e); process.exit(1); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Magia Lab is running: ${URL_TOP}`);
  console.log('Press Ctrl + C (or close this window) to stop.');
  if (process.argv.includes('--open')) openBrowser();
});
