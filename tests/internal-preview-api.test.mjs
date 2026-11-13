import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { failureText, readStatus, writeStatus } from '../internal-preview-client.mjs';
import { handlePreview } from '../lib/internal-preview-http.mjs';
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
const ACCESS = 'test-preview-access-secret';
const SERVICE_KEY = 'test-service-role-not-a-secret';
const env = {
  TERRELLA_PRODUCT_DB_URL: 'https://product-db.test',
  TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY: SERVICE_KEY,
  TERRELLA_PREVIEW_ACCESS_SECRET: ACCESS
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
    serviceRoleKey: SERVICE_KEY
  });
}

async function session(body, { cookie = '', headers = {}, useEnv = env } = {}) {
  const req = {
    method: 'POST',
    url: '/api/internal-preview/session',
    headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  };
  const res = response();
  await handleSession(req, res, { env: useEnv, send: (target, status, payload) => {
    target.statusCode = status;
    target.setHeader('content-type', 'application/json; charset=utf-8');
    const confirmed = payload.ok === true && payload.durable === true && payload.store === 'terrella-product-db';
    const safe = { ...payload, ok: payload.ok === true, saved: confirmed && payload.saved === true, durable: confirmed };
    delete safe.secret;
    if (!confirmed) delete safe.store;
    target.end(JSON.stringify(safe));
  } });
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

async function login(useEnv = env) {
  const signed = await session({ secret: ACCESS }, { useEnv });
  assert.equal(signed.statusCode, 200);
  assert.equal(signed.json.signedIn, true);
  return cookieHeader(signed);
}

test('database env alone does not open a public write, and anon-key env is ignored', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('should-not-fetch'); };
  const dbOnly = await preview({
    method: 'POST',
    useEnv: { TERRELLA_PRODUCT_DB_URL: env.TERRELLA_PRODUCT_DB_URL, TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY: SERVICE_KEY },
    fetchImpl,
    headers: { 'x-preview-admin': 'true' },
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true }
  });
  const anon = await preview({
    method: 'POST',
    useEnv: { SUPABASE_URL: 'https://crm.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' },
    fetchImpl,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true }
  });
  assert.equal(dbOnly.statusCode, 503);
  assert.equal(dbOnly.json.reason, 'access-not-configured');
  assert.equal(dbOnly.json.saved, false);
  assert.equal(anon.statusCode, 503);
  assert.equal(anon.json.reason, 'access-not-configured');
  assert.equal(called, false);
});

test('a spoofed client flag and a missing cookie do not call the database', async () => {
  let called = false;
  const denied = await preview({
    method: 'POST',
    fetchImpl: async () => { called = true; throw new Error('should-not-fetch'); },
    headers: { 'x-preview-admin': 'true', authorization: `Bearer ${SERVICE_KEY}` },
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true, status: 'live' }
  });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json.reason, 'anonymous');
  assert.equal(denied.json.saved, false);
  assert.equal(called, false);
});

test('writing then reading persists by product_id and sha256 for a second cookie jar', async () => {
  const db = memory();
  const firstJar = await login();
  const secondJar = await login();
  const saved = await preview({
    method: 'POST',
    cookie: firstJar,
    fetchImpl: db.fetchImpl,
    body: { productId: PRODUCT_ID, sku: 'CAT-001', sha256: FIRST_SHA, selected: true, status: 'live' }
  });
  assert.equal(saved.json.saved, true);
  assert.equal(saved.json.store, 'terrella-product-db');
  assert.equal(saved.json.productId, PRODUCT_ID);
  assert.equal(saved.text.includes(ACCESS), false);
  assert.equal(saved.text.includes(SERVICE_KEY), false);
  const read = await preview({ cookie: secondJar, fetchImpl: db.fetchImpl });
  assert.equal(read.json.saved, false);
  assert.deepEqual(read.json.selected, [FIRST_SHA]);
  assert.equal(readStatus(read.json).ok, true);
  assert.equal(writeStatus(saved.json, { sha256: FIRST_SHA, want: true }).ok, true);
  const posted = db.calls.find((call) => call.method === 'POST');
  assert.deepEqual(Object.keys(JSON.parse(posted.body)).sort(), ['image_sha256', 'product_id']);
  assert.equal(posted.body.includes('live'), false);
  assert.equal(posted.authorization, `Bearer ${SERVICE_KEY}`);
  assert.equal(db.calls.some((call) => call.path.includes('product_assets')), false);
});

