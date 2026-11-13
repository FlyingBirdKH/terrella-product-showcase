import {
  FORMAL_STORE_PRODUCT_ID,
  SELECTION_STORE,
  allowlistedSha,
  isSha256,
  isUuid,
  resolveAllowlistedProduct
} from './internal-preview-allowlist.mjs';
import { previewError } from './internal-preview-http.mjs';

export function productDbConfig(env) {
  const source = env || {};
  const supabaseUrl = typeof source.TERRELLA_PRODUCT_DB_URL === 'string' ? source.TERRELLA_PRODUCT_DB_URL.trim() : '';
  const anonKey = typeof source.TERRELLA_PRODUCT_DB_ANON_KEY === 'string' ? source.TERRELLA_PRODUCT_DB_ANON_KEY.trim() : '';
  if (!supabaseUrl || !anonKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), anonKey };
}

function state(product, selected, saved) {
  return {
    ok: true,
    saved: saved === true,
    durable: true,
    store: SELECTION_STORE,
    productId: product.id,
    sku: product.sku,
    selected
  };
}

async function rest(client, path, { method = 'GET', body, prefer } = {}) {
  if (!path.startsWith('product_image_selections')) throw previewError(503, 'store-not-writable');
  if (path.includes('products') || path.includes('product_assets') || path.includes('status=')) {
    throw previewError(503, 'store-not-writable');
  }
  const headers = {
    apikey: client.anonKey,
    authorization: `Bearer ${client.accessToken}`,
    accept: 'application/json'
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;
  let response;
  try {
    response = await client.fetchImpl(`${client.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw previewError(503, 'store-not-writable');
  }
  if (response.status === 204) return [];
  const text = typeof response.text === 'function' ? await response.text() : '';
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const pgCode = parsed && typeof parsed.code === 'string' ? parsed.code : '';
    const error = previewError(503, 'store-not-writable');
    error.pgCode = pgCode;
    error.httpStatus = response.status;
    if (pgCode === '23503') {
      error.status = 400;
      error.reason = 'product';
    } else if (pgCode === '23505' || response.status === 409) {
      error.status = 409;
      error.reason = 'conflict';
    }
    throw error;
  }
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) throw previewError(503, 'readback');
  return parsed;
}

function selectionRows(product, rows) {
  const selected = [];
  for (const row of rows) {
    if (!row || String(row.product_id || '').toLowerCase() !== product.id) throw previewError(503, 'readback');
    const sha = String(row.image_sha256 || '').toLowerCase();
    if (!isSha256(sha)) throw previewError(503, 'readback');
    if (!allowlistedSha(product, sha)) continue;
    selected.push(sha);
  }
  selected.sort();
  return selected;
}

async function listSelections(client, product) {
  const rows = await rest(client, `product_image_selections?product_id=eq.${product.id}&select=product_id,image_sha256`);
  return selectionRows(product, rows);
}

async function readbackOrThrow(client, product) {
  try {
    return await listSelections(client, product);
  } catch {
    throw previewError(503, 'readback');
  }
}

function conflict(product, selected) {
  return previewError(409, 'conflict', { readback: true, selected, product });
}

function deletePath(productId, sha) {
  if (!isUuid(productId) || productId === FORMAL_STORE_PRODUCT_ID || !isSha256(sha)) throw previewError(400, 'product');
  return `product_image_selections?product_id=eq.${productId}&image_sha256=eq.${sha}`;
}

export function createProductDbClient({ supabaseUrl, anonKey, accessToken, fetchImpl = globalThis.fetch }) {
  if (!supabaseUrl || !anonKey || !accessToken) throw previewError(503, 'store-not-configured');
  const client = { supabaseUrl, anonKey, accessToken, fetchImpl };
  return {
    async read(query) {
      const product = resolveAllowlistedProduct(query || {});
      if (!product) throw previewError(400, 'product');
      const selected = await listSelections(client, product);
      return state(product, selected, false);
    },
    async readAll() {
      const rows = await rest(client, 'product_image_selections?select=product_id,image_sha256');
      const selections = [];
      for (const row of rows) {
        const id = row && typeof row.product_id === 'string' ? row.product_id.toLowerCase() : '';
        const product = resolveAllowlistedProduct({ productId: id });
        if (!product) continue;
        const sha = allowlistedSha(product, row.image_sha256);
        if (!sha) continue;
        selections.push({ productId: product.id, sku: product.sku, sha256: sha });
      }
      selections.sort((a, b) => (a.productId + a.sha256).localeCompare(b.productId + b.sha256));
      return { ok: true, saved: false, durable: true, store: SELECTION_STORE, selections };
    },
    async apply(input) {
      if (!input || typeof input.selected !== 'boolean') throw previewError(400, 'selected');
      if (typeof input.expectedSelected !== 'boolean') throw previewError(400, 'expected');
      const product = resolveAllowlistedProduct(input);
      if (!product) throw previewError(400, 'product');
      const sha = allowlistedSha(product, input.sha256);
      if (!sha) throw previewError(400, 'sha256');
      const before = await listSelections(client, product);
      if (before.includes(sha) !== input.expectedSelected) throw conflict(product, before);
      if (before.includes(sha) === input.selected) return state(product, before, true);
      try {
        if (input.selected) {
          await rest(client, 'product_image_selections', {
            method: 'POST',
            prefer: 'return=representation',
            body: { product_id: product.id, image_sha256: sha }
          });
        } else {
          await rest(client, deletePath(product.id, sha), { method: 'DELETE', prefer: 'return=representation' });
        }
      } catch (error) {
        if (error && error.reason === 'product') throw error;
        const after = await readbackOrThrow(client, product);
        if (error && error.reason === 'conflict') throw conflict(product, after);
        throw previewError(503, 'store-not-writable', { readback: true, selected: after, product });
      }
      const after = await readbackOrThrow(client, product);
      if (after.includes(sha) !== input.selected) throw conflict(product, after);
      return state(product, after, true);
    }
  };
}
