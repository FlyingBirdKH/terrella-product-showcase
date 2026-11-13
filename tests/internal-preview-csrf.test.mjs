import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePreview } from '../lib/internal-preview-http.mjs';
import { GATE_COOKIE, handleSession } from '../lib/internal-preview-session.mjs';
import { createProductDbClient } from '../lib/internal-preview-supabase.mjs';

const ACCESS = 'test-preview-access-secret';
const env = { TERRELLA_PREVIEW_ACCESS_SECRET: ACCESS };

function response() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(text) { this.text = text; this.json = text ? JSON.parse(text) : null; }
  };
}

async function session(body, headers = {}) {
  const req = {
    method: 'POST',
    url: '/api/internal-preview-session',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  };
  const res = response();
  await handleSession(req, res, {
    env,
    send(target, status, payload) {
      target.statusCode = status;
      target.setHeader('content-type', 'application/json; charset=utf-8');
      const safe = { ...payload };
      delete safe.secret;
      target.end(JSON.stringify(safe));
    }
  });
  return res;
}

test('login sets an HttpOnly cookie that is not the access secret', async () => {
  const signed = await session({ secret: ACCESS });
  assert.equal(signed.statusCode, 200);
  assert.equal(signed.json.signedIn, true);
  assert.equal(signed.text.includes(ACCESS), false);
  const cookie = signed.headers['set-cookie'];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, new RegExp(`^${GATE_COOKIE}=`));
  assert.equal(cookie.includes(ACCESS), false);
  const wrong = await session({ secret: 'wrong-secret' });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.json.signedIn, false);
  assert.equal(wrong.headers['set-cookie'], undefined);
});

test('cross-site, form, and browser requests without Origin do not open the gate', async () => {
  const cross = await session({ secret: ACCESS }, {
    origin: 'https://evil.example',
    host: 'preview.example',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  });
  const form = await session({ secret: ACCESS }, { 'content-type': 'application/x-www-form-urlencoded', host: 'preview.example' });
  const browser = await session({ secret: ACCESS }, {
    host: 'preview.example',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  });
  assert.equal(cross.statusCode, 403);
  assert.equal(form.statusCode, 403);
  assert.equal(browser.statusCode, 403);
  assert.equal(cross.json.signedIn, false);
});

test('a same-origin browser login works, and a cross-site write never reaches the database', async () => {
  const signed = await session({ secret: ACCESS }, {
    host: 'preview.example',
    origin: 'https://preview.example',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  });
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
    body: JSON.stringify({ sku: 'CAT-001', sha256: 'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342', selected: true })
  };
  const res = response();
  await handlePreview(req, res, {
    env: { ...env, TERRELLA_PRODUCT_DB_URL: 'https://product-db.test', TERRELLA_PRODUCT_DB_SERVICE_ROLE_KEY: 'test-service-role-not-a-secret' },
    fetchImpl: async () => { called = true; throw new Error('should-not-fetch'); },
    clientFactory: createProductDbClient
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json.saved, false);
  assert.equal(called, false);
});

test('refresh and signup actions are not an auth-user API', async () => {
  const refresh = await session({ action: 'refresh', secret: ACCESS });
  const signup = await session({ action: 'signup', secret: ACCESS });
  assert.equal(refresh.statusCode, 405);
  assert.equal(signup.statusCode, 405);
  assert.equal(refresh.json.signedIn, false);
});
