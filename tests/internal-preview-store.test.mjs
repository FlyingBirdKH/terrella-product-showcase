import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

function clientFor(memory) {
  return createProductDbClient({
    supabaseUrl: 'https://product-db.test',
    serviceRoleKey: 'test-service-role-not-a-secret',
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
    ]
  });
}

test('the stored CAT-001 id is the terrella-product-db uuid, not the formal store id', () => {
  assert.equal(CAT_001, '0f057213-b8af-4982-9e44-582a2a1d3469');
  assert.notEqual(CAT_001, FORMAL_STORE_PRODUCT_ID);
  assert.equal(INTERNAL_PREVIEW_SHA256.length, 4);
  for (const sha of INTERNAL_PREVIEW_SHA256) assert.match(sha, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8').includes(FIRST), false);
});

test('writing then reading a selection uses product_id and sha256', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const written = await setSelection(client, { sku: 'CAT-001', sha256: FIRST, selected: true });
  assert.equal(written.saved, true);
  assert.equal(written.store, SELECTION_STORE);
  assert.equal(written.productId, CAT_001);
  assert.equal(written.selected.includes(FIRST), true);
  const read = await readStore(client, { productId: CAT_001 });
  assert.equal(read.saved, false);
  assert.deepEqual(read.selected, [SECOND, FIRST].sort());
  const row = memory.selections.find((item) => item.image_sha256 === FIRST);
  assert.equal(row.product_id, CAT_001);
  assert.equal(memory.calls.some((call) => call.keyInUrl), false);
  assert.equal(memory.calls.some((call) => call.path.includes('/products') && call.method !== 'GET'), false);
});

test('unchecking deletes only that selection row', async () => {
  const memory = seed();
  const client = clientFor(memory);
  await setSelection(client, { productId: CAT_001, sku: 'CAT-001', sha256: FIRST, selected: true });
  const beforeProducts = memory.products.map((row) => row.id);
  const removed = await setSelection(client, { productId: CAT_001, sha256: FIRST, selected: false });
  assert.equal(removed.saved, true);
  assert.equal(removed.selected.includes(FIRST), false);
  assert.equal(removed.selected.includes(SECOND), true);
  assert.equal(memory.selections.some((row) => row.product_id === CAT_001 && row.image_sha256 === FIRST), false);
  assert.equal(memory.selections.some((row) => row.product_id === CAT_001 && row.image_sha256 === SECOND), true);
  assert.equal(memory.selections.some((row) => row.product_id === CAT_003 && row.image_sha256 === OTHER_SHA), true);
  assert.deepEqual(memory.products.map((row) => row.id), beforeProducts);
  const deleted = memory.calls.filter((call) => call.method === 'DELETE');
  assert.equal(deleted.length, 1);
  assert.match(deleted[0].path, /^\/rest\/v1\/product_image_selections$/);
  assert.match(deleted[0].search, new RegExp(`product_id=eq\\.${CAT_001}`));
  assert.match(deleted[0].search, new RegExp(`image_sha256=eq\\.${FIRST}`));
});

test('another SKU maps by products.sku, and a missing SKU does not create a product', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const written = await setSelection(client, { sku: 'CAT-003', sha256: OTHER_SHA, selected: true });
  assert.equal(written.productId, CAT_003);
  assert.equal(written.sku, 'CAT-003');
  const missing = await setSelection(client, { sku: 'CAT-006', sha256: OTHER_SHA, selected: true }).then(() => null, (error) => error);
  assert.equal(missing.reason, 'product');
  assert.equal(memory.products.some((row) => row.sku === 'CAT-006'), false);
  assert.equal(memory.products.length, 2);
});

test('the formal store id is never written', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const rejected = await setSelection(client, { productId: FORMAL_STORE_PRODUCT_ID, sku: 'CAT-001', sha256: FIRST, selected: true }).then(() => null, (error) => error);
  assert.equal(rejected.reason, 'product');
  assert.equal(memory.selections.some((row) => row.product_id === FORMAL_STORE_PRODUCT_ID), false);
  assert.equal(memory.calls.some((call) => call.method === 'POST'), false);
});

test('CAT-001 rejects a hash outside the four-image allowlist', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const rejected = await setSelection(client, { sku: 'CAT-001', sha256: OTHER_SHA, selected: true }).then(() => null, (error) => error);
  assert.equal(rejected.reason, 'sha256');
  assert.equal(memory.selections.some((row) => row.image_sha256 === OTHER_SHA && row.product_id === CAT_001), false);
});

test('a CAT-001 read does not include another product row', async () => {
  const memory = seed();
  const client = clientFor(memory);
  await setSelection(client, { productId: CAT_001, sha256: FIRST, selected: true });
  const cat001 = await readStore(client, { sku: 'CAT-001' });
  const cat003 = await readStore(client, { sku: 'CAT-003' });
  assert.equal(cat001.selected.includes(FIRST), true);
  assert.equal(cat001.selected.includes(OTHER_SHA), false);
  assert.deepEqual(cat003.selected, [OTHER_SHA]);
  assert.equal(cat003.selected.includes(FIRST), false);
});
