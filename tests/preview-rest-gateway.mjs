import { createServer } from 'node:http';
import { applySql, lastJson, readSql, sqlReason } from './preview-postgres.mjs';

const ROLES = ['kevin_admin', 'terralla_admin', 'terralla_team', 'authenticated', 'admin', 'sourcing_manager', 'anon'];

function tokenRole(header) {
  const match = new RegExp(`^Bearer test\\.(${ROLES.join('|')})$`).exec(header || '');
  return match ? match[1] : '';
}

function httpFailure(stderr, role) {
  const reason = sqlReason(stderr) || 'store-not-writable';
  if (role === 'anon' || reason === 'anonymous') return { status: 401, message: 'anonymous' };
  if (reason === 'revision_conflict' || reason === 'idempotency_conflict') return { status: 409, message: reason };
  if (reason === 'sha256' || reason === 'product' || reason === 'event_id' || reason === 'base_revision' || reason === 'selected') {
    return { status: 400, message: reason };
  }
  if (reason === 'manager' || reason === 'permission') return { status: 403, message: 'manager' };
  return { status: 503, message: 'store-not-writable' };
}

export async function startPreviewGateway(db) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
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
    if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/user') return send(404, { message: 'store-not-writable' });
    const role = tokenRole(req.headers.authorization);
    if (url.pathname === '/rest/v1/rpc/internal_preview_apply_event' || url.pathname === '/rest/v1/rpc/internal_preview_read') {
      if (!role) return send(401, { message: 'anonymous' });
      const result = url.pathname.endsWith('read')
        ? await readSql(db, { role, productId: body.product_id })
        : await applySql(db, {
          role,
          eventId: body.event_id,
          productId: body.product_id,
          sha: body.sha256,
          selected: body.selected,
          base: body.base_revision
        });
      if (!result.ok) {
        const failure = httpFailure(result.stderr, role);
        return send(failure.status, { message: failure.message });
      }
      return send(200, lastJson(result.stdout));
    }
    if (url.pathname === '/rest/v1/rpc/down') return send(500, { message: 'store-not-writable' });
    return send(404, { message: 'store-not-writable' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

export async function quietCount(db, sql) {
  const { psql } = await import('./preview-postgres.mjs');
  const result = await psql(db, sql);
  if (!result.ok) throw new Error(result.stderr);
  return result.stdout.split('\n').pop();
}
