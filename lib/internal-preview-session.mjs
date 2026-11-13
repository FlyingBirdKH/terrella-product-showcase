import { createHmac, timingSafeEqual } from 'node:crypto';

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

export function accessSecret(env) {
  const value = env && typeof env.TERRELLA_PREVIEW_ACCESS_SECRET === 'string' ? env.TERRELLA_PREVIEW_ACCESS_SECRET.trim() : '';
  return value;
}

export function secretsEqual(expected, given) {
  if (typeof expected !== 'string' || expected.length === 0 || typeof given !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sign(secret, expiresAt) {
  const payload = `v1.${expiresAt}`;
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyGate(secret, token) {
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1])) return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', secret).update(`v1.${parts[1]}`).digest('base64url');
  const left = Buffer.from(expected);
  const right = Buffer.from(parts[2]);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
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

export function gateAllows(env, req) {
  const secret = accessSecret(env);
  if (!secret) return { ok: false, status: 503, reason: 'access-not-configured' };
  const token = readCookie(req.headers.cookie, GATE_COOKIE);
  if (!verifyGate(secret, token)) return { ok: false, status: 401, reason: 'anonymous' };
  return { ok: true };
}

export async function handleSession(req, res, { env, send }) {
  const secret = accessSecret(env);
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
      if (!secret) {
        finish(503, { reason: 'access-not-configured', signedIn: false, saved: false });
        return;
      }
      const signedIn = verifyGate(secret, readCookie(req.headers.cookie, GATE_COOKIE));
      finish(200, { ok: true, signedIn, saved: false, reason: signedIn ? 'signed-in' : 'anonymous' });
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
    if (!secret) {
      finish(503, { reason: 'access-not-configured', signedIn: false, saved: false });
      return;
    }
    const body = await readJson(req);
    if (body.action === 'logout') {
      finish(200, { ok: true, signedIn: false, saved: false, reason: 'anonymous' }, cookie('', { maxAge: 0, secure }));
      return;
    }
    if (body.action && body.action !== 'login') {
      finish(405, { reason: 'method', signedIn: false, saved: false });
      return;
    }
    if (!secretsEqual(secret, body.secret)) {
      finish(401, { reason: 'access-rejected', signedIn: false, saved: false });
      return;
    }
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    const token = sign(secret, expiresAt);
    finish(200, {
      ok: true,
      signedIn: true,
      saved: false,
      reason: 'signed-in'
    }, cookie(token, { maxAge: SESSION_MAX_AGE, secure }));
  } catch {
    finish(503, { reason: 'store-not-writable', signedIn: false, saved: false });
  }
}
