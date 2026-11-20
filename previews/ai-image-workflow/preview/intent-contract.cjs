// Design-preview contract. No network, approval persistence, or uploads.
const CATALOG = 'https://catalog.example.invalid/';
function imageIdentity(product, image) {
  if (!/^CAT-\d{3}$/.test(product.sku || '') || !product.code) throw new Error('missing-product-identity');
  const url = new URL(image.path);
  if (url.protocol !== 'https:' || url.hostname !== 'images.example.invalid' || url.search || url.hash) throw new Error('invalid-image-url');
  const sha256 = (image.outputSha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('missing-output-hash');
  const skuToken = image.path.match(/(?:\/|ai-)(CAT-\d{3})(?:\/|-)/g) || [];
  if (!skuToken.length || skuToken.some(x => !x.includes(product.sku))) throw new Error('wrong-product-path');
  if (image.assignedSku && image.assignedSku !== product.sku) throw new Error('wrong-product-assignment');
  const version = image.version || url.pathname.match(/\/ai\/([^/]+)\//)?.[1];
  if (!version) throw new Error('missing-version');
  return { sku: product.sku, productCode: product.code, imageUrl: url.href, outputSha256: sha256, version, target: CATALOG };
}
function keyFor(identity) {
  return JSON.stringify([identity.sku, identity.productCode, identity.imageUrl, identity.outputSha256, identity.version, identity.target]);
}
function createDraft(selectedProducts, selectedImages, baselineId, currentIdentities) {
  if (!baselineId) throw new Error('missing-baseline');
  const seen = new Set(), images = [];
  for (const identity of selectedImages) {
    if (identity.target !== CATALOG) throw new Error('target-not-authorized');
    const key = keyFor(identity);
    if (!currentIdentities.has(key)) throw new Error('stale-image-selection');
    if (!seen.has(key)) { seen.add(key); images.push(identity); }
  }
  return {
    schemaVersion: 1, type: 'unsubmitted-intent-draft', mode: 'local-design-preview',
    baselineId, target: CATALOG, submissionReceipt: null, approvedBy: null,
    generationRequests: [...new Map(selectedProducts.map(p => [p.sku, p])).values()],
    imageSelections: images,
    warning: 'Only a selection draft. This is not a server request, Kevin approval, upload receipt, or publication authorization.'
  };
}
if (typeof module !== 'undefined') module.exports = { CATALOG, imageIdentity, keyFor, createDraft };
