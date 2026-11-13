import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { failureText, readStatus, writeStatus } from '../internal-preview-client.mjs';
import { handlePreview, send } from '../lib/internal-preview-http.mjs';
import { handleSession } from '../lib/internal-preview-session.mjs';
import { FORMAL_STORE_PRODUCT_ID, INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256 } from '../lib/internal-preview-store.mjs';
import { createProductDbClient } from '../lib/internal-preview-supabase.mjs';
import { createProductDbMemory } from './product-db-memory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_ID = INTERNAL_PREVIEW_PRODUCT_ID;
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_SHA = INTERNAL_PREVIEW_SHA256[0];
const SECOND_SHA = INTERNAL_PREVIEW_SHA256[1];
const OTHER_SHA = 'cd'.repeat(32);
const ANON = 'test-anon-key-not-a-secret';
const SERVICE_KEY = 'test-service-role-not-a-secret';
const ADMIN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@example.test',
  password: 'test-password-not-a-secret',
  app_metadata: { terrella_brand_admin: 'terralla' },
  user_metadata: { terrella_brand_admin: 'ignored' }
};
const READER = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'reader@example.test',
  password: 'test-reader-password-not-a-secret',
  app_metadata: { terrella_brand_reader: 'terralla' },
  user_metadata: { terrella_brand_admin: 'terralla' }
};
const METADATA_ONLY = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  email: 'meta@example.test',
  password: 'test-meta-password-not-a-secret',
  app_metadata: {},
  user_metadata: { terrella_brand_admin: 'terralla' }
};
const MISMATCH = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  reportedId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  email: 'mismatch@example.test',
  password: 'test-mismatch-password-not-a-secret',
  app_metadata: { terrella_brand_admin: 'terralla' }
};
const env = {
  TERRELLA_PRODUCT_DB_URL: 'https://product-db.test',
  TERRELLA_PRODUCT_DB_ANON_KEY: ANON,
  TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY: SERVICE_KEY
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

function cookieHeader(res) {
  const raw = res.headers['set-cookie'] || '';
  return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0];
}

function memory() {
  return createProductDbMemory({
    products: [
      { id: PRODUCT_ID, sku: 'CAT-001' },
      { id: OTHER_ID, sku: 'CAT-003' }
    ],
    anonKey: ANON,
    serviceRoleKey: SERVICE_KEY,
    users: [ADMIN, READER, METADATA_ONLY, MISMATCH]
  });
}

async function session(body, { cookie = '', headers = {}, useEnv = env, fetchImpl } = {}) {
  const req = {
    method: 'POST',
    url: '/api/internal-preview/session',
    headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  };
  const res = response();
  await handleSession(req, res, { env: useEnv, send, fetchImpl });
  return res;
}

async function preview({ method = 'GET', url = `/api/internal-preview?productId=${PRODUCT_ID}`, cookie = '', headers = {}, body, fetchImpl, useEnv = env }) {
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
  const res = response();
  await handlePreview(req, res, { env: useEnv, fetchImpl, clientFactory: createProductDbClient });
  return res;
}

async function login(db, user = ADMIN) {
  const signed = await session({ email: user.email, password: user.password }, { fetchImpl: db.fetchImpl });
  assert.equal(signed.statusCode, 200);
  assert.equal(signed.json.signedIn, true);
  assert.equal(signed.text.includes(user.password), false);
  assert.equal(signed.text.includes('access_token'), false);
  return cookieHeader(signed);
}

test('database env alone does not open a public write, and a service-role env is ignored', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('should-not-fetch'); };
  const dbOnly = await preview({
    method: 'POST',
    useEnv: { TERRELLA_PRODUCT_DB_URL: env.TERRELLA_PRODUCT_DB_URL, TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY: SERVICE_KEY },
    fetchImpl,
    headers: { 'x-preview-admin': 'true' },
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false }
  });
  const anon = await preview({
    method: 'POST',
    useEnv: { SUPABASE_URL: 'https://crm.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' },
    fetchImpl,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false }
  });
  assert.equal(dbOnly.statusCode, 503);
  assert.equal(dbOnly.json.reason, 'access-not-configured');
  assert.equal(dbOnly.json.saved, false);
  assert.equal(anon.statusCode, 503);
  assert.equal(anon.json.reason, 'access-not-configured');
  assert.equal(called, false);
});

