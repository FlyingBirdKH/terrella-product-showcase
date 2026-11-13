import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { failureText, readStatus, writeStatus } from '../internal-preview-client.mjs';
import { handlePreview } from '../lib/internal-preview-http.mjs';
import { FORMAL_STORE_PRODUCT_ID, INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256 } from '../lib/internal-preview-store.mjs';
import { createProductDbClient } from '../lib/internal-preview-supabase.mjs';
import { createProductDbMemory } from './product-db-memory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT_ID = INTERNAL_PREVIEW_PRODUCT_ID;
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const FIRST_SHA = INTERNAL_PREVIEW_SHA256[0];
const SECOND_SHA = INTERNAL_PREVIEW_SHA256[1];
const OTHER_SHA = 'cd'.repeat(32);
const env = {
  TERRELLA_PRODUCT_DB_URL: 'https://product-db.test',
  TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY: 'test-service-role-not-a-secret'
};

function response() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(text) { this.text = text; this.json = JSON.parse(text); }
  };
}

function memory() {
  return createProductDbMemory({
    products: [
      { id: PRODUCT_ID, sku: 'CAT-001' },
      { id: OTHER_ID, sku: 'CAT-003' }
    ]
  });
}

async function preview({ method = 'GET', url = `/api/internal-preview?productId=${PRODUCT_ID}`, body, fetchImpl, useEnv = env }) {
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
  const res = response();
  await handlePreview(req, res, { env: useEnv, fetchImpl, clientFactory: createProductDbClient });
  return res;
}

test('crm-core env names do not configure the store', async () => {
  let called = false;
  const result = await preview({
    useEnv: { SUPABASE_URL: 'https://crm-core.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' },
    fetchImpl: async () => { called = true; return new Response('[]'); }
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.json.reason, 'store-not-configured');
  assert.equal(result.json.saved, false);
  assert.equal(result.json.store, undefined);
  assert.equal(called, false);
});

test('writing then reading a selection returns that product_id and sha256', async () => {
  const db = memory();
  const saved = await preview({
    method: 'POST',
    fetchImpl: db.fetchImpl,
    body: { productId: PRODUCT_ID, sku: 'CAT-001', sha256: FIRST_SHA, selected: true }
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json.saved, true);
  assert.equal(saved.json.durable, true);
  assert.equal(saved.json.store, 'terrella-product-db');
  assert.equal(saved.json.productId, PRODUCT_ID);
  assert.deepEqual(saved.json.selected, [FIRST_SHA]);
  assert.equal(saved.text.includes('test-service-role-not-a-secret'), false);
  const read = await preview({ fetchImpl: db.fetchImpl });
  assert.equal(read.json.saved, false);
  assert.deepEqual(read.json.selected, [FIRST_SHA]);
  assert.equal(readStatus(read.json).ok, true);
  assert.equal(writeStatus(saved.json, { sha256: FIRST_SHA, want: true }).ok, true);
});

test('unchecking deletes only that row and leaves the product row', async () => {
  const db = memory();
  await preview({ method: 'POST', fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true } });
  await preview({ method: 'POST', fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: SECOND_SHA, selected: true } });
  await preview({ method: 'POST', fetchImpl: db.fetchImpl, body: { sku: 'CAT-003', sha256: OTHER_SHA, selected: true } });
  const removed = await preview({
    method: 'POST',
    fetchImpl: db.fetchImpl,
    body: { productId: PRODUCT_ID, sha256: FIRST_SHA, selected: false }
  });
  assert.equal(removed.json.saved, true);
  assert.deepEqual(removed.json.selected, [SECOND_SHA]);
  assert.match(writeStatus(removed.json, { sha256: FIRST_SHA, want: false }).text, /去掉这张图的勾选/);
  assert.equal(db.products.some((row) => row.id === PRODUCT_ID), true);
  assert.equal(db.products.some((row) => row.id === OTHER_ID), true);
  assert.equal(db.selections.some((row) => row.product_id === PRODUCT_ID && row.image_sha256 === SECOND_SHA), true);
  assert.equal(db.selections.some((row) => row.product_id === OTHER_ID && row.image_sha256 === OTHER_SHA), true);
  assert.equal(db.selections.some((row) => row.image_sha256 === FIRST_SHA), false);
  const other = await preview({ url: `/api/internal-preview?sku=CAT-003`, fetchImpl: db.fetchImpl });
  assert.deepEqual(other.json.selected, [OTHER_SHA]);
  assert.equal(other.json.selected.includes(FIRST_SHA), false);
  assert.equal(other.json.selected.includes(SECOND_SHA), false);
});

