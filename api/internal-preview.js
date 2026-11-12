import { fileURLToPath } from 'node:url';
import { previewPayload, readStore, setSelection } from '../lib/internal-preview-store.mjs';

const storePath = process.env.INTERNAL_PREVIEW_PATH || fileURLToPath(new URL('../internal-preview.json', import.meta.url));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (!sameOrigin(req)) {
    send(res, 403, { ok: false, saved: false, reason: 'origin' });
    return;
  }
  try {
    if (req.method === 'GET') {
      const store = await readStore(storePath);
      send(res, 200, previewPayload(store));
      return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const result = await setSelection(storePath, body);
      send(res, 200, result);
      return;
    }
    send(res, 405, { ok: false, saved: false, reason: 'method' });
  } catch (error) {
    const status = error && error.status ? error.status : 503;
    send(res, status, { ok: false, saved: false, reason: status === 400 ? error.message : 'store-not-writable' });
  }
}
