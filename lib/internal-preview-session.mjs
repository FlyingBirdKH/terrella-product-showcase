export const ACCESS_COOKIE = 'terrella_preview_at';
export const REFRESH_COOKIE = 'terrella_preview_rt';
export const BRAND_CLAIM = 'terralla';

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

export function brandAdminFromAppMetadata(appMetadata) {
  return Boolean(appMetadata) && appMetadata.terrella_brand_admin === BRAND_CLAIM;
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
  return [cookie(ACCESS_COOKIE, '', { maxAge: 0, secure }), cookie(REFRESH_COOKIE, '', { maxAge: 0, secure })];
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
      finish(200, {
        ok: true,
        signedIn: true,
        brandAdmin,
        saved: false,
        reason: brandAdmin ? 'signed-in' : 'brand-admin-missing'
      });
      return;
    }
    if (req.method !== 'POST') {
      finish(405, { reason: 'method', signedIn: false, brandAdmin: false });
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
      const response = await fetchImpl(`${current.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: current.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.access_token !== 'string') {
        finish(401, { reason: 'auth-rejected', signedIn: false, brandAdmin: false }, clearCookies(secure));
        return;
      }
      const maxAge = Number.isInteger(payload.expires_in) ? payload.expires_in : 3600;
      const brandAdmin = brandAdminFromAppMetadata(payload.user?.app_metadata);
      finish(200, {
        ok: true,
        signedIn: true,
        brandAdmin,
        saved: false,
        reason: brandAdmin ? 'signed-in' : 'brand-admin-missing'
      }, [
        cookie(ACCESS_COOKIE, payload.access_token, { maxAge, secure }),
        cookie(REFRESH_COOKIE, payload.refresh_token || refresh, { maxAge, secure })
      ]);
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
    const maxAge = Number.isInteger(payload.expires_in) ? payload.expires_in : 3600;
    const brandAdmin = brandAdminFromAppMetadata(payload.user?.app_metadata);
    finish(200, {
      ok: true,
      signedIn: true,
      brandAdmin,
      saved: false,
      reason: brandAdmin ? 'signed-in' : 'brand-admin-missing'
    }, [
      cookie(ACCESS_COOKIE, payload.access_token, { maxAge, secure }),
      cookie(REFRESH_COOKIE, payload.refresh_token || '', { maxAge, secure })
    ]);
  } catch {
    finish(503, { reason: 'store-not-writable', signedIn: false, brandAdmin: false });
  }
}
