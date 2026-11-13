import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COOKIE_PATH } from '../lib/internal-preview-session.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ACCESS = 'test-preview-access-secret';
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
let base;

async function start() {
  server = spawn(process.execPath, ['scripts/serve-with-internal-preview.mjs'], {
    cwd: root,
    env: { PATH: process.env.PATH, PORT: '0', TERRELLA_PREVIEW_ACCESS_SECRET: ACCESS },
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
  const login = await request(SESSION_PATH, { method: 'POST', json: { secret: ACCESS }, jar });
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
  assert.equal(data.status, 503);
  assert.equal(data.body.reason, 'store-not-configured');
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