test('unchecking deletes only that row and leaves the product row', async () => {
  const db = memory();
  const cookie = await login();
  await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true } });
  await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: SECOND_SHA, selected: true } });
  await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-003', sha256: OTHER_SHA, selected: true } });
  const removed = await preview({
    method: 'POST',
    cookie,
    fetchImpl: db.fetchImpl,
    body: { productId: PRODUCT_ID, sha256: FIRST_SHA, selected: false }
  });
  assert.deepEqual(removed.json.selected, [SECOND_SHA]);
  assert.equal(db.products.length, 2);
  assert.equal(db.selections.some((row) => row.image_sha256 === FIRST_SHA), false);
  assert.equal(db.selections.some((row) => row.product_id === OTHER_ID && row.image_sha256 === OTHER_SHA), true);
  const other = await preview({ url: '/api/internal-preview?sku=CAT-003', cookie, fetchImpl: db.fetchImpl });
  assert.deepEqual(other.json.selected, [OTHER_SHA]);
});

test('a missing product, the formal store id, and a disallowed hash are not saved', async () => {
  const db = memory();
  const cookie = await login();
  const ledgerBefore = readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8');
  const fileBefore = readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8');
  const missing = await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-006', sha256: OTHER_SHA, selected: true } });
  const formal = await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { productId: FORMAL_STORE_PRODUCT_ID, sha256: FIRST_SHA, selected: true } });
  const outside = await preview({ method: 'POST', cookie, fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: OTHER_SHA, selected: true } });
  assert.equal(missing.json.reason, 'product');
  assert.equal(formal.json.reason, 'product');
  assert.equal(outside.json.reason, 'sha256');
  assert.equal(db.products.length, 2);
  assert.equal(db.selections.length, 0);
  assert.equal(readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8'), ledgerBefore);
  assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), fileBefore);
});

test('a valid gate still fails closed when the database env is missing', async () => {
  let called = false;
  const cookie = await login();
  const missing = await preview({
    method: 'POST',
    cookie,
    useEnv: { TERRELLA_PREVIEW_ACCESS_SECRET: ACCESS },
    fetchImpl: async () => { called = true; throw new Error('should-not-fetch'); },
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true }
  });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.json.reason, 'store-not-configured');
  assert.equal(called, false);
});

test('the catalog page does not embed the service role or a second selection schema', () => {
  assert.match(failureText('access-not-configured'), /失败关闭/);
  assert.match(failureText('product'), /没有新建商品/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const previewPage = readFileSync(new URL('../cat-001-internal-preview.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../internal-preview-client.mjs', import.meta.url), 'utf8');
  const runtime = [
    'api/internal-preview.js',
    'api/internal-preview/session.js',
    'lib/internal-preview-http.mjs',
    'lib/internal-preview-session.mjs',
    'lib/internal-preview-supabase.mjs',
    'lib/internal-preview-store.mjs'
  ].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  const browser = `${html}\n${previewPage}\n${client}`;
  assert.match(html, /id="preview-sign-in"/);
  assert.match(html, /id="publish-unavailable" disabled/);
  assert.match(html, /0f057213-b8af-4982-9e44-582a2a1d3469/);
  assert.equal(html.includes(FORMAL_STORE_PRODUCT_ID), false);
  assert.equal(html.includes('localStorage'), false);
  assert.equal(html.includes('sessionStorage'), false);
  assert.equal(browser.includes('TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY'), false);
  assert.equal(browser.includes(SERVICE_KEY), false);
  assert.equal(browser.includes(ACCESS), false);
  assert.equal(runtime.includes('SUPABASE_URL'), false);
  assert.equal(runtime.includes('SUPABASE_ANON_KEY'), false);
  assert.equal(runtime.includes('internal_preview'), false);
  assert.equal(runtime.includes('app_metadata'), false);
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
      body: JSON.stringify({ sku: 'CAT-001', sha256: FIRST_SHA, selected: true })
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
