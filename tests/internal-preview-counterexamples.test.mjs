import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePreview, send } from '../lib/internal-preview-http.mjs';
import { handleSession } from '../lib/internal-preview-session.mjs';
import { INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256 } from '../lib/internal-preview-store.mjs';
import { createProductDbClient } from '../lib/internal-preview-supabase.mjs';
import { createProductDbMemory } from './product-db-memory.mjs';

const PRODUCT_ID = INTERNAL_PREVIEW_PRODUCT_ID;
const FIRST_SHA = INTERNAL_PREVIEW_SHA256[0];
const ANON = 'test-anon-key-not-a-secret';
const ADMIN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@example.test',
  password: 'test-password-not-a-secret',
  app_metadata: { terrella_brand_admin: 'terralla' }
};
const env = {
  TERRELLA_PRODUCT_DB_URL: 'https://product-db.test',
  TERRELLA_PRODUCT_DB_ANON_KEY: ANON
};

function response() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(text) { this.text = text; this.json = text ? JSON.parse(text) : null; }
  };
}

function memory() {
  return createProductDbMemory({
    products: [{ id: PRODUCT_ID, sku: 'CAT-001' }],
    anonKey: ANON,
    users: [ADMIN]
  });
}

async function session(db, body) {
  const req = {
    method: 'POST',
    url: '/api/internal-preview/session',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
  const res = response();
  await handleSession(req, res, { env, send, fetchImpl: db.fetchImpl });
  return res;
}

async function preview(db, { method = 'GET', url = `/api/internal-preview?productId=${PRODUCT_ID}`, cookie = '', body, fetchImpl = db.fetchImpl }) {
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
  const res = response();
  await handlePreview(req, res, { env, fetchImpl, clientFactory: createProductDbClient });
  return res;
}

async function login(db) {
  const signed = await session(db, { email: ADMIN.email, password: ADMIN.password });
  assert.equal(signed.statusCode, 200);
  return String(signed.headers['set-cookie']).split(';')[0];
}

function scriptReads(db, bodies) {
  const queue = [...bodies];
  const inner = db.fetchImpl;
  return async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && new URL(url).pathname.endsWith('/product_image_selections') && queue.length) {
      const script = queue.shift();
      return {
        ok: script.status >= 200 && script.status < 300,
        status: script.status,
        async text() { return script.body; }
      };
    }
    return inner(url, options);
  };
}

function assertReadFailure(result) {
  assert.equal(result.statusCode, 503);
  assert.equal(result.json.reason, 'readback');
  assert.equal(result.json.ok, false);
  assert.equal(result.json.saved, false);
  assert.equal(Object.hasOwn(result.json, 'selected'), false);
  assert.equal(Object.hasOwn(result.json, 'selections'), false);
  assert.notEqual(result.json.durable, true);
}

function interfere(db, mutate) {
  let done = false;
  const once = () => {
    if (done) return null;
    done = true;
    mutate();
    return null;
  };
  db.afterRead = once;
  db.beforeWrite = once;
}

test('a genuine empty selection stays distinct from a failed read', async () => {
  const db = memory();
  const cookie = await login(db);
  const empty = await preview(db, { cookie });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json.ok, true);
  assert.equal(empty.json.saved, false);
  assert.equal(empty.json.durable, true);
  assert.deepEqual(empty.json.selected, []);
});

for (const [name, body] of [
  ['200 + invalid JSON', '{'],
  ['200 + HTML', '<html><body>not a selection</body></html>'],
  ['200 + empty body', ''],
  ['200 + whitespace body', ' \n\t '],
  ['200 + JSON object instead of a row array', '{"selected":[]}'],
  ['200 + JSON array of the wrong element shape', '[null]']
]) {
  test(`a read of ${name} is a read failure, not an empty selection`, async () => {
    const db = memory();
    const cookie = await login(db);
    const failed = await preview(db, { cookie, fetchImpl: scriptReads(db, [{ status: 200, body }]) });
    assertReadFailure(failed);
    assert.equal(db.selections.length, 0);
  });
}

test('a write whose readback is 200 + HTML does not claim the save or an empty list', async () => {
  const db = memory();
  const cookie = await login(db);
  const failed = await preview(db, {
    method: 'POST',
    cookie,
    fetchImpl: scriptReads(db, [{ status: 200, body: '<html>readback failed</html>' }]),
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false }
  });
  assertReadFailure(failed);
  assert.equal(db.selections.some((row) => row.image_sha256 === FIRST_SHA), true);
  assert.equal(failed.json.saved, false);
});

test('another session inserting before the compare is not overwritten', async () => {
  const db = memory();
  const cookie = await login(db);
  interfere(db, () => {
    db.selections.push({ product_id: PRODUCT_ID, image_sha256: FIRST_SHA });
  });
  const raced = await preview(db, {
    method: 'POST',
    cookie,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false }
  });
  assert.equal(raced.statusCode, 409);
  assert.equal(raced.json.ok, false);
  assert.equal(raced.json.saved, false);
  assert.equal(raced.json.readback, true);
  assert.deepEqual(raced.json.selected, [FIRST_SHA]);
  assert.equal(db.selections.filter((row) => row.image_sha256 === FIRST_SHA).length, 1);
  assert.equal(db.calls.some((call) => call.method === 'DELETE'), false);
  assert.equal(db.calls.some((call) => call.method === 'POST' && call.path.endsWith('/product_image_selections')), false);
});

test('another session deleting before an unselect is not reported as saved and is not reinserted', async () => {
  const db = memory();
  db.selections.push({ product_id: PRODUCT_ID, image_sha256: FIRST_SHA });
  const cookie = await login(db);
  interfere(db, () => {
    const index = db.selections.findIndex((row) => row.image_sha256 === FIRST_SHA);
    if (index >= 0) db.selections.splice(index, 1);
  });
  const raced = await preview(db, {
    method: 'POST',
    cookie,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: false, expectedSelected: true }
  });
  assert.equal(raced.statusCode, 409);
  assert.equal(raced.json.saved, false);
  assert.equal(raced.json.readback, true);
  assert.deepEqual(raced.json.selected, []);
  assert.equal(db.selections.some((row) => row.image_sha256 === FIRST_SHA), false);
});

test('another session removing a row is not overwritten by a stale keep', async () => {
  const db = memory();
  db.selections.push({ product_id: PRODUCT_ID, image_sha256: FIRST_SHA });
  const cookie = await login(db);
  interfere(db, () => {
    db.selections.splice(0, db.selections.length);
  });
  const raced = await preview(db, {
    method: 'POST',
    cookie,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: true }
  });
  assert.equal(raced.statusCode, 409);
  assert.equal(raced.json.saved, false);
  assert.equal(raced.json.readback, true);
  assert.deepEqual(raced.json.selected, []);
  assert.equal(db.selections.length, 0);
});

test('another session selecting a row is not deleted by a stale clear', async () => {
  const db = memory();
  const cookie = await login(db);
  interfere(db, () => {
    db.selections.push({ product_id: PRODUCT_ID, image_sha256: FIRST_SHA });
  });
  const raced = await preview(db, {
    method: 'POST',
    cookie,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: false, expectedSelected: false }
  });
  assert.equal(raced.statusCode, 409);
  assert.equal(raced.json.saved, false);
  assert.equal(raced.json.readback, true);
  assert.deepEqual(raced.json.selected, [FIRST_SHA]);
  assert.equal(db.selections.filter((row) => row.image_sha256 === FIRST_SHA).length, 1);
});
