import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductDbClient } from '../lib/internal-preview-supabase.mjs';
import { handlePreview, send as sendJson } from '../lib/internal-preview-http.mjs';
import { handleSession } from '../lib/internal-preview-session.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 8788);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function buffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  req.body = Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/internal-preview' || url.pathname === '/api/internal-preview/session') {
    await buffer(req);
    if (url.pathname === '/api/internal-preview/session') {
      await handleSession(req, res, { env: process.env, send: sendJson });
    } else {
      await handlePreview(req, res, { env: process.env, fetchImpl: globalThis.fetch, clientFactory: createProductDbClient });
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
  const address = server.address();
  console.log(`internal preview http://127.0.0.1:${address.port}/cat-001-internal-preview.html`);
});
