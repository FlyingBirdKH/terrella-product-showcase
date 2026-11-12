import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { failureText, readStatus, writeStatus } from '../internal-preview-client.mjs';
import { handlePreview } from '../lib/internal-preview-http.mjs';
import { handleSession } from '../lib/internal-preview-session.mjs';
import { createSupabasePreviewClient } from '../lib/internal-preview-supabase.mjs';
import { FIRST_SHA, PRODUCT_ID, psql } from './preview-postgres.mjs';
import { quietCount, startPreviewGateway } from './preview-rest-gateway.mjs';
import { recreateDatabase } from './preview-postgres.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const db = 'preview_contract_http';
let gateway;
let env;

function response() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(text) { this.text = text; this.json = JSON.parse(text); }
  };
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((item) => item.split(';')[0]).join('; ');
}

async function preview({ method = 'GET', url = `/api/internal-preview?productId=${PRODUCT_ID}`, cookie = '', body, fetchImpl = globalThis.fetch, useEnv = env }) {
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
  const res = response();
  await handlePreview(req, res, { env: useEnv, fetchImpl, clientFactory: createSupabasePreviewClient });
  return res;
}

async function session(body, { cookie = '', method = 'POST' } = {}) {
  const req = {
    method,
    url: '/api/internal-preview-session',
    headers: { 'x-forwarded-proto': 'https', 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
  const res = response();
  await handleSession(req, res, { env, fetchImpl: globalThis.fetch, send: (target, status, payload) => {
    target.statusCode = status;
    target.setHeader('content-type', 'application/json; charset=utf-8');
    target.setHeader('cache-control', 'no-store');
    const confirmed = payload.ok === true && payload.durable === true && payload.store === 'supabase';
    const safe = { ...payload, ok: payload.ok === true, saved: confirmed && payload.saved === true, durable: confirmed };
    if (!confirmed) delete safe.store;
    target.end(JSON.stringify(safe));
  } });
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

test('local gateway, not production: password login sets an HttpOnly cookie and does not return the token', async () => {
  const signed = await session({ email: 'brand@example.test', password: 'test-password-only' });
  assert.equal(signed.statusCode, 200);
  assert.equal(signed.json.signedIn, true);
  assert.equal(signed.json.brandAdmin, true);
  assert.equal(signed.json.saved, false);
  assert.equal(signed.text.includes('test.brand-admin'), false);
  assert.equal(signed.text.includes('access_token'), false);
  const cookies = signed.headers['set-cookie'].join('\n');
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /Secure/);
  assert.equal(gateway.hits.some((hit) => hit.includes('invite') || hit.includes('/admin/')), false);
  const cookie = cookieHeader(signed);
  const saved = await preview({
    method: 'POST',
    cookie,
    body: { eventId: 'evt-http-share-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 }
  });
  assert.equal(saved.json.saved, true);
  const other = await preview({ cookie });
  assert.deepEqual(other.json.selected, [FIRST_SHA]);
  assert.equal(other.json.saved, false);
});

test('anonymous read and write are rejected and are not saved', async () => {
  const bearer = await preview({ method: 'POST', body: { eventId: 'evt-bearer-000000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  const read = await preview({});
  assert.equal(read.statusCode, 401);
  assert.equal(bearer.statusCode, 401);
  assert.equal(read.json.saved, false);
  assert.equal(bearer.json.saved, false);
});

test('login without the brand claim, a forged user_metadata claim, and a supplier role do not save', async () => {
  await psql(db, 'truncate internal_preview.events');
  for (const email of ['plain@example.test', 'supplier@example.test']) {
    const signed = await session({ email, password: 'test-password-only' });
    assert.equal(signed.json.signedIn, true, email);
    assert.equal(signed.json.brandAdmin, false, email);
    assert.equal(signed.json.reason, 'brand-access-missing');
    assert.equal(signed.json.saved, false);
    const write = await preview({
      method: 'POST',
      cookie: cookieHeader(signed),
      body: { eventId: `evt-${email.slice(0, 5)}-00000001`, productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 }
    });
    assert.equal(write.statusCode, 403);
    assert.equal(write.json.reason, 'brand-access-missing');
    assert.equal(write.json.saved, false);
  }
  const reader = await session({ email: 'reader@example.test', password: 'test-password-only' });
  assert.equal(reader.json.signedIn, true);
  assert.equal(reader.json.brandAdmin, false);
  assert.equal(reader.json.brandReader, true);
  assert.equal(reader.json.reason, 'brand-reader');
  const readerRead = await preview({ cookie: cookieHeader(reader) });
  assert.equal(readerRead.statusCode, 200);
  assert.equal(readerRead.json.saved, false);
  const readerWrite = await preview({
    method: 'POST',
    cookie: cookieHeader(reader),
    body: { eventId: 'evt-reader-http-00001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 }
  });
  assert.equal(readerWrite.statusCode, 403);
  assert.equal(readerWrite.json.reason, 'brand-admin-missing');
  assert.equal(readerWrite.json.saved, false);
  const signup = await session({ action: 'signup', email: 'new@example.test', password: 'test-password-only' });
  assert.equal(signup.statusCode, 405);
  assert.equal(signup.json.signedIn, false);
  assert.equal(gateway.hits.some((hit) => hit.includes('invite') || hit.includes('/admin/')), false);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '0');
});

test('short sha and a mismatched product id are rejected without a saved flag', async () => {
  await psql(db, 'truncate internal_preview.events');
  const signed = await session({ email: 'brand@example.test', password: 'test-password-only' });
  const cookie = cookieHeader(signed);
  const ledgerBefore = readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8');
  const fileBefore = readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8');
  const short = await preview({ method: 'POST', cookie, body: { eventId: 'evt-short-http-00001', productId: PRODUCT_ID, sha256: FIRST_SHA.slice(0, 8), selected: true, baseRevision: 0 } });
  const other = await preview({ method: 'POST', cookie, body: { eventId: 'evt-product-http-001', productId: '00000000-0000-4000-8000-000000000000', sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json.reason, 'sha256');
  assert.equal(other.json.reason, 'product');
  assert.equal(short.json.saved, false);
  assert.equal(other.json.saved, false);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '0');
  assert.equal(readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8'), ledgerBefore);
  assert.equal(readFileSync(new URL('../internal-preview.json', import.meta.url), 'utf8'), fileBefore);
});

test('the same event posted twice is one row, and a revision race does not become success', async () => {
  await psql(db, 'truncate internal_preview.events');
  const cookie = cookieHeader(await session({ email: 'brand@example.test', password: 'test-password-only' }));
  const body = { eventId: 'evt-idem-http-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 };
  const first = await preview({ method: 'POST', cookie, body });
  const second = await preview({ method: 'POST', cookie, body });
  assert.equal(first.json.saved, true);
  assert.equal(second.json.idempotent, true);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '1');
  const [left, right] = await Promise.all([
    preview({ method: 'POST', cookie, body: { eventId: 'evt-race-http-000001', productId: PRODUCT_ID, sha256: 'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4', selected: true, baseRevision: 0 } }),
    preview({ method: 'POST', cookie, body: { eventId: 'evt-race-http-000002', productId: PRODUCT_ID, sha256: 'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4', selected: true, baseRevision: 0 } })
  ]);
  assert.equal([left, right].filter((item) => item.json.saved === true).length, 1);
  assert.equal([left, right].filter((item) => item.statusCode === 409 && item.json.saved === false).length, 1);
});

test('a store failure does not report saved, and unbind does not delete the product', async () => {
  await psql(db, 'truncate internal_preview.events');
  const cookie = cookieHeader(await session({ email: 'brand@example.test', password: 'test-password-only' }));
  const failingFetch = async (url, options) => {
    if (String(url).includes('/rest/')) return new Response(JSON.stringify({ message: 'nope' }), { status: 500, headers: { 'content-type': 'application/json' } });
    return fetch(url, options);
  };
  const failed = await preview({
    method: 'POST',
    cookie,
    fetchImpl: failingFetch,
    body: { eventId: 'evt-fail-http-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 }
  });
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.json.saved, false);
  const missing = await preview({ method: 'POST', cookie, useEnv: {}, body: { eventId: 'evt-missing-00000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.json.reason, 'store-not-configured');
  const bound = await preview({ method: 'POST', cookie, body: { eventId: 'evt-bind-http-000001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: true, baseRevision: 0 } });
  const unbound = await preview({ method: 'POST', cookie, body: { eventId: 'evt-unbind-http-0001', productId: PRODUCT_ID, sha256: FIRST_SHA, selected: false, baseRevision: 1 } });
  assert.equal(unbound.json.saved, true);
  assert.deepEqual(unbound.json.selected, []);
  assert.match(writeStatus(unbound.json, { sha256: FIRST_SHA, want: false }).text, /解绑/);
  assert.equal(await quietCount(db, 'select count(*) from internal_preview.events'), '2');
  assert.equal(await quietCount(db, 'select status from public.products'), 'paused');
});

test('success copy requires a durable shared readback, and the catalog page does not store a JWT', () => {
  const fake = writeStatus({ ok: true, saved: true, selected: [FIRST_SHA] }, { sha256: FIRST_SHA, want: true });
  assert.equal(fake.ok, false);
  assert.match(failureText('brand-admin-missing'), /不能补这个声明/);
  assert.equal(readStatus({ ok: true, saved: true, durable: true, store: 'supabase', selected: [] }).ok, false);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const previewPage = readFileSync(new URL('../cat-001-internal-preview.html', import.meta.url), 'utf8');
  const runtime = [
    'api/internal-preview.js',
    'api/internal-preview-session.js',
    'lib/internal-preview-http.mjs',
    'lib/internal-preview-session.mjs',
    'lib/internal-preview-supabase.mjs'
  ].map((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
  assert.match(html, /id="preview-sign-in"/);
  assert.match(html, /credentials:\s*'same-origin'/);
  assert.equal(html.includes('sessionStorage'), false);
  assert.equal(previewPage.includes('sessionStorage'), false);
  assert.match(html, /id="publish-unavailable" disabled/);
  assert.match(html, /fetch\('products\.json/);
  assert.equal(runtime.includes('SUPABASE_SERVICE_ROLE'), false);
  assert.equal(runtime.includes('service_role'), false);
  assert.equal(runtime.includes('/invite'), false);
  assert.equal(runtime.includes('admin/users'), false);
  assert.equal(runtime.includes('user_metadata'), false);
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
