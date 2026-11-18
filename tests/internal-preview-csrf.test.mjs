import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePreview } from '../lib/internal-preview-http.mjs';
import { GATE_COOKIE, handleSession } from '../lib/internal-preview-session.mjs';
import { send } from '../lib/internal-preview-http.mjs';
import { createProductDbClient } from '../lib/internal-preview-supabase.mjs';
import { createProductDbMemory } from './product-db-memory.mjs';

const ANON = 'test-anon-key-not-a-secret';
const EMAIL = 'admin@example.test';
const PASSWORD = 'test-password-not-a-secret';
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
  return createProductDbMemory({ anonKey: ANON, products: [], users: [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: EMAIL,
    password: PASSWORD,
    app_metadata: { terrella_brand_admin: 'terralla' }
  }] });
}

async function session(body, headers = {}, fetchImpl = memory().fetchImpl) {
  const req = {
    method: 'POST',
    url: '/api/internal-preview/session',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  };
  const res = response();
  await handleSession(req, res, { env, send, fetchImpl });
  return res;
}

test('login sets an HttpOnly cookie that is not the password', async () => {
  const db = memory();
  const signed = await session({ email: EMAIL, password: PASSWORD }, {}, db.fetchImpl);
  assert.equal(signed.statusCode, 200);
  assert.equal(signed.json.signedIn, true);
  assert.equal(signed.text.includes(PASSWORD), false);
  const cookie = signed.headers['set-cookie'];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, new RegExp(`^${GATE_COOKIE}=`));
  assert.equal(cookie.includes(PASSWORD), false);
  const wrong = await session({ email: EMAIL, password: 'wrong-password' }, {}, db.fetchImpl);
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json.signedIn, false);
  assert.equal(wrong.headers['set-cookie'], undefined);
});

test('cross-site, form, and browser requests without Origin do not open the gate', async () => {
  const db = memory();
  const cross = await session({ email: EMAIL, password: PASSWORD }, {
    origin: 'https://evil.example',
    host: 'preview.example',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  }, db.fetchImpl);
  const form = await session({ email: EMAIL, password: PASSWORD }, { 'content-type': 'application/x-www-form-urlencoded', host: 'preview.example' }, db.fetchImpl);
  const browser = await session({ email: EMAIL, password: PASSWORD }, {
    host: 'preview.example',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  }, db.fetchImpl);
  assert.equal(cross.statusCode, 403);
  assert.equal(form.statusCode, 403);
  assert.equal(browser.statusCode, 403);
  assert.equal(cross.json.signedIn, false);
  assert.equal(db.calls.length, 0);
});

test('a same-origin browser login works, and a cross-site write never reaches the database', async () => {
  const db = memory();
  const signed = await session({ email: EMAIL, password: PASSWORD }, {
    host: 'preview.example',
    origin: 'https://preview.example',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  }, db.fetchImpl);
  assert.equal(signed.json.signedIn, true);
  let called = false;
  const req = {
    method: 'POST',
    url: '/api/internal-preview',
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example',
      host: 'preview.example',
      'sec-fetch-site': 'cross-site',
      cookie: signed.headers['set-cookie'].split(';')[0]
    },
    body: JSON.stringify({ sku: 'CAT-001', sha256: 'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342', selected: true, expectedSelected: false })
  };
  const res = response();
  await handlePreview(req, res, {
    env,
    fetchImpl: async () => { called = true; throw new Error('should-not-fetch'); },
    clientFactory: createProductDbClient
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json.saved, false);
  assert.equal(called, false);
});

test('refresh and signup actions are not an auth-user API', async () => {
  const db = memory();
  const refresh = await session({ action: 'refresh', email: EMAIL, password: PASSWORD }, {}, db.fetchImpl);
  const signup = await session({ action: 'signup', email: EMAIL, password: PASSWORD }, {}, db.fetchImpl);
  assert.equal(refresh.statusCode, 405);
  assert.equal(signup.statusCode, 405);
  assert.equal(refresh.json.signedIn, false);
  assert.equal(db.calls.length, 0);
});
