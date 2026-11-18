import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COOKIE_PATH } from '../lib/internal-preview-session.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ANON = 'test-anon-key-not-a-secret';
const EMAIL = 'admin@example.test';
const PASSWORD = 'test-password-not-a-secret';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_PATH = '/api/internal-preview/session';
const DATA_PATH = '/api/internal-preview';
const HYPHEN_PATH = '/api/internal-preview-session';

function pathMatches(cookiePath, requestPath) {
  if (cookiePath === requestPath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith('/')) return true;
  return requestPath.charAt(cookiePath.length) === '/';
}

class CookieJar {
  constructor() {
    this.cookies = [];
  }

  store(setCookie) {
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!header) return;
    const parts = String(header).split(';').map((part) => part.trim());
    const [pair, ...attrs] = parts;
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    let path = '/';
    let maxAge = null;
    for (const attr of attrs) {
      const [rawKey, ...rest] = attr.split('=');
      const key = rawKey.toLowerCase();
      if (key === 'path') path = rest.join('=') || '/';
      if (key === 'max-age') maxAge = Number(rest.join('='));
    }
    this.cookies = this.cookies.filter((cookie) => cookie.name !== name || cookie.path !== path);
    if (maxAge === 0) return;
    this.cookies.push({ name, value, path });
  }

  headerFor(pathname) {
    const requestPath = pathname.split('?')[0];
    return this.cookies
      .filter((cookie) => pathMatches(cookie.path, requestPath))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
}

let server;
let fixture;
let base;

function userToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: USER_ID, role: 'authenticated' })).toString('base64url');
  return `${header}.${payload}.sig`;
}

async function start() {
  const token = userToken();
  const tokens = new Set();
  fixture = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.headers.apikey !== ANON) {
        res.writeHead(401);
        res.end('{}');
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (url.pathname === '/auth/v1/token') {
        const body = JSON.parse(raw || '{}');
        if (body.email !== EMAIL || body.password !== PASSWORD) {
          res.writeHead(400);
          res.end('{}');
          return;
        }
        tokens.add(token);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: token, expires_in: 3600 }));
        return;
      }
      const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (url.pathname === '/auth/v1/logout') {
        tokens.delete(bearer);
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === '/auth/v1/user') {
        if (!tokens.has(bearer)) {
          res.writeHead(401);
          res.end('{}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: USER_ID, app_metadata: { terrella_brand_admin: 'terralla' } }));
        return;
      }
      if (url.pathname === '/rest/v1/product_image_selections') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[]');
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  const origin = await new Promise((resolve) => {
    fixture.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${fixture.address().port}`));
  });
  server = spawn(process.execPath, ['scripts/serve-with-internal-preview.mjs'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      PORT: '0',
      TERRELLA_PRODUCT_DB_URL: origin,
      TERRELLA_PRODUCT_DB_ANON_KEY: ANON
    },
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

async function request(pathname, { method = 'GET', json, jar } = {}) {
  const headers = {};
  if (json !== undefined) headers['content-type'] = 'application/json';
  const cookie = jar ? jar.headerFor(pathname) : '';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json)
  });
  const body = await response.json().catch(() => null);
  if (jar) {
    const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const header of setCookies) jar.store(header);
  }
  return { status: response.status, body, sentCookie: cookie };
}

after(() => {
  if (server) server.kill();
  if (fixture) fixture.close();
});

test('a browser cookie jar follows RFC 6265 and the homepage session route receives it', async () => {
  await start();
  assert.equal(COOKIE_PATH, '/api/internal-preview');
  assert.notEqual(COOKIE_PATH, '/');
  assert.notEqual(COOKIE_PATH, '/api');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(html.includes(HYPHEN_PATH), false);
  assert.equal(html.includes(SESSION_PATH), true);

  const jar = new CookieJar();
  const login = await request(SESSION_PATH, { method: 'POST', json: { email: EMAIL, password: PASSWORD }, jar });
  assert.equal(login.status, 200);
  assert.equal(login.body.signedIn, true);
  assert.equal(login.sentCookie, '');
  assert.equal(jar.headerFor(HYPHEN_PATH), '');
  assert.notEqual(jar.headerFor(SESSION_PATH), '');
  assert.equal(jar.headerFor(DATA_PATH), jar.headerFor(SESSION_PATH));

  const hyphen = await request(HYPHEN_PATH, { jar });
  assert.equal(hyphen.sentCookie, '');
  assert.notEqual(hyphen.body && hyphen.body.signedIn, true);

  const refresh = await request(SESSION_PATH, { jar });
  assert.notEqual(refresh.sentCookie, '');
  assert.equal(refresh.status, 200);
  assert.equal(refresh.body.signedIn, true);

  const data = await request(`${DATA_PATH}?productId=0f057213-b8af-4982-9e44-582a2a1d3469`, { jar });
  assert.notEqual(data.sentCookie, '');
  assert.equal(data.status, 200);
  assert.deepEqual(data.body.selected, []);
  assert.equal(data.body.saved, false);

  const loggedOut = await request(SESSION_PATH, { method: 'POST', json: { action: 'logout' }, jar });
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.body.signedIn, false);
  assert.equal(jar.headerFor(SESSION_PATH), '');
  const after = await request(SESSION_PATH, { jar });
  assert.equal(after.sentCookie, '');
  assert.equal(after.body.signedIn, false);
  const closed = await request(DATA_PATH, { jar });
  assert.equal(closed.sentCookie, '');
  assert.equal(closed.status, 401);
  assert.equal(closed.body.reason, 'anonymous');
});
