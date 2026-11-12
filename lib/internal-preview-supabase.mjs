import { INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256 } from './internal-preview-allowlist.mjs';
import { previewError } from './internal-preview-http.mjs';

const ALLOWED = new Set(INTERNAL_PREVIEW_SHA256);

function requireIdentity(productId, sha256) {
  if (productId !== INTERNAL_PREVIEW_PRODUCT_ID) throw previewError(400, 'product');
  if (typeof sha256 !== 'string' || !ALLOWED.has(sha256)) throw previewError(400, 'sha256');
}

function requireEvent(input) {
  requireIdentity(input.productId, input.sha256);
  if (typeof input.selected !== 'boolean') throw previewError(400, 'selected');
  if (typeof input.eventId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.eventId)) throw previewError(400, 'event_id');
  if (typeof input.baseRevision !== 'number' || !Number.isInteger(input.baseRevision) || input.baseRevision < 0 || !Number.isSafeInteger(input.baseRevision)) {
    throw previewError(400, 'base_revision');
  }
}

function mapFailure(status, body) {
  const message = body && typeof body.message === 'string' ? body.message : '';
  if (message === 'revision_conflict' || message === 'idempotency_conflict') return previewError(409, message);
  if (message === 'sha256' || message === 'product' || message === 'event_id' || message === 'base_revision' || message === 'selected') {
    return previewError(400, message);
  }
  if (message === 'manager' || status === 403) return previewError(403, 'manager');
  if (message === 'anonymous' || status === 401) return previewError(401, 'anonymous');
  return previewError(503, 'store-not-writable');
}

function confirmedState(body, { saved }) {
  if (!body || body.ok !== true || body.durable !== true || body.store !== 'supabase' || body.productId !== INTERNAL_PREVIEW_PRODUCT_ID) {
    throw previewError(503, 'readback');
  }
  if (!Array.isArray(body.selected) || body.selected.some((sha) => !ALLOWED.has(sha))) throw previewError(503, 'readback');
  if (!body.revisions || typeof body.revisions !== 'object' || Array.isArray(body.revisions)) throw previewError(503, 'readback');
  for (const [sha, revision] of Object.entries(body.revisions)) {
    if (!ALLOWED.has(sha) || typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) throw previewError(503, 'readback');
  }
  if (saved && body.saved !== true) throw previewError(503, 'readback');
  return {
    ok: true,
    saved: saved === true,
    durable: true,
    store: 'supabase',
    productId: body.productId,
    selected: body.selected,
    revisions: body.revisions,
    idempotent: body.idempotent === true
  };
}

async function rpc(client, name, args) {
  let response;
  try {
    response = await client.fetchImpl(`${client.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: client.anonKey,
        authorization: `Bearer ${client.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(args)
    });
  } catch {
    throw previewError(503, 'store-not-writable');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw mapFailure(response.status, body);
  return body;
}

export function createSupabasePreviewClient({ supabaseUrl, anonKey, accessToken, fetchImpl = globalThis.fetch }) {
  if (!supabaseUrl || !anonKey) throw previewError(503, 'store-not-configured');
  if (!accessToken) throw previewError(401, 'anonymous');
  const client = { supabaseUrl, anonKey, accessToken, fetchImpl };
  return {
    async read(productId) {
      if (productId !== INTERNAL_PREVIEW_PRODUCT_ID) throw previewError(400, 'product');
      const body = await rpc(client, 'internal_preview_read', { product_id: productId });
      return confirmedState(body, { saved: false });
    },
    async apply(input) {
      requireEvent(input);
      const body = await rpc(client, 'internal_preview_apply_event', {
        event_id: input.eventId,
        product_id: input.productId,
        sha256: input.sha256,
        selected: input.selected,
        base_revision: input.baseRevision
      });
      const state = confirmedState(body, { saved: true });
      if (state.selected.includes(input.sha256) !== input.selected) throw previewError(503, 'readback');
      return state;
    }
  };
}
