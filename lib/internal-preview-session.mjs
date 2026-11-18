import { identityFromAuth } from './internal-preview-identity.mjs';
import { productDbConfig } from './internal-preview-supabase.mjs';

export const GATE_COOKIE = 'terrella_preview_gate';
export const COOKIE_PATH = '/api/internal-preview';
export const SESSION_MAX_AGE = 12 * 60 * 60;

function headerValue(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : (value || '');
}

function originMatches(req, origin) {
  try {
    return new URL(origin).host === headerValue(req, 'host');
  } catch {
    return false;
  }
}

export function sessionCsrf(req) {
  const site = headerValue(req, 'sec-fetch-site').toLowerCase();
  const mode = headerValue(req, 'sec-fetch-mode').toLowerCase();
  const dest = headerValue(req, 'sec-fetch-dest').toLowerCase();
  const origin = headerValue(req, 'origin');
  const type = headerValue(req, 'content-type').toLowerCase();
  const browser = site !== '';
  if (!type.startsWith('application/json')) return { ok: false, reason: 'csrf' };
  if (browser) {
    if (site !== 'same-origin') return { ok: false, reason: 'csrf' };
    if (mode && mode !== 'cors' && mode !== 'same-origin') return { ok: false, reason: 'csrf' };
    if (dest && dest !== 'empty') return { ok: false, reason: 'csrf' };
    if (!origin || !originMatches(req, origin)) return { ok: false, reason: 'csrf' };
    return { ok: true };
  }
  if (origin && !originMatches(req, origin)) return { ok: false, reason: 'csrf' };
  return { ok: true };
}

export function readCsrf(req) {
  const site = headerValue(req, 'sec-fetch-site').toLowerCase();
  const origin = headerValue(req, 'origin');
  if (!site) {
    if (origin && !originMatches(req, origin)) return { ok: false, reason: 'csrf' };
    return { ok: true };
  }
  if (site !== 'same-origin') return { ok: false, reason: 'csrf' };
  if (origin && !originMatches(req, origin)) return { ok: false, reason: 'csrf' };
  return { ok: true };
}

export function readCookie(header, name) {
  const source = Array.isArray(header) ? header.join('; ') : (header || '');
  for (const part of source.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return '';
}

function secureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted === true;
}

function cookie(value, { maxAge, secure }) {
  const parts = [
    `${GATE_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAge}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

async function readJson(req) {
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

async function authRequest(config, fetchImpl, path, { method = 'GET', token = '', body } = {}) {
  const headers = { apikey: config.anonKey, accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetchImpl(`${config.supabaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    return null;
  }
  const text = typeof response.text === 'function' ? await response.text() : '';
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

export async function loadActor(config, token, fetchImpl) {
  if (!config || !token) return { ok: false, status: 401, reason: 'anonymous' };
  const response = await authRequest(config, fetchImpl, '/auth/v1/user', { token });
  if (!response || !response.ok || !response.body) return { ok: false, status: 401, reason: 'anonymous' };
  const identity = identityFromAuth(response.body, token);
  if (!identity) return { ok: false, status: 401, reason: 'identity' };
  if (!identity.level) return { ok: false, status: 403, reason: 'brand-access-missing' };
  return { ok: true, level: identity.level, accessToken: token, userId: identity.id };
}

function cleanCredential(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > max || /[\r\n]/.test(text)) return '';
  return text;
}

export async function handleSession(req, res, { env, send, fetchImpl = globalThis.fetch }) {
  const config = productDbConfig(env);
  const secure = secureRequest(req);
  const finish = (status, body, cookies) => {
    if (cookies) res.setHeader('set-cookie', cookies);
    send(res, status, body);
  };
  try {
    if (req.method === 'GET') {
      const reading = readCsrf(req);
      if (!reading.ok) {
        finish(403, { reason: 'csrf', signedIn: false, saved: false });
        return;
      }
      if (!config) {
        finish(503, { reason: 'access-not-configured', signedIn: false, saved: false });
        return;
      }
      const token = readCookie(req.headers.cookie, GATE_COOKIE);
      if (!token) {
        finish(200, { ok: true, signedIn: false, saved: false, reason: 'anonymous' });
        return;
      }
      const actor = await loadActor(config, token, fetchImpl);
      finish(actor.ok ? 200 : actor.status, {
        ok: actor.ok,
        signedIn: actor.ok,
        saved: false,
        reason: actor.ok ? 'signed-in' : actor.reason,
        level: actor.ok ? actor.level : ''
      });
      return;
    }
    if (req.method !== 'POST') {
      finish(405, { reason: 'method', signedIn: false, saved: false });
      return;
    }
    const csrf = sessionCsrf(req);
    if (!csrf.ok) {
      finish(403, { reason: 'csrf', signedIn: false, saved: false });
      return;
    }
    if (!config) {
      finish(503, { reason: 'access-not-configured', signedIn: false, saved: false });
      return;
    }
    const body = await readJson(req);
    if (body.action === 'logout') {
      const token = readCookie(req.headers.cookie, GATE_COOKIE);
      if (token) await authRequest(config, fetchImpl, '/auth/v1/logout', { method: 'POST', token });
      finish(200, { ok: true, signedIn: false, saved: false, reason: 'anonymous' }, cookie('', { maxAge: 0, secure }));
      return;
    }
    if (body.action && body.action !== 'login') {
      finish(405, { reason: 'method', signedIn: false, saved: false });
      return;
    }
    const email = cleanCredential(body.email, 320);
    const password = cleanCredential(body.password, 200);
    if (!email || !password || !email.includes('@')) {
      finish(401, { reason: 'access-rejected', signedIn: false, saved: false });
      return;
    }
    const signed = await authRequest(config, fetchImpl, '/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password }
    });
    const token = signed && signed.ok && signed.body && typeof signed.body.access_token === 'string' ? signed.body.access_token : '';
    if (!token) {
      finish(401, { reason: 'access-rejected', signedIn: false, saved: false });
      return;
    }
    const actor = await loadActor(config, token, fetchImpl);
    if (!actor.ok) {
      finish(actor.status, { reason: actor.reason, signedIn: false, saved: false });
      return;
    }
    const expiresIn = signed.body && Number.isSafeInteger(signed.body.expires_in) ? signed.body.expires_in : 3600;
    const maxAge = Math.min(Math.max(expiresIn, 60), SESSION_MAX_AGE);
    finish(200, {
      ok: true,
      signedIn: true,
      saved: false,
      reason: 'signed-in',
      level: actor.level
    }, cookie(token, { maxAge, secure }));
  } catch {
    finish(503, { reason: 'store-not-writable', signedIn: false, saved: false });
  }
}
