import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewPayload, readStore, setSelection } from '../lib/internal-preview-store.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const storePath = process.env.INTERNAL_PREVIEW_PATH || join(root, 'internal-preview.json');
const port = Number(process.env.PORT || 8788);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/internal-preview') {
    try {
      if (req.method === 'GET') {
        send(res, 200, JSON.stringify(previewPayload(await readStore(storePath))));
        return;
      }
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        send(res, 200, JSON.stringify(await setSelection(storePath, body)));
        return;
      }
      send(res, 405, JSON.stringify({ ok: false, saved: false, reason: 'method' }));
    } catch (error) {
      const status = error && error.status ? error.status : 503;
      send(res, status, JSON.stringify({ ok: false, saved: false, reason: status === 400 ? error.message : 'store-not-writable' }));
    }
    return;
  }
  const requested = normalize(decodeURIComponent(url.pathname));
  const relative = requested === '/' ? 'index.html' : requested.replace(/^[/\\]+/, '');
  if (relative.startsWith('..') || relative.includes('..')) {
    send(res, 403, 'forbidden', 'text/plain; charset=utf-8');
    return;
  }
  try {
    const file = await readFile(join(root, relative));
    send(res, 200, file, types[extname(relative)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'not found', 'text/plain; charset=utf-8');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`internal preview http://127.0.0.1:${port}/cat-001-internal-preview.html`);
});
