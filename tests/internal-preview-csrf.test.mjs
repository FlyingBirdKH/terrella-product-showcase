import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { previewFetch, resetPreviewSession } from '../internal-preview-client.mjs';
import { SESSION_MAX_AGE } from '../lib/internal-preview-session.mjs';
import { recreateDatabase } from './preview-postgres.mjs';
import { startPreviewGateway } from './preview-rest-gateway.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const db = 'preview_contract_csrf';
let gateway;
let server;
let base;

function cookiePairs(response) {
  return response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
}

function maxAge(response, name) {
  const row = response.headers.getSetCookie().find((item) => item.startsWith(`${name}=`));
  const match = row && row.match(/Max-Age=(\d+)/);
  return match ? Number(match[1]) : null;
}

async function startServer() {
  server = spawn(process.execPath, ['scripts/serve-with-internal-preview.mjs'], {
    cwd: root,
    env: { PATH: process.env.PATH, PORT: '0', SUPABASE_URL: gateway.url, SUPABASE_ANON_KEY: 'test-anon-key' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
    server.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
}

before(async () => {
  await recreateDatabase(db);
  gateway = await startPreviewGateway(db);
  await startServer();
});

after(async () => {
  if (server) server.kill();
  if (gateway) await gateway.close();
});

test('real local server, not the gateway alone: same-origin login sets distinct cookie lifetimes', async () => {
  const origin = new URL(base).origin;
  const response = await fetch(`${base}/api/internal-preview-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ email: 'brand@example.test', password: 'test-password-only' })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.signedIn, true);
  assert.equal(body.brandAdmin, true);
  assert.equal(JSON.stringify(body).includes('test.brand-admin'), false);
  const cookies = response.headers.getSetCookie().join('\n');
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /Secure/);
  assert.equal(maxAge(response, 'terrella_preview_at'), 3600);
  assert.equal(maxAge(response, 'terrella_preview_rt'), SESSION_MAX_AGE);
  assert.notEqual(maxAge(response, 'terrella_preview_rt'), 3600);
});

test('real local server rejects cross-site login, logout, and refresh, and a browser missing Origin', async () => {
  const origin = new URL(base).origin;
  const beforeHits = gateway.hits.length;
  const cross = {
    'content-type': 'application/json',
    origin: 'https://evil.example',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  };
  for (const body of [
    { email: 'brand@example.test', password: 'test-password-only' },
    { action: 'logout' },
    { action: 'refresh' }
  ]) {
    const response = await fetch(`${base}/api/internal-preview-session`, { method: 'POST', headers: cross, body: JSON.stringify(body) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'csrf');
  }
  const missingOrigin = await fetch(`${base}/api/internal-preview-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    },
    body: JSON.stringify({ email: 'brand@example.test', password: 'test-password-only' })
  });
  assert.equal(missingOrigin.status, 403);
  const form = await fetch(`${base}/api/internal-preview-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=brand@example.test&password=test-password-only'
  });
  assert.equal(form.status, 403);
  assert.equal(gateway.hits.length, beforeHits);
  const serverSide = await fetch(`${base}/api/internal-preview-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ email: 'brand@example.test', password: 'test-password-only' })
  });
  assert.equal(serverSide.status, 200);
  assert.equal((await serverSide.json()).signedIn, true);
});

test('real local server refresh keeps the original deadline and logout clears the cookies', async () => {
  const login = await fetch(`${base}/api/internal-preview-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ email: 'brand@example.test', password: 'test-password-only' })
  });
  const until = Math.floor(Date.now() / 1000) + 20;
  const pairs = cookiePairs(login).split('; ').filter((item) => !item.startsWith('terrella_preview_until='));
  pairs.push(`terrella_preview_until=${until}`);
  const refreshed = await fetch(`${base}/api/internal-preview-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-proto': 'https',
      cookie: pairs.join('; ')
    },
    body: JSON.stringify({ action: 'refresh' })
  });
  assert.equal(refreshed.status, 200);
  assert.equal(JSON.stringify(await refreshed.clone().json()).includes('test.brand-admin'), false);
  const refreshAge = maxAge(refreshed, 'terrella_preview_rt');
  assert.ok(refreshAge > 0 && refreshAge <= 20);
  assert.notEqual(refreshAge, 3600);
  const loggedOut = await fetch(`${base}/api/internal-preview-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-proto': 'https',
      cookie: cookiePairs(refreshed)
    },
    body: JSON.stringify({ action: 'logout' })
  });
  assert.equal((await loggedOut.json()).signedIn, false);
  assert.equal(maxAge(loggedOut, 'terrella_preview_at'), 0);
  assert.equal(maxAge(loggedOut, 'terrella_preview_rt'), 0);
  assert.equal(maxAge(loggedOut, 'terrella_preview_until'), 0);
});

test('the page refresh helper retries once and does not loop', async () => {
  resetPreviewSession();
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).includes('internal-preview-session')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 401 });
  };
  try {
    await previewFetch('/api/internal-preview?productId=x');
    await previewFetch('/api/internal-preview?productId=x');
    assert.equal(seen.filter((item) => item.includes('internal-preview-session')).length, 1);
    assert.equal(seen.filter((item) => item.includes('/api/internal-preview?')).length, 3);
  } finally {
    globalThis.fetch = original;
    resetPreviewSession();
  }
});
