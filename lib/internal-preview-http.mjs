import { ACCESS_COOKIE, readCookie } from './internal-preview-session.mjs';

export function previewError(status, reason) {
  const error = new Error(reason);
  error.status = status;
  error.reason = reason;
  return error;
}

export function previewConfig(env) {
  const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.trim() : '';
  if (!supabaseUrl || !anonKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), anonKey };
}

export function bearerToken(header) {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/i.exec(value || '');
  return match ? match[1] : '';
}

function crossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function readBody(req) {
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function send(res, status, body) {
  const confirmed = body.ok === true && body.durable === true && body.store === 'supabase';
  const payload = {
    ...body,
    ok: body.ok === true,
    saved: confirmed && body.saved === true,
    durable: confirmed
  };
  if (!confirmed) delete payload.store;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function handlePreview(req, res, { env, fetchImpl, clientFactory }) {
  const config = previewConfig(env);
  if (!config) {
    send(res, 503, { reason: 'store-not-configured' });
    return;
  }
  if (crossSite(req)) {
    send(res, 403, { reason: 'origin' });
    return;
  }
  const accessToken = readCookie(req.headers.cookie, ACCESS_COOKIE);
  if (!accessToken) {
    send(res, 401, { reason: 'anonymous' });
    return;
  }
  try {
    const client = clientFactory({ ...config, accessToken, fetchImpl });
    if (req.method === 'GET') {
      const productId = new URL(req.url, 'http://preview.local').searchParams.get('productId');
      const result = await client.read(productId);
      send(res, 200, result);
      return;
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const result = await client.apply({
        eventId: body.eventId,
        productId: body.productId,
        sha256: typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : body.sha256,
        selected: body.selected,
        baseRevision: body.baseRevision
      });
      send(res, 200, result);
      return;
    }
    send(res, 405, { reason: 'method' });
  } catch (error) {
    const status = error && Number.isInteger(error.status) ? error.status : 503;
    const reason = error && error.reason ? error.reason : 'store-not-writable';
    send(res, status, { reason });
  }
}
