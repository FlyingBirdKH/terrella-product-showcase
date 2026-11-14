// Pinned identities for terrella-product-db. Match id, SKU, or code only.
// CAT-003 and CAT-006 recovered hashes exist in an earlier draft, but that draft
// has no product UUID. They stay rejected until those ids are confirmed.
export const INTERNAL_PREVIEW_PRODUCT_ID = '0f057213-b8af-4982-9e44-582a2a1d3469';
export const FORMAL_STORE_PRODUCT_ID = '426bf18c-8649-4aa5-939c-f0b33eca95f8';
export const INTERNAL_PREVIEW_SKU = 'CAT-001';
export const INTERNAL_PREVIEW_CODE = 'TR260002';
export const SELECTION_STORE = 'terrella-product-db';

export const INTERNAL_PREVIEW_SHA256 = [
  'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
  'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
  '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
  '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
];

export const AUTHORIZED_PRODUCTS = [
  {
    id: INTERNAL_PREVIEW_PRODUCT_ID,
    sku: INTERNAL_PREVIEW_SKU,
    code: INTERNAL_PREVIEW_CODE,
    sha256: INTERNAL_PREVIEW_SHA256
  }
];

const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

export function isSha256(value) {
  return typeof value === 'string' && SHA.test(value);
}

export function isSku(value) {
  return typeof value === 'string' && SKU.test(value);
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveAllowlistedProduct({ productId, sku, code } = {}) {
  const id = clean(productId).toLowerCase();
  const skuText = clean(sku);
  const codeText = clean(code);
  if (!id && !skuText && !codeText) return null;
  if (productId != null && productId !== '' && !id) return null;
  if (id && (!isUuid(id) || id === FORMAL_STORE_PRODUCT_ID)) return null;
  if (skuText && !isSku(skuText)) return null;
  if (codeText && !isSku(codeText)) return null;
  const matches = AUTHORIZED_PRODUCTS.filter((product) => {
    if (id && product.id !== id) return false;
    if (skuText && product.sku !== skuText && product.code !== skuText) return false;
    if (codeText && product.code !== codeText) return false;
    return Boolean(id || skuText || codeText);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function allowlistedSha(product, sha256) {
  const sha = clean(sha256).toLowerCase();
  if (!product || !isSha256(sha)) return '';
  return product.sha256.includes(sha) ? sha : '';
}
