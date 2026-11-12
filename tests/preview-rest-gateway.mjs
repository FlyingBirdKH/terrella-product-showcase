import { createServer } from 'node:http';
import { BRAND_USER, OTHER_USER, applySql, lastJson, readSql, sqlReason } from './preview-postgres.mjs';

const PROFILES = {
  'test.brand-admin': {
    sub: BRAND_USER,
    role: 'authenticated',
    app_metadata: { terrella_brand_admin: 'terralla', provider: 'email' },
    user_metadata: { name: 'Brand' }
  },
  'test.no-brand': {
    sub: OTHER_USER,
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: { terrella_brand_admin: 'terralla', role: 'admin' }
  },
  'test.supplier': {
    sub: OTHER_USER,
    role: 'authenticated',
    app_metadata: { role: 'sourcing_manager', provider: 'email' },
    user_metadata: { role: 'admin', terrella_brand_admin: 'terralla' }
  },
  'test.wrong-brand': {
    sub: BRAND_USER,
    role: 'authenticated',
    app_metadata: { terrella_brand_admin: 'other' }
  },
  'test.no-sub': {
    role: 'authenticated',
    app_metadata: { terrella_brand_admin: 'terralla' }
  },
  'test.anon': { role: 'anon' },
  'test.service': {
    role: 'service_role',
    sub: BRAND_USER,
    app_metadata: { terrella_brand_admin: 'terralla' }
  }
};

const PASSWORDS = new Map([
  ['brand@example.test', 'test.brand-admin'],
  ['plain@example.test', 'test.no-brand'],
  ['supplier@example.test', 'test.supplier']
]);

function bearer(header) {
  const match = /^Bearer\s+(\S+)$/.exec(header || '');
  return match ? match[1] : '';
}

function failureFor(profile, stderr) {
  const reason = sqlReason(stderr) || 'store-not-writable';
  if (reason === 'revision_conflict' || reason === 'idempotency_conflict') return { status: 409, message: reason };
  if (reason === 'sha256' || reason === 'product' || reason === 'event_id' || reason === 'base_revision' || reason === 'selected') {
    return { status: 400, message: reason };
  }
  if (reason === 'sub') return { status: 401, message: 'sub' };
  if (reason === 'brand-admin-missing') return { status: 403, message: 'brand-admin-missing' };
  if (reason === 'role' || reason === 'permission' || profile.role !== 'authenticated') {
    return { status: 403, message: profile.role === 'anon' ? 'anonymous' : 'role' };
  }
  return { status: 503, message: 'store-not-writable' };
}

export async function startPreviewGateway(db) {
  const hits = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    hits.push(url.pathname + url.search);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };
    if (!req.headers.apikey) return send(401, { message: 'anonymous' });
    if (url.pathname.includes('invite') || url.pathname.includes('/admin/')) return send(403, { message: 'method' });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const token = PASSWORDS.get(body.email);
      const profile = token && body.password === 'test-password-only' ? PROFILES[token] : null;
      if (!profile) return send(400, { message: 'auth-rejected' });
      return send(200, {
        access_token: token,
        refresh_token: `refresh.${token}`,
        expires_in: 3600,
        user: { id: profile.sub, app_metadata: profile.app_metadata || {}, user_metadata: profile.user_metadata || {} }
      });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const token = String(body.refresh_token || '').replace(/^refresh\./, '');
      const profile = PROFILES[token];
      if (!profile) return send(400, { message: 'auth-rejected' });
      return send(200, {
        access_token: token,
        refresh_token: `refresh.${token}`,
        expires_in: 3600,
        user: { id: profile.sub, app_metadata: profile.app_metadata || {}, user_metadata: profile.user_metadata || {} }
      });
    }
    if (url.pathname === '/auth/v1/user') {
      const profile = PROFILES[bearer(req.headers.authorization)];
      if (!profile || !profile.sub) return send(401, { message: 'anonymous' });
      return send(200, { id: profile.sub, app_metadata: profile.app_metadata || {}, user_metadata: profile.user_metadata || {} });
    }
    if (url.pathname === '/auth/v1/logout') return send(204, {});
    const profile = PROFILES[bearer(req.headers.authorization)];
    if (url.pathname === '/rest/v1/rpc/internal_preview_apply_event' || url.pathname === '/rest/v1/rpc/internal_preview_read') {
      if (!profile) return send(401, { message: 'anonymous' });
      const result = url.pathname.endsWith('read')
        ? await readSql(db, { claims: profile, productId: body.product_id })
        : await applySql(db, {
          claims: profile,
          eventId: body.event_id,
          productId: body.product_id,
          sha: body.sha256,
          selected: body.selected,
          base: body.base_revision
        });
      if (!result.ok) {
        const failure = failureFor(profile, result.stderr);
        return send(failure.status, { message: failure.message });
      }
      return send(200, lastJson(result.stdout));
    }
    if (url.pathname === '/rest/v1/rpc/down') return send(500, { message: 'store-not-writable' });
    return send(404, { message: 'store-not-writable' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    hits,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

export async function quietCount(db, sql) {
  const { psql } = await import('./preview-postgres.mjs');
  const result = await psql(db, sql);
  if (!result.ok) throw new Error(result.stderr);
  return result.stdout.split('\n').pop();
}

export { OTHER_USER };
