import {
  SELECTION_STORE,
  allowlistedSha,
  isSha256,
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

function parsedJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function selectionList(value) {
  if (!Array.isArray(value)) return null;
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    if (typeof row.product_id !== 'string' || typeof row.image_sha256 !== 'string') return null;
  }
  return value;
}

async function callRest(client, path, { method = 'GET', body } = {}) {
  const headers = {
    apikey: client.anonKey,
    authorization: `Bearer ${client.accessToken}`,
    accept: 'application/json'
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
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
  const text = typeof response.text === 'function' ? await response.text() : '';
  const parsed = parsedJson(text);
  if (!response.ok) {
    const payload = parsed.ok ? parsed.value : null;
    const pgCode = payload && typeof payload.code === 'string' ? payload.code : '';
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
  return { status: response.status, parsed };
}

async function rest(client, path) {
  if (!path.startsWith('product_image_selections')) throw previewError(503, 'store-not-writable');
  if (path.includes('products') || path.includes('product_assets') || path.includes('status=')) {
    throw previewError(503, 'store-not-writable');
  }
  const result = await callRest(client, path);
  if (result.status === 204) throw previewError(503, 'readback');
  const rows = result.parsed.ok ? selectionList(result.parsed.value) : null;
  if (!rows) throw previewError(503, 'readback');
  return rows;
}

async function compareAndSwap(client, product, sha, expectedSelected, selected) {
  const result = await callRest(client, 'rpc/apply_image_selection', {
    method: 'POST',
    body: {
      product_id: product.id,
      image_sha256: sha,
      expected_selected: expectedSelected,
      selected
    }
  });
  const value = result.parsed.ok ? result.parsed.value : null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.applied !== 'boolean') {
    throw previewError(503, 'store-not-writable');
  }
  return value.applied === true;
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
      let applied = false;
      try {
        applied = await compareAndSwap(client, product, sha, input.expectedSelected, input.selected);
      } catch (error) {
        if (error && error.reason === 'product') throw error;
        const after = await readbackOrThrow(client, product);
        if (error && error.reason === 'conflict') throw conflict(product, after);
        throw previewError(503, 'store-not-writable', { readback: true, selected: after, product });
      }
      const after = await readbackOrThrow(client, product);
      if (applied !== true || after.includes(sha) !== input.selected) throw conflict(product, after);
      return state(product, after, true);
    }
  };
}
