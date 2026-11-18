export {
  FORMAL_STORE_PRODUCT_ID,
  INTERNAL_PREVIEW_CODE,
  INTERNAL_PREVIEW_PRODUCT_ID,
  INTERNAL_PREVIEW_SHA256,
  INTERNAL_PREVIEW_SKU,
  SELECTION_STORE
} from './internal-preview-allowlist.mjs';
export { createProductDbClient, productDbConfig } from './internal-preview-supabase.mjs';

export async function readStore(client, query) {
  if (!client || typeof client.read !== 'function') {
    const error = new Error('store-not-configured');
    error.status = 503;
    error.reason = 'store-not-configured';
    throw error;
  }
  if (query && query.all === true) return client.readAll();
  return client.read(query || {});
}

export async function setSelection(client, input) {
  if (!client || typeof client.apply !== 'function') {
    const error = new Error('store-not-configured');
    error.status = 503;
    error.reason = 'store-not-configured';
    throw error;
  }
  return client.apply(input);
}