test('a spoofed client flag and a service-role bearer do not call the database', async () => {
  let called = false;
  const denied = await preview({
    method: 'POST',
    fetchImpl: async () => { called = true; throw new Error('should-not-fetch'); },
    headers: { 'x-preview-admin': 'true', authorization: `Bearer ${SERVICE_KEY}` },
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false, status: 'live' }
  });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json.reason, 'anonymous');
  assert.equal(denied.json.saved, false);
  assert.equal(called, false);
});

test('a shared passphrase, metadata-only claim, and mismatched sub do not sign in', async () => {
  const db = memory();
  const shared = await session({ secret: 'shared-preview-password' }, { fetchImpl: db.fetchImpl });
  const metadata = await session({ email: METADATA_ONLY.email, password: METADATA_ONLY.password }, { fetchImpl: db.fetchImpl });
  const mismatch = await session({ email: MISMATCH.email, password: MISMATCH.password }, { fetchImpl: db.fetchImpl });
  assert.equal(shared.statusCode, 401);
  assert.equal(shared.json.reason, 'access-rejected');
  assert.equal(metadata.statusCode, 403);
  assert.equal(metadata.json.reason, 'brand-access-missing');
  assert.equal(mismatch.statusCode, 401);
  assert.equal(mismatch.json.reason, 'identity');
  assert.equal(shared.headers['set-cookie'], undefined);
  assert.equal(metadata.headers['set-cookie'], undefined);
  assert.equal(db.calls.some((call) => call.method !== 'GET' && call.path.includes('product_image_selections')), false);
});

test('a reader can read and cannot write', async () => {
  const db = memory();
  const cookie = await login(db, READER);
  const read = await preview({ cookie, fetchImpl: db.fetchImpl });
  const write = await preview({
    method: 'POST',
    cookie,
    fetchImpl: db.fetchImpl,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false }
  });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json.selected, []);
  assert.equal(write.statusCode, 403);
  assert.equal(write.json.reason, 'brand-admin-missing');
  assert.equal(write.json.saved, false);
  assert.equal(db.calls.some((call) => call.method === 'POST' && call.path.includes('product_image_selections')), false);
});

test('writing then reading persists by product_id and sha256 for a second named session', async () => {
  const db = memory();
  const firstJar = await login(db);
  const secondJar = await login(db);
  const saved = await preview({
    method: 'POST',
    cookie: firstJar,
    fetchImpl: db.fetchImpl,
    body: { productId: PRODUCT_ID, sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false, status: 'live' }
  });
  assert.equal(saved.json.saved, true);
  assert.equal(saved.json.store, 'terrella-product-db');
  assert.equal(saved.json.productId, PRODUCT_ID);
  assert.equal(saved.text.includes(ADMIN.password), false);
  assert.equal(saved.text.includes(SERVICE_KEY), false);
  assert.equal(saved.text.includes(ANON), false);
  const read = await preview({ cookie: secondJar, fetchImpl: db.fetchImpl });
  assert.equal(read.json.saved, false);
  assert.deepEqual(read.json.selected, [FIRST_SHA]);
  assert.equal(readStatus(read.json).ok, true);
  assert.equal(writeStatus(saved.json, { sha256: FIRST_SHA, want: true }).ok, true);
  const posted = db.calls.find((call) => call.method === 'POST' && call.path.includes('product_image_selections'));
  assert.deepEqual(Object.keys(JSON.parse(posted.body)).sort(), ['image_sha256', 'product_id']);
  assert.equal(posted.body.includes('live'), false);
  assert.equal(posted.apikey, ANON);
  assert.equal(posted.authorization.startsWith('Bearer '), true);
  assert.equal(posted.authorization.includes(SERVICE_KEY), false);
  assert.equal(db.calls.some((call) => call.path.includes('product_assets') || call.path.endsWith('/products')), false);
});

