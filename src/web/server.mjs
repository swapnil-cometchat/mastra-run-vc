import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

// Serve files from these roots
const roots = [
  join(__dirname, '../../public'),
  join(__dirname, '../../assets'),
];

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
]);

function contentTypeFor(pathname) {
  const i = pathname.lastIndexOf('.');
  if (i === -1) return 'application/octet-stream';
  return mime.get(pathname.slice(i)) || 'application/octet-stream';
}

function safeJoin(root, reqPath) {
  const full = normalize(join(root, reqPath));
  if (!full.startsWith(root)) return null; // path traversal guard
  return full;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/embed.html';

  // try each root
  for (const root of roots) {
    const full = safeJoin(root, pathname);
    if (!full) continue;
    if (existsSync(full)) {
      try {
        const st = statSync(full);
        if (st.isDirectory()) continue;
        res.writeHead(200, {
          'content-type': contentTypeFor(pathname),
          'cache-control': 'no-store',
        });
        createReadStream(full).pipe(res);
        return;
      } catch (e) {
        // try next root
      }
    }
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Web server running at http://localhost:${port}`);
});

