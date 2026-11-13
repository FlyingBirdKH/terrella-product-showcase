import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORMAL_STORE_PRODUCT_ID,
  INTERNAL_PREVIEW_PRODUCT_ID,
  INTERNAL_PREVIEW_SHA256,
  SELECTION_STORE,
  readStore,
  setSelection
} from '../lib/internal-preview-store.mjs';
import { createProductDbClient } from '../lib/internal-preview-supabase.mjs';
import { createProductDbMemory } from './product-db-memory.mjs';

const CAT_001 = INTERNAL_PREVIEW_PRODUCT_ID;
const CAT_003 = '11111111-1111-4111-8111-111111111111';
const FIRST = INTERNAL_PREVIEW_SHA256[0];
const SECOND = INTERNAL_PREVIEW_SHA256[1];
const OTHER_SHA = 'ab'.repeat(32);
const SERVICE_KEY = 'test-service-role-not-a-secret';

function clientFor(memory) {
  return createProductDbClient({
    supabaseUrl: 'https://product-db.test',
    serviceRoleKey: SERVICE_KEY,
    fetchImpl: memory.fetchImpl
  });
}

function seed() {
  return createProductDbMemory({
    products: [
      { id: CAT_001, sku: 'CAT-001' },
      { id: CAT_003, sku: 'CAT-003' }
    ],
    selections: [
      { product_id: CAT_001, image_sha256: SECOND },
      { product_id: CAT_003, image_sha256: OTHER_SHA }
    ],
    serviceRoleKey: SERVICE_KEY
  });
}

test('the stored CAT-001 id is the terrella-product-db uuid, not the formal store id', () => {
  assert.equal(CAT_001, '0f057213-b8af-4982-9e44-582a2a1d3469');
  assert.notEqual(CAT_001, FORMAL_STORE_PRODUCT_ID);
  assert.equal(INTERNAL_PREVIEW_SHA256.length, 4);
});

test('writing then reading a selection uses product_id and sha256', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const written = await setSelection(client, { sku: 'CAT-001', sha256: FIRST, selected: true });
  assert.equal(written.saved, true);
  assert.equal(written.store, SELECTION_STORE);
  assert.equal(written.productId, CAT_001);
  const read = await readStore(client, { productId: CAT_001 });
  assert.equal(read.saved, false);
  assert.deepEqual(read.selected, [SECOND, FIRST].sort());
  assert.equal(memory.calls.some((call) => call.keyInUrl), false);
  assert.equal(memory.calls.some((call) => call.path.includes('product_assets')), false);
  assert.equal(memory.calls.some((call) => call.method !== 'GET' && call.path.endsWith('/products')), false);
});

test('unchecking deletes only that selection row', async () => {
  const memory = seed();
  const client = clientFor(memory);
  await setSelection(client, { productId: CAT_001, sha256: FIRST, selected: true });
  const removed = await setSelection(client, { productId: CAT_001, sha256: FIRST, selected: false });
  assert.equal(removed.selected.includes(FIRST), false);
  assert.equal(removed.selected.includes(SECOND), true);
  assert.equal(memory.selections.some((row) => row.product_id === CAT_003 && row.image_sha256 === OTHER_SHA), true);
  assert.equal(memory.products.length, 2);
  const deleted = memory.calls.filter((call) => call.method === 'DELETE');
  assert.equal(deleted.length, 1);
  assert.match(deleted[0].path, /\/product_image_selections$/);
  assert.match(deleted[0].search, new RegExp(`product_id=eq\\.${CAT_001}`));
  assert.match(deleted[0].search, new RegExp(`image_sha256=eq\\.${FIRST}`));
});

test('another SKU maps by products.sku, and a missing SKU does not create a product', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const written = await setSelection(client, { sku: 'CAT-003', sha256: OTHER_SHA, selected: true });
  assert.equal(written.productId, CAT_003);
  const missing = await setSelection(client, { sku: 'CAT-006', sha256: OTHER_SHA, selected: true }).then(() => null, (error) => error);
  assert.equal(missing.reason, 'product');
  assert.equal(memory.products.some((row) => row.sku === 'CAT-006'), false);
});

test('the formal store id is never written, and a CAT-001 read does not include another product', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const rejected = await setSelection(client, { productId: FORMAL_STORE_PRODUCT_ID, sku: 'CAT-001', sha256: FIRST, selected: true }).then(() => null, (error) => error);
  assert.equal(rejected.reason, 'product');
  assert.equal(memory.calls.some((call) => call.method === 'POST'), false);
  await setSelection(client, { productId: CAT_001, sha256: FIRST, selected: true });
  const other = await readStore(client, { sku: 'CAT-003' });
  assert.deepEqual(other.selected, [OTHER_SHA]);
  assert.equal(other.selected.includes(FIRST), false);
});