test('unchecking deletes only that row and leaves the product row', async () => {
  const db = memory();
  const cookie = await login(db);
  await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false } });
  await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: SECOND_SHA, selected: true, expectedSelected: false } });
  const removed = await preview({
    method: 'POST',
    cookie,
    fetchImpl: db.fetchImpl,
    body: { productId: PRODUCT_ID, sha256: FIRST_SHA, selected: false, expectedSelected: true }
  });
  assert.deepEqual(removed.json.selected, [SECOND_SHA]);
  assert.equal(db.products.length, 2);
  assert.equal(db.selections.some((row) => row.image_sha256 === FIRST_SHA), false);
});

test('a missing product, the formal store id, and a disallowed hash are not saved', async () => {
  const db = memory();
  const cookie = await login(db);
  const ledgerBefore = readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8');
  const fileBefore = readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8');
  const missing = await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-006', sha256: OTHER_SHA, selected: true, expectedSelected: false } });
  const present = await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-003', sha256: OTHER_SHA, selected: true, expectedSelected: false } });
  const formal = await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { productId: FORMAL_STORE_PRODUCT_ID, sha256: FIRST_SHA, selected: true, expectedSelected: false } });
  const outside = await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: OTHER_SHA, selected: true, expectedSelected: false } });
  assert.equal(missing.json.reason, 'product');
  assert.equal(present.json.reason, 'product');
  assert.equal(formal.json.reason, 'product');
  assert.equal(outside.json.reason, 'sha256');
  assert.equal(db.products.length, 2);
  assert.equal(db.selections.length, 0);
  assert.equal(readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8'), ledgerBefore);
  assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), fileBefore);
});

test('a stale writer receives the current rows and does not delete them', async () => {
  const db = memory();
  const cookie = await login(db);
  await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false } });
  const conflict = await preview({
    method: 'POST',
    cookie,
    fetchImpl: db.fetchImpl,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: false, expectedSelected: false }
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json.saved, false);
  assert.equal(conflict.json.ok, false);
  assert.equal(conflict.json.readback, true);
  assert.equal(conflict.json.durable, true);
  assert.equal(conflict.json.store, 'terrella-product-db');
  assert.deepEqual(conflict.json.selected, [FIRST_SHA]);
  assert.equal(writeStatus(conflict.json, { sha256: FIRST_SHA, want: false }).readback, true);
  assert.equal(db.selections.some((row) => row.image_sha256 === FIRST_SHA), true);
  assert.equal(db.calls.filter((call) => call.method === 'DELETE').length, 0);
});

test('a committed write that reports failure is judged from the readback', async () => {
  const db = memory();
  const cookie = await login(db);
  db.beforeWrite = () => {
    db.selections.push({ product_id: PRODUCT_ID, image_sha256: FIRST_SHA });
    return { status: 500, body: { message: 'failed' } };
  };
  const failed = await preview({
    method: 'POST',
    cookie,
    fetchImpl: db.fetchImpl,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false }
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json.saved, false);
  assert.equal(failed.json.readback, true);
  assert.deepEqual(failed.json.selected, db.selections.map((row) => row.image_sha256));
  db.readsUntilFailure = 1;
  db.beforeWrite = null;
  const unread = await preview({
    method: 'POST',
    cookie,
    fetchImpl: db.fetchImpl,
    body: { sku: 'CAT-001', sha256: SECOND_SHA, selected: true, expectedSelected: false }
  });
  assert.equal(unread.statusCode, 503);
  assert.equal(unread.json.reason, 'readback');
  assert.equal(unread.json.saved, false);
  assert.equal(unread.json.selected, undefined);
  assert.equal(db.selections.some((row) => row.image_sha256 === SECOND_SHA), true);
});