test('a missing product, the formal store id, and a short hash are not saved', async () => {
  const db = memory();
  const ledgerBefore = readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8');
  const fileBefore = readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8');
  const missing = await preview({ method: 'POST', fetchImpl: db.fetchImpl, body: { sku: 'CAT-006', sha256: OTHER_SHA, selected: true } });
  const formal = await preview({ method: 'POST', fetchImpl: db.fetchImpl, body: { productId: FORMAL_STORE_PRODUCT_ID, sha256: FIRST_SHA, selected: true } });
  const short = await preview({ method: 'POST', fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: FIRST_SHA.slice(0, 8), selected: true } });
  const outside = await preview({ method: 'POST', fetchImpl: db.fetchImpl, body: { sku: 'CAT-001', sha256: OTHER_SHA, selected: true } });
  assert.equal(missing.json.reason, 'product');
  assert.equal(formal.json.reason, 'product');
  assert.equal(short.json.reason, 'sha256');
  assert.equal(outside.json.reason, 'sha256');
  assert.equal(missing.json.saved, false);
  assert.equal(formal.json.saved, false);
  assert.equal(db.products.length, 2);
  assert.equal(db.selections.length, 0);
  assert.equal(db.calls.some((call) => call.method !== 'GET' && call.path.includes('/products')), false);
  assert.equal(readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8'), ledgerBefore);
  assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), fileBefore);
});

test('a store failure does not report saved', async () => {
  const db = memory();
  const failed = await preview({
    method: 'POST',
    fetchImpl: async () => { throw new Error('offline'); },
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true }
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json.saved, false);
  assert.equal(failed.json.durable, false);
  const form = await preview({
    method: 'POST',
    fetchImpl: db.fetchImpl,
    body: { sku: 'CAT-001', sha256: FIRST_SHA, selected: true }
  });
  assert.equal(form.statusCode, 200);
  const denied = await preview({
    method: 'POST',
    url: '/api/internal-preview',
    fetchImpl: db.fetchImpl,
    body: undefined
  });
  const req = { method: 'POST', url: '/api/internal-preview', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'selected=true' };
  const res = response();
  await handlePreview(req, res, { env, fetchImpl: db.fetchImpl, clientFactory: createProductDbClient });
  assert.equal(denied.statusCode, 400);
  assert.equal(res.statusCode, 415);
  assert.equal(res.json.saved, false);
});

test('the catalog stays unauthenticated and does not receive the service-role key', () => {
  const fake = writeStatus({ ok: true, saved: true, selected: [FIRST_SHA] }, { sha256: FIRST_SHA, want: true });
  assert.equal(fake.ok, false);
  assert.match(failureText('product'), /没有新建商品/);
  assert.match(failureText('store-not-configured'), /失败关闭/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const previewPage = readFileSync(new URL('../cat-001-internal-preview.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../internal-preview-client.mjs', import.meta.url), 'utf8');
  const runtime = [
    'api/internal-preview.js',
    'lib/internal-preview-http.mjs',
    'lib/internal-preview-supabase.mjs',
    'lib/internal-preview-store.mjs'
  ].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  const browser = `${html}\n${previewPage}\n${client}`;
  assert.equal(html.includes('id="preview-sign-in"'), false);
  assert.equal(html.includes('type="password"'), false);
  assert.equal(previewPage.includes('type="password"'), false);
  assert.equal(html.includes('sessionStorage'), false);
  assert.equal(previewPage.includes('sessionStorage'), false);
  assert.match(html, /id="publish-unavailable" disabled/);
  assert.match(html, /fetch\('products\.json/);
  assert.match(html, /0f057213-b8af-4982-9e44-582a2a1d3469/);
  assert.equal(html.includes(FORMAL_STORE_PRODUCT_ID), false);
  assert.equal(previewPage.includes(FORMAL_STORE_PRODUCT_ID), false);
  assert.equal(browser.includes('TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY'), false);
  assert.equal(browser.includes('SUPABASE_SERVICE_ROLE'), false);
  assert.equal(browser.includes('NEXT_PUBLIC_'), false);
  assert.match(runtime, /TERRELLA_PRODUCT_DB_URL/);
  assert.match(runtime, /TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY/);
  assert.equal(runtime.includes('SUPABASE_URL'), false);
  assert.equal(runtime.includes('SUPABASE_ANON_KEY'), false);
  assert.equal(runtime.includes('internal_preview'), false);
  assert.equal(runtime.includes('crm-core'), false);
});

test('the unconfigured local server fails closed and does not write the json file', async () => {
  const beforeFile = readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8');
  const child = spawn(process.execPath, ['scripts/serve-with-internal-preview.mjs'], {
    cwd: root,
    env: { PATH: process.env.PATH, PORT: '0' },
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
    const write = await (await fetch(`${base}/api/internal-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const page = await (await fetch(`${base}/cat-001-internal-preview.html`)).text();
    const catalog = await (await fetch(`${base}/`)).text();
    assert.equal(read.saved, false);
    assert.equal(read.reason, 'store-not-configured');
    assert.equal(write.saved, false);
    assert.match(page, /内部预览 · 非公开 · 不是正式商城/);
    assert.equal(page.includes('已同步'), false);
    assert.equal(catalog.includes('type="password"'), false);
    assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), beforeFile);
  } finally {
    child.kill();
  }
});
