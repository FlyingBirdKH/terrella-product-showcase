import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { failureText, readStatus, writeStatus } from '../internal-preview-client.mjs';
import { handlePreview } from '../lib/internal-preview-http.mjs';
import { createSupabasePreviewClient } from '../lib/internal-preview-supabase.mjs';
import { FIRST_SHA, PRODUCT_ID, SECOND_SHA, psql } from './preview-postgres.mjs';
import { quietCount, startPreviewGateway } from './preview-rest-gateway.mjs';
import { recreateDatabase } from './preview-postgres.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const db = 'preview_contract_http';
let gateway;
let env;

function response() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(text) { this.text = text; this.json = JSON.parse(text); }
  };
}

async function preview({ method = 'GET', url = `/api/internal-preview?productId=${PRODUCT_ID}`, token = '', body, fetchImpl = globalThis.fetch, useEnv = env }) {
  const req = {
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body)
  };
  const res = response();
  await handlePreview(req, res, { env: useEnv, fetchImpl, clientFactory: createSupabasePreviewClient });
  return res;
}

before(async () => {
  await recreateDatabase(db);
  gateway = await startPreviewGateway(db);
  env = { SUPABASE_URL: gateway.url, SUPABASE_ANON_KEY: 'test-anon-key' };
});

after(async () => {
  if (gateway) await gateway.close();
});

async function managerToken() {
  return 'test.kevin_admin';
}

