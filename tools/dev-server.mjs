// 开发用静态服务器：比 `python -m http.server` 多的唯一一件事——发 no-store，
// 防止浏览器缓存 ES module（缓存会导致改完代码刷新看不到变化，浪费一整轮排查）。
//
// 用法: node tools/dev-server.mjs [port]   # 默认 9500
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const PORT = Number(process.argv[2] || 9500);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.css': 'text/css; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    // 目录穿越防护：解析后必须仍在 ROOT 内
    const target = normalize(join(ROOT, rel));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dev-server: http://127.0.0.1:${PORT}/  root=${ROOT}  (no-store)`);
});