test('logout revokes the token that the cookie was carrying', async () => {
  const db = memory();
  const cookie = await login(db);
  const out = await session({ action: 'logout' }, { cookie, fetchImpl: db.fetchImpl });
  assert.equal(out.json.signedIn, false);
  const again = await preview({ cookie, fetchImpl: db.fetchImpl });
  assert.equal(again.statusCode, 401);
  assert.equal(again.json.reason, 'anonymous');
});

test('the catalog page does not embed a database key or a shared passphrase', () => {
  assert.match(failureText('access-not-configured'), /失败关闭/);
  assert.match(failureText('product'), /没有新建商品/);
  assert.match(failureText('conflict'), /读回/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const previewPage = readFileSync(new URL('../cat-001-internal-preview.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../internal-preview-client.mjs', import.meta.url), 'utf8');
  const identity = readFileSync(new URL('../lib/internal-preview-identity.mjs', import.meta.url), 'utf8');
  const runtime = [
    'api/internal-preview.js',
    'api/internal-preview/session.js',
    'lib/internal-preview-http.mjs',
    'lib/internal-preview-session.mjs',
    'lib/internal-preview-supabase.mjs',
    'lib/internal-preview-store.mjs',
    'lib/internal-preview-identity.mjs',
    'lib/internal-preview-allowlist.mjs'
  ].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  const browser = `${html}\n${previewPage}\n${client}`;
  assert.match(html, /id="preview-sign-in"/);
  assert.match(html, /id="preview-email"/);
  assert.match(html, /id="preview-password"/);
  assert.equal(html.includes('preview-secret'), false);
  assert.match(html, /id="publish-unavailable" disabled/);
  assert.match(html, /0f057213-b8af-4982-9e44-582a2a1d3469/);
  assert.equal(html.includes(FORMAL_STORE_PRODUCT_ID), false);
  assert.equal(html.includes('localStorage'), false);
  assert.equal(html.includes('sessionStorage'), false);
  assert.equal(browser.includes('TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY'), false);
  assert.equal(browser.includes('TERRELLA_PRODUCT_DB_ANON_KEY'), false);
  assert.equal(browser.includes(SERVICE_KEY), false);
  assert.equal(browser.includes(ANON), false);
  assert.equal(runtime.includes('TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY'), false);
  assert.equal(runtime.includes('TERRELLA_PREVIEW_ACCESS_SECRET'), false);
  assert.match(identity, /app_metadata/);
  assert.equal(identity.includes('user_metadata'), false);
  assert.equal(runtime.includes('internal_preview'), false);
  assert.equal(runtime.includes('crm-core'), false);
});

test('the unconfigured local server fails closed and does not write the json file', async () => {
  const beforeFile = readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8');
  const child = spawn(process.execPath, ['scripts/serve-with-internal-preview.mjs'], {
    cwd: root,
    env: { PATH: process.env.PATH, PORT: '0', TERRELLA_PRODUCT_DB_URL: 'https://product-db.test', TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY: SERVICE_KEY },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
      child.stdout.on('data', (chunk) => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      child.stderr.on('data', () => {});
    });
    const read = await (await fetch(`${base}/api/internal-preview?productId=${PRODUCT_ID}`)).json();
    const write = await (await fetch(`${base}/api/internal-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-preview-admin': 'true' },
      body: JSON.stringify({ sku: 'CAT-001', sha256: FIRST_SHA, selected: true, expectedSelected: false })
    })).json();
    assert.equal(read.reason, 'access-not-configured');
    assert.equal(read.saved, false);
    assert.equal(write.reason, 'access-not-configured');
    assert.equal(write.saved, false);
    assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), beforeFile);
  } finally {
    child.kill();
  }
});