test('local gateway, not production: kevin_admin write is readable by terralla_team', async () => {
  await psql(db, 'truncate internal_preview.events');
  const token = await managerToken();
  const saved = await preview({
    method: 'POST',
    token,
    body: { eventId: 'evt-http-share-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 }
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json.saved, true);
  assert.equal(saved.json.durable, true);
  assert.equal(saved.json.store, 'supabase');
  const other = await preview({ token: 'test.terralla_team' });
  assert.deepEqual(other.json.selected, [FIRST_SHA]);
  assert.equal(other.json.saved, false);
  assert.equal(other.json.durable, true);
  const teamWrite = await preview({
    method: 'POST',
    token: 'test.terralla_team',
    body: { eventId: 'evt-team-http-000001', productId: PRODUCT_ID, sha256: SECOND_SHA, selected: true, baseRevision: 0 }
  });
  assert.equal(teamWrite.statusCode, 403);
  assert.equal(teamWrite.json.saved, false);
});

test('anonymous read and write are rejected and are not saved', async () => {
  const read = await preview({});
  const write = await preview({ method: 'POST', body: { eventId: 'evt-anon-http-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  assert.equal(read.statusCode, 401);
  assert.equal(write.statusCode, 401);
  assert.equal(read.json.saved, false);
  assert.equal(write.json.saved, false);
  assert.equal(read.json.durable, false);
  assert.equal(write.json.reason, 'anonymous');
});

test('terralla_team, supplier roles, and a plain authenticated role cannot write', async () => {
  await psql(db, 'truncate internal_preview.events');
  for (const token of ['test.terralla_team', 'test.admin', 'test.sourcing_manager', 'test.authenticated']) {
    const eventId = `evt-deny-${token.split('.').pop()}-00000001`;
    const write = await preview({ method: 'POST', token, body: { eventId, productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
    assert.equal(write.json.saved, false, token);
    assert.notEqual(write.statusCode, 200, token);
  }
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '0');
  assert.equal(await quietCount(db, 'select status from public.terralla_skus'), 'paused');
});

test('short sha and a mismatched product id are rejected without a saved flag', async () => {
  await psql(db, 'truncate internal_preview.events');
  const token = await managerToken();
  const ledgerBefore = readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8');
  const fileBefore = readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8');
  const short = await preview({ method: 'POST', token, body: { eventId: 'evt-short-http-00001', productId: PRODUCT_ID, sha256: FIRST_SHA.slice(0, 8), selected: true, baseRevision: 0 } });
  const other = await preview({ method: 'POST', token, body: { eventId: 'evt-product-http-001', productId: '00000000-0000-4000-8000-000000000000', sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json.reason, 'sha256');
  assert.equal(other.statusCode, 400);
  assert.equal(other.json.reason, 'product');
  assert.equal(short.json.saved, false);
  assert.equal(other.json.saved, false);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '0');
  assert.equal(readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8'), ledgerBefore);
  assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), fileBefore);
});

test('the same event posted twice is one row, and a revision race does not become success', async () => {
  await psql(db, 'truncate internal_preview.events');
  const token = await managerToken();
  const body = { eventId: 'evt-idem-http-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 };
  const first = await preview({ method: 'POST', token, body });
  const second = await preview({ method: 'POST', token, body });
  assert.equal(first.json.saved, true);
  assert.equal(second.json.idempotent, true);
  assert.equal(second.json.saved, true);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '1');
  const [left, right] = await Promise.all([
    preview({ method: 'POST', token, body: { eventId: 'evt-race-http-000001', productId: PRODUCT_ID, sha256: SECOND_SHA, selected: true, baseRevision: 0 } }),
    preview({ method: 'POST', token, body: { eventId: 'evt-race-http-000002', productId: PRODUCT_ID, sha256: SECOND_SHA, selected: true, baseRevision: 0 } })
  ]);
  const responses = [left, right];
  assert.equal(responses.filter((item) => item.json.saved === true).length, 1);
  assert.equal(responses.filter((item) => item.statusCode === 409 && item.json.saved === false && item.json.reason === 'revision_conflict').length, 1);
  assert.equal(await quietCount(db, `select count(*) from internal_preview.events where sha256 = '${SECOND_SHA}'`), '1');
});

test('a store failure does not report saved, and unbind does not delete the product', async () => {
  await psql(db, 'truncate internal_preview.events');
  const token = await managerToken();
  const failingFetch = async (url, options) => {
    if (String(url).includes('/rest/')) return new Response(JSON.stringify({ message: 'nope' }), { status: 500, headers: { 'content-type': 'application/json' } });
    return fetch(url, options);
  };
  const failed = await preview({
    method: 'POST',
    token,
    fetchImpl: failingFetch,
    body: { eventId: 'evt-fail-http-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 }
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json.saved, false);
  assert.equal(failed.json.durable, false);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '0');
  const missing = await preview({ method: 'POST', token, useEnv: {}, body: { eventId: 'evt-missing-00000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.json.reason, 'store-not-configured');
  assert.equal(missing.json.saved, false);
  const bound = await preview({ method: 'POST', token, body: { eventId: 'evt-bind-http-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  assert.equal(bound.json.saved, true);
  const unbound = await preview({ method: 'POST', token, body: { eventId: 'evt-unbind-http-0001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: false, baseRevision: 1 } });
  assert.equal(unbound.json.saved, true);
  assert.deepEqual(unbound.json.selected, []);
  assert.match(writeStatus(unbound.json, { sha256: FIRST_SHA, want: false }).text, /解绑/);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '2');
  assert.equal(await quietCount(db, 'select status from public.products'), 'paused');
});

test('success copy requires a durable shared readback, and the page no longer claims the file is shared', () => {
  const fake = writeStatus({ ok: true, saved: true, selected: [FIRST_SHA] }, { sha256: FIRST_SHA, want: true });
  assert.equal(fake.ok, false);
  assert.equal(fake.text.includes('已写入共享'), false);
  assert.match(failureText('store-not-configured'), /失败关闭/);
  assert.equal(readStatus({ ok: true, saved: true, durable: true, store: 'supabase', selected: [] }).ok, false);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../cat-001-internal-preview.html', import.meta.url), 'utf8');
  const runtime = [
    'api/internal-preview.js',
    'lib/internal-preview-http.mjs',
    'lib/internal-preview-supabase.mjs',
    'scripts/serve-with-internal-preview.mjs'
  ].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  assert.equal(html.includes('刷新或其他浏览器会读到同一份'), false);
  assert.equal(preview.includes('刷新或其他浏览器会读到同一份'), false);
  assert.equal(html.includes('preview-sign-in'), false);
  assert.equal(preview.includes('internal-preview-session'), false);
  assert.match(html, /id="publish-unavailable" disabled/);
  assert.match(preview, /正式上架\/下架不可用/);
  assert.equal(runtime.includes('SUPABASE_SERVICE_ROLE'), false);
  assert.equal(runtime.includes('service_role'), false);
  assert.equal(runtime.includes('internal-preview.json'), false);
  assert.equal(runtime.includes('writeFile'), false);
  assert.equal(runtime.includes('auth/v1/user'), false);
  assert.equal(runtime.includes('exchangePassword'), false);
  assert.equal(runtime.includes('current_app_role'), false);
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
    });
    const read = await (await fetch(`${base}/api/internal-preview?productId=${PRODUCT_ID}`)).json();
    const write = await (await fetch(`${base}/api/internal-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const page = await (await fetch(`${base}/cat-001-internal-preview.html`)).text();
    assert.equal(read.saved, false);
    assert.equal(read.reason, 'store-not-configured');
    assert.equal(write.saved, false);
    assert.match(page, /内部预览 · 非公开 · 不是正式商城/);
    assert.equal(page.includes('已同步'), false);
    assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), beforeFile);
  } finally {
    child.kill();
  }
});
