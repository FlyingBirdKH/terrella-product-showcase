export const ACCESS_COOKIE = 'terrella_preview_at';
export const REFRESH_COOKIE = 'terrella_preview_rt';
export const UNTIL_COOKIE = 'terrella_preview_until';
export const BRAND_CLAIM = 'terralla';
export const SESSION_MAX_AGE = 12 * 60 * 60;

export function brandAdminFromAppMetadata(appMetadata) {
  return Boolean(appMetadata) && appMetadata.terrella_brand_admin === BRAND_CLAIM;
}

export function brandReaderFromAppMetadata(appMetadata) {
  return Boolean(appMetadata) && appMetadata.terrella_brand_reader === BRAND_CLAIM;
}

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

function config(env) {
  const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const anonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.trim() : '';
  if (!supabaseUrl || !anonKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ''), anonKey };
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

function cookie(name, value, { maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/internal-preview',
    `Max-Age=${maxAge}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookies(secure) {
  return [ACCESS_COOKIE, REFRESH_COOKIE, UNTIL_COOKIE].map((name) => cookie(name, '', { maxAge: 0, secure }));
}

function sessionCookies(payload, secure, { until, remaining }) {
  const accessMax = Math.min(Number.isInteger(payload.expires_in) ? payload.expires_in : 3600, remaining);
  return [
    cookie(ACCESS_COOKIE, payload.access_token, { maxAge: accessMax, secure }),
    cookie(REFRESH_COOKIE, payload.refresh_token || '', { maxAge: remaining, secure }),
    cookie(UNTIL_COOKIE, String(until), { maxAge: remaining, secure })
  ];
}

async function readJson(req) {
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

export async function handleSession(req, res, { env, fetchImpl = globalThis.fetch, send }) {
  const current = config(env);
  if (!current) {
    send(res, 503, { reason: 'store-not-configured', signedIn: false, brandAdmin: false });
    return;
  }
  const secure = secureRequest(req);
  const access = readCookie(req.headers.cookie, ACCESS_COOKIE);
  const refresh = readCookie(req.headers.cookie, REFRESH_COOKIE);
  const finish = (status, body, cookies) => {
    if (cookies) res.setHeader('set-cookie', cookies);
    send(res, status, body);
  };
  try {
    if (req.method === 'GET') {
      const reading = readCsrf(req);
      if (!reading.ok) {
        finish(403, { reason: 'csrf', signedIn: false, brandAdmin: false, brandReader: false, saved: false });
        return;
      }
      if (!access) {
        finish(200, { ok: true, signedIn: false, brandAdmin: false, saved: false, reason: 'anonymous' });
        return;
      }
      const response = await fetchImpl(`${current.supabaseUrl}/auth/v1/user`, {
        headers: { apikey: current.anonKey, authorization: `Bearer ${access}` }
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || typeof payload.id !== 'string') {
        finish(401, { reason: 'anonymous', signedIn: false, brandAdmin: false }, clearCookies(secure));
        return;
      }
      const brandAdmin = brandAdminFromAppMetadata(payload.app_metadata);
      const brandReader = brandReaderFromAppMetadata(payload.app_metadata);
      finish(200, {
        ok: true,
        signedIn: true,
        brandAdmin,
        brandReader,
        saved: false,
        reason: brandAdmin ? 'signed-in' : (brandReader ? 'brand-reader' : 'brand-access-missing')
      });
      return;
    }
    if (req.method !== 'POST') {
      finish(405, { reason: 'method', signedIn: false, brandAdmin: false, brandReader: false });
      return;
    }
    const csrf = sessionCsrf(req);
    if (!csrf.ok) {
      finish(403, { reason: 'csrf', signedIn: false, brandAdmin: false, brandReader: false, saved: false });
      return;
    }
    const body = await readJson(req);
    if (body.action === 'signup' || body.invite === true) {
      finish(405, { reason: 'method', signedIn: false, brandAdmin: false });
      return;
    }
    if (body.action === 'logout') {
      if (access) {
        await fetchImpl(`${current.supabaseUrl}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: current.anonKey, authorization: `Bearer ${access}` }
        }).catch(() => null);
      }
      finish(200, { ok: true, signedIn: false, brandAdmin: false, saved: false, reason: 'anonymous' }, clearCookies(secure));
      return;
    }
    if (body.action === 'refresh') {
      if (!refresh) {
        finish(401, { reason: 'anonymous', signedIn: false, brandAdmin: false });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const until = Number(readCookie(req.headers.cookie, UNTIL_COOKIE));
      if (!Number.isInteger(until) || until <= now) {
        finish(401, { reason: 'session-expired', signedIn: false, brandAdmin: false, brandReader: false }, clearCookies(secure));
        return;
      }
      const response = await fetchImpl(`${current.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: current.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.access_token !== 'string') {
        finish(401, { reason: 'auth-rejected', signedIn: false, brandAdmin: false, brandReader: false }, clearCookies(secure));
        return;
      }
      const brandAdmin = brandAdminFromAppMetadata(payload.user?.app_metadata);
      const brandReader = brandReaderFromAppMetadata(payload.user?.app_metadata);
      finish(200, {
        ok: true,
        signedIn: true,
        brandAdmin,
        brandReader,
        saved: false,
        reason: brandAdmin ? 'signed-in' : (brandReader ? 'brand-reader' : 'brand-access-missing')
      }, sessionCookies({ ...payload, refresh_token: payload.refresh_token || refresh }, secure, { until, remaining: until - now }));
      return;
    }
    if (body.action && body.action !== 'login') {
      finish(405, { reason: 'method', signedIn: false, brandAdmin: false });
      return;
    }
    if (typeof body.email !== 'string' || !body.email || typeof body.password !== 'string' || !body.password) {
      finish(401, { reason: 'auth-rejected', signedIn: false, brandAdmin: false });
      return;
    }
    const response = await fetchImpl(`${current.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: current.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: body.email, password: body.password })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || typeof payload?.access_token !== 'string' || !payload.access_token) {
      finish(401, { reason: 'auth-rejected', signedIn: false, brandAdmin: false });
      return;
    }
    const maxAgeUntil = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
    const brandAdmin = brandAdminFromAppMetadata(payload.user?.app_metadata);
    const brandReader = brandReaderFromAppMetadata(payload.user?.app_metadata);
    finish(200, {
      ok: true,
      signedIn: true,
      brandAdmin,
      brandReader,
      saved: false,
      reason: brandAdmin ? 'signed-in' : (brandReader ? 'brand-reader' : 'brand-access-missing')
    }, sessionCookies(payload, secure, { until: maxAgeUntil, remaining: SESSION_MAX_AGE }));
  } catch {
    finish(503, { reason: 'store-not-writable', signedIn: false, brandAdmin: false });
  }
}
