import {
  FORMAL_STORE_PRODUCT_ID,
  INTERNAL_PREVIEW_PRODUCT_ID,
  INTERNAL_PREVIEW_SHA256,
  INTERNAL_PREVIEW_SKU,
  SELECTION_STORE,
  isCat001Alias,
  isSha256,
  isSku,
  isUuid
} from './internal-preview-allowlist.mjs';
import { previewError } from './internal-preview-http.mjs';

const ALLOWED = new Set(INTERNAL_PREVIEW_SHA256);

export function productDbConfig(env) {
  const supabaseUrl = typeof env.TERRELLA_PRODUCT_DB_URL === 'string' ? env.TERRELLA_PRODUCT_DB_URL.trim() : '';
  const serviceRoleKey = typeof env.TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY === 'string' ? env.TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY.trim() : '';
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), serviceRoleKey };
}

function catalogSku(row) {
  return row.id === INTERNAL_PREVIEW_PRODUCT_ID ? INTERNAL_PREVIEW_SKU : row.sku;
}

function state(product, selected, saved) {
  return {
    ok: true,
    saved: saved === true,
    durable: true,
    store: SELECTION_STORE,
    productId: product.id,
    sku: catalogSku(product),
    selected
  };
}

async function rest(client, path, { method = 'GET', body, prefer } = {}) {
  if (path.startsWith('products') && method !== 'GET') throw previewError(503, 'store-not-writable');
  if (path.startsWith('product_assets') || path.includes('status=')) throw previewError(503, 'store-not-writable');
  if (!path.startsWith('products') && !path.startsWith('product_image_selections')) throw previewError(503, 'store-not-writable');
  const headers = {
    apikey: client.serviceRoleKey,
    authorization: `Bearer ${client.serviceRoleKey}`,
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
  if (!response.ok) throw previewError(503, 'store-not-writable');
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) throw previewError(503, 'readback');
  return parsed;
}

function asProduct(row) {
  if (!row || typeof row.id !== 'string' || typeof row.sku !== 'string') return null;
  const id = row.id.toLowerCase();
  if (!isUuid(id) || id === FORMAL_STORE_PRODUCT_ID) return null;
  if (!isSku(row.sku)) return null;
  return { id, sku: row.sku };
}

async function productById(client, id) {
  const rows = await rest(client, `products?id=eq.${id}&select=id,sku`);
  return rows.map(asProduct).filter(Boolean);
}

async function productsBySku(client, sku) {
  const rows = await rest(client, `products?sku=eq.${encodeURIComponent(sku)}&select=id,sku`);
  return rows.map(asProduct).filter(Boolean);
}

async function resolveProduct(client, { productId, sku }) {
  const id = typeof productId === 'string' ? productId.trim().toLowerCase() : '';
  const code = typeof sku === 'string' ? sku.trim() : '';
  if (id === FORMAL_STORE_PRODUCT_ID) throw previewError(400, 'product');
  if (id && !isUuid(id)) throw previewError(400, 'product');
  if (code && !isSku(code)) throw previewError(400, 'product');
  if (!id && !code) throw previewError(400, 'product');

  if (isCat001Alias(code) || id === INTERNAL_PREVIEW_PRODUCT_ID) {
    if (id && id !== INTERNAL_PREVIEW_PRODUCT_ID) throw previewError(400, 'product');
    const rows = await productById(client, INTERNAL_PREVIEW_PRODUCT_ID);
    if (rows.length !== 1 || rows[0].id !== INTERNAL_PREVIEW_PRODUCT_ID) throw previewError(400, 'product');
    return rows[0];
  }

  if (id) {
    const rows = await productById(client, id);
    if (rows.length !== 1 || rows[0].id !== id) throw previewError(400, 'product');
    if (code && rows[0].sku !== code) throw previewError(400, 'product');
    return rows[0];
  }

  const rows = await productsBySku(client, code);
  if (rows.length !== 1 || rows[0].sku !== code) throw previewError(400, 'product');
  return rows[0];
}

