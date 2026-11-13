import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAllowlistedProduct } from '../lib/internal-preview-allowlist.mjs';
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
    anonKey: memory.anonKey,
    accessToken: memory.accessToken,
    fetchImpl: memory.fetchImpl
  });
}

function seed(selections = []) {
  return createProductDbMemory({
    products: [
      { id: CAT_001, sku: 'CAT-001' },
      { id: CAT_003, sku: 'CAT-003' }
    ],
    selections,
    serviceRoleKey: SERVICE_KEY
  });
}

test('the stored CAT-001 id is the terrella-product-db uuid, not the formal store id', () => {
  assert.equal(CAT_001, '0f057213-b8af-4982-9e44-582a2a1d3469');
  assert.notEqual(CAT_001, FORMAL_STORE_PRODUCT_ID);
  assert.equal(INTERNAL_PREVIEW_SHA256.length, 4);
  assert.equal(resolveAllowlistedProduct({ name: 'TR260002' }), null);
  assert.equal(resolveAllowlistedProduct({ sku: 'CAT-003' }), null);
  assert.equal(resolveAllowlistedProduct({ code: 'TR260002' }).id, CAT_001);
});

test('writing then reading a selection uses product_id and sha256', async () => {
  const memory = seed([{ product_id: CAT_001, image_sha256: SECOND }]);
  const client = clientFor(memory);
  const written = await setSelection(client, { sku: 'CAT-001', sha256: FIRST, selected: true, expectedSelected: false });
  assert.equal(written.saved, true);
  assert.equal(written.store, SELECTION_STORE);
  assert.equal(written.productId, CAT_001);
  const read = await readStore(client, { productId: CAT_001 });
  assert.equal(read.saved, false);
  assert.deepEqual(read.selected, [SECOND, FIRST].sort());
  assert.equal(memory.calls.some((call) => call.keyInUrl), false);
  assert.equal(memory.calls.some((call) => call.authorization.includes(SERVICE_KEY)), false);
  assert.equal(memory.calls.some((call) => call.path.includes('product_assets') || call.path.endsWith('/products')), false);
});

test('unchecking deletes only that selection row', async () => {
  const memory = seed([
    { product_id: CAT_001, image_sha256: SECOND },
    { product_id: CAT_003, image_sha256: OTHER_SHA }
  ]);
  const client = clientFor(memory);
  await setSelection(client, { productId: CAT_001, sha256: FIRST, selected: true, expectedSelected: false });
  const removed = await setSelection(client, { productId: CAT_001, sha256: FIRST, selected: false, expectedSelected: true });
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

test('another existing product and a hash outside the four are rejected', async () => {
  const memory = seed();
  const client = clientFor(memory);
  const other = await setSelection(client, { sku: 'CAT-003', sha256: OTHER_SHA, selected: true, expectedSelected: false }).then(() => null, (error) => error);
  const named = await setSelection(client, { name: 'TR260002', sha256: FIRST, selected: true, expectedSelected: false }).then(() => null, (error) => error);
  const outside = await setSelection(client, { sku: 'CAT-001', sha256: OTHER_SHA, selected: true, expectedSelected: false }).then(() => null, (error) => error);
  assert.equal(other.reason, 'product');
  assert.equal(named.reason, 'product');
  assert.equal(outside.reason, 'sha256');
  assert.equal(memory.calls.some((call) => call.method === 'POST'), false);
  assert.equal(memory.selections.length, 0);
});

test('a stale expected state conflicts and does not overwrite the row', async () => {
  const memory = seed();
  const client = clientFor(memory);
  await setSelection(client, { sku: 'CAT-001', sha256: FIRST, selected: true, expectedSelected: false });
  const stale = await setSelection(client, { sku: 'CAT-001', sha256: FIRST, selected: false, expectedSelected: false }).then(() => null, (error) => error);
  assert.equal(stale.status, 409);
  assert.equal(stale.reason, 'conflict');
  assert.equal(stale.readback, true);
  assert.deepEqual(stale.selected, [FIRST]);
  assert.equal(memory.selections.some((row) => row.image_sha256 === FIRST), true);
  assert.equal(memory.calls.some((call) => call.method === 'DELETE'), false);
});

test('a failed write still returns the readback and does not claim it was saved', async () => {
  const memory = seed();
  const client = clientFor(memory);
  memory.beforeWrite = () => {
    memory.selections.push({ product_id: CAT_001, image_sha256: FIRST });
    return { status: 500, body: { message: 'failed' } };
  };
  const failed = await setSelection(client, { sku: 'CAT-001', sha256: FIRST, selected: true, expectedSelected: false }).then(() => null, (error) => error);
  assert.equal(failed.status, 503);
  assert.equal(failed.reason, 'store-not-writable');
  assert.equal(failed.readback, true);
  assert.deepEqual(failed.selected, [FIRST]);
  assert.equal(memory.selections.filter((row) => row.image_sha256 === FIRST).length, 1);
});

test('a write whose readback fails does not report the new selection', async () => {
  const memory = seed();
  const client = clientFor(memory);
  memory.readsUntilFailure = 1;
  const failed = await setSelection(client, { sku: 'CAT-001', sha256: FIRST, selected: true, expectedSelected: false }).then(() => null, (error) => error);
  assert.equal(failed.status, 503);
  assert.equal(failed.reason, 'readback');
  assert.equal(failed.readback, undefined);
  assert.equal(failed.selected, undefined);
  assert.equal(memory.selections.some((row) => row.image_sha256 === FIRST), true);
});

test('the formal store id is never written, and a foreign hash is omitted from readback', async () => {
  const memory = seed([
    { product_id: CAT_001, image_sha256: OTHER_SHA },
    { product_id: CAT_003, image_sha256: OTHER_SHA }
  ]);
  const client = clientFor(memory);
  const rejected = await setSelection(client, { productId: FORMAL_STORE_PRODUCT_ID, sku: 'CAT-001', sha256: FIRST, selected: true, expectedSelected: false }).then(() => null, (error) => error);
  assert.equal(rejected.reason, 'product');
  const mine = await readStore(client, { sku: 'CAT-001' });
  assert.deepEqual(mine.selected, []);
  const all = await readStore(client, { all: true });
  assert.deepEqual(all.selections, []);
});
