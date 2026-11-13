import { SELECTION_STORE } from './internal-preview-allowlist.mjs';
import { loadActor, readCookie, readCsrf, sessionCsrf, GATE_COOKIE } from './internal-preview-session.mjs';
import { productDbConfig } from './internal-preview-supabase.mjs';

export function previewError(status, reason, extra = {}) {
  const error = new Error(reason);
  error.status = status;
  error.reason = reason;
  if (extra.readback === true && extra.product && Array.isArray(extra.selected)) {
    error.readback = true;
    error.selected = extra.selected;
    error.productId = extra.product.id;
    error.sku = extra.product.sku;
    error.store = SELECTION_STORE;
    error.durable = true;
  }
  return error;
}

export function previewConfig(env) {
  return productDbConfig(env || {});
}

function headerValue(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : (value || '');
}

function crossSite(req) {
  const origin = headerValue(req, 'origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== headerValue(req, 'host');
  } catch {
    return true;
  }
}

async function readBody(req) {
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString('utf8');
    return text ? JSON.parse(text) : {};
  }
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body == null && typeof req[Symbol.asyncIterator] !== 'function') return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function send(res, status, body) {
  const selection = body.store === SELECTION_STORE && (Array.isArray(body.selected) || Array.isArray(body.selections));
  const durable = selection && body.durable === true;
  const payload = {
    ...body,
    ok: body.ok === true && (!selection || durable),
    saved: durable && body.ok === true && body.saved === true,
    durable
  };
  delete payload.serviceRoleKey;
  delete payload.apikey;
  delete payload.authorization;
  delete payload.secret;
  delete payload.password;
  delete payload.access_token;
  delete payload.refresh_token;
  delete payload.accessToken;
  delete payload.anonKey;
  if (!durable) {
    delete payload.store;
    delete payload.selected;
    delete payload.selections;
    delete payload.productId;
    delete payload.sku;
    delete payload.readback;
  } else if (payload.ok !== true && payload.readback !== true) {
    payload.readback = true;
  }
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function handlePreview(req, res, { env, fetchImpl, clientFactory }) {
  const guard = req.method === 'POST' ? sessionCsrf(req) : readCsrf(req);
  if (req.method === 'POST' && !guard.ok) {
    send(res, 403, { reason: 'csrf' });
    return;
  }
  if (req.method === 'GET' && !guard.ok) {
    send(res, 403, { reason: 'csrf' });
    return;
  }
  if (crossSite(req)) {
    send(res, 403, { reason: 'origin' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    send(res, 405, { reason: 'method' });
    return;
  }
  const config = previewConfig(env);
  if (!config) {
    send(res, 503, { reason: 'access-not-configured' });
    return;
  }
  const actor = await loadActor(config, readCookie(req.headers.cookie, GATE_COOKIE), fetchImpl || globalThis.fetch);
  if (!actor.ok) {
    send(res, actor.status, { reason: actor.reason });
    return;
  }
  if (req.method === 'POST' && actor.level !== 'admin') {
    send(res, 403, { reason: 'brand-admin-missing' });
    return;
  }
  try {
    const client = clientFactory({ ...config, accessToken: actor.accessToken, fetchImpl });
    if (req.method === 'GET') {
      const params = new URL(req.url || '/', 'http://preview.local').searchParams;
      const productId = params.get('productId') || '';
      const sku = params.get('sku') || '';
      const code = params.get('code') || '';
      const result = productId || sku || code ? await client.read({ productId, sku, code }) : await client.readAll();
      send(res, 200, result);
      return;
    }
    const body = await readBody(req);
    const result = await client.apply({
      productId: body.productId,
      sku: body.sku,
      code: body.code,
      sha256: body.sha256,
      selected: body.selected,
      expectedSelected: body.expectedSelected
    });
    send(res, 200, result);
  } catch (error) {
    const status = error && Number.isInteger(error.status) ? error.status : 503;
    const reason = error && error.reason ? error.reason : 'store-not-writable';
    const payload = { reason };
    if (error && error.readback === true) {
      payload.ok = false;
      payload.saved = false;
      payload.durable = true;
      payload.store = SELECTION_STORE;
      payload.readback = true;
      payload.selected = error.selected;
      payload.productId = error.productId;
      payload.sku = error.sku;
    }
    send(res, status, payload);
  }
}