function requireSha(product, sha256) {
  const sha = typeof sha256 === 'string' ? sha256.trim().toLowerCase() : '';
  if (!isSha256(sha)) throw previewError(400, 'sha256');
  if (product.id === INTERNAL_PREVIEW_PRODUCT_ID && !ALLOWED.has(sha)) throw previewError(400, 'sha256');
  return sha;
}

function selectionRows(productId, rows) {
  const selected = [];
  for (const row of rows) {
    if (!row || String(row.product_id || '').toLowerCase() !== productId) throw previewError(503, 'readback');
    const sha = String(row.image_sha256 || '').toLowerCase();
    if (!isSha256(sha)) throw previewError(503, 'readback');
    if (productId === INTERNAL_PREVIEW_PRODUCT_ID && !ALLOWED.has(sha)) throw previewError(503, 'readback');
    selected.push(sha);
  }
  selected.sort();
  return selected;
}

async function listSelections(client, productId) {
  const rows = await rest(client, `product_image_selections?product_id=eq.${productId}&select=product_id,image_sha256`);
  return selectionRows(productId, rows);
}

function deletePath(productId, sha) {
  if (!isUuid(productId) || productId === FORMAL_STORE_PRODUCT_ID || !isSha256(sha)) throw previewError(400, 'product');
  return `product_image_selections?product_id=eq.${productId}&image_sha256=eq.${sha}`;
}

export function createProductDbClient({ supabaseUrl, serviceRoleKey, fetchImpl = globalThis.fetch }) {
  if (!supabaseUrl || !serviceRoleKey) throw previewError(503, 'store-not-configured');
  const client = { supabaseUrl, serviceRoleKey, fetchImpl };
  return {
    async read(query) {
      const product = await resolveProduct(client, query || {});
      const selected = await listSelections(client, product.id);
      return state(product, selected, false);
    },
    async readAll() {
      const rows = await rest(client, 'product_image_selections?select=product_id,image_sha256');
      const ids = [];
      for (const row of rows) {
        const id = row && typeof row.product_id === 'string' ? row.product_id.toLowerCase() : '';
        if (!isUuid(id) || id === FORMAL_STORE_PRODUCT_ID) continue;
        if (!ids.includes(id)) ids.push(id);
      }
      const products = ids.length
        ? (await rest(client, `products?id=in.(${ids.join(',')})&select=id,sku`)).map(asProduct).filter(Boolean)
        : [];
      const byId = new Map(products.map((row) => [row.id, row]));
      const selections = [];
      for (const row of rows) {
        const id = row && typeof row.product_id === 'string' ? row.product_id.toLowerCase() : '';
        const product = byId.get(id);
        if (!product) continue;
        const sha = String(row.image_sha256 || '').toLowerCase();
        if (!isSha256(sha)) continue;
        if (product.id === INTERNAL_PREVIEW_PRODUCT_ID && !ALLOWED.has(sha)) continue;
        selections.push({ productId: product.id, sku: catalogSku(product), sha256: sha });
      }
      selections.sort((a, b) => (a.productId + a.sha256).localeCompare(b.productId + b.sha256));
      return { ok: true, saved: false, durable: true, store: SELECTION_STORE, selections };
    },
    async apply(input) {
      if (!input || typeof input.selected !== 'boolean') throw previewError(400, 'selected');
      const product = await resolveProduct(client, input);
      const sha = requireSha(product, input.sha256);
      if (input.selected) {
        await rest(client, 'product_image_selections?on_conflict=product_id,image_sha256', {
          method: 'POST',
          prefer: 'resolution=ignore-duplicates,return=minimal',
          body: { product_id: product.id, image_sha256: sha }
        });
      } else {
        await rest(client, deletePath(product.id, sha), { method: 'DELETE', prefer: 'return=minimal' });
      }
      const selected = await listSelections(client, product.id);
      if (selected.includes(sha) !== input.selected) throw previewError(503, 'readback');
      return state(product, selected, true);
    }
  };
}
