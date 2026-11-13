export { INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256 } from './internal-preview-allowlist.mjs';

export async function readStore() {
  const error = new Error('file-store-retired');
  error.status = 503;
  error.reason = 'store-not-configured';
  throw error;
}

export async function setSelection() {
  const error = new Error('file-store-retired');
  error.status = 503;
  error.reason = 'store-not-configured';
  throw error;
}
