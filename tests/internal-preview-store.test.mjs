import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256, readStore, setSelection } from '../lib/internal-preview-store.mjs';

const ledgerBefore = await readFile(new URL('../image-availability.json', import.meta.url), 'utf8');
const first = INTERNAL_PREVIEW_SHA256[0];
const second = INTERNAL_PREVIEW_SHA256[1];

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'internal-preview-'));
  return join(dir, 'internal-preview.json');
}

test('selection persists by product id and full sha256 for a second reader', async () => {
  const file = await tempStore();
  const saved = await setSelection(file, { productId: INTERNAL_PREVIEW_PRODUCT_ID, sha256: first, selected: true });
  assert.equal(saved.saved, true);
  assert.deepEqual(saved.selected, [first]);
  const again = await readStore(file);
  assert.deepEqual(again.selections.map((item) => item.sha256), [first]);
  await setSelection(file, { productId: INTERNAL_PREVIEW_PRODUCT_ID, sha256: second, selected: true });
  const both = await readStore(file);
  assert.deepEqual(both.selections.map((item) => item.sha256), [first, second]);
});

test('uncheck removes only that image and does not touch the approval ledger', async () => {
  const file = await tempStore();
  await setSelection(file, { productId: INTERNAL_PREVIEW_PRODUCT_ID, sha256: first, selected: true });
  await setSelection(file, { productId: INTERNAL_PREVIEW_PRODUCT_ID, sha256: second, selected: true });
  const removed = await setSelection(file, { productId: INTERNAL_PREVIEW_PRODUCT_ID, sha256: first, selected: false });
  assert.deepEqual(removed.selected, [second]);
  const text = await readFile(file, 'utf8');
  assert.equal(text.includes(first), false);
  assert.equal(text.includes('www.terralla.com'), false);
  const ledgerAfter = await readFile(new URL('../image-availability.json', import.meta.url), 'utf8');
  assert.equal(ledgerAfter, ledgerBefore);
});

test('short sha and another product are rejected', async () => {
  const file = await tempStore();
  await assert.rejects(setSelection(file, { productId: INTERNAL_PREVIEW_PRODUCT_ID, sha256: first.slice(0, 6), selected: true }));
  await assert.rejects(setSelection(file, { productId: '00000000-0000-0000-0000-000000000000', sha256: first, selected: true }));
  const store = await readStore(file);
  assert.deepEqual(store.selections, []);
});

test('two browser contexts share the preview server store', async () => {
  const file = await tempStore();
  const child = spawn(process.execPath, ['scripts/serve-with-internal-preview.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '8799', INTERNAL_PREVIEW_PATH: file },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
      child.stdout.on('data', () => { clearTimeout(timer); resolve(); });
      child.stderr.on('data', (chunk) => { clearTimeout(timer); reject(new Error(chunk.toString())); });
    });
    const post = (selected, sha256 = first) => fetch('http://127.0.0.1:8799/api/internal-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: INTERNAL_PREVIEW_PRODUCT_ID, sha256, selected })
    });
    const saved = await (await post(true)).json();
    assert.equal(saved.saved, true);
    const otherBrowser = await (await fetch('http://127.0.0.1:8799/api/internal-preview')).json();
    assert.deepEqual(otherBrowser.selected, [first]);
    const page = await (await fetch('http://127.0.0.1:8799/cat-001-internal-preview.html')).text();
    assert.match(page, /内部预览 · 非公开 · 不是正式商城/);
    assert.match(page, /正式上架\/下架不可用/);
    assert.match(page, /这里只显示已保存的图片/);
    assert.match(page, /暂停、非公开/);
    assert.equal(page.includes('已同步'), false);
    await post(false);
    const after = await (await fetch('http://127.0.0.1:8799/api/internal-preview')).json();
    assert.deepEqual(after.selected, []);
  } finally {
    child.kill();
  }
});

test('showcase checkboxes use the same product id and preview endpoint', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../cat-001-internal-preview.html', import.meta.url), 'utf8');
  assert.match(html, /const INTERNAL_PREVIEW_PRODUCT_ID = '426bf18c-8649-4aa5-939c-f0b33eca95f8'/);
  assert.match(html, /\/api\/internal-preview/);
  assert.match(html, /内部预览勾选，不上架/);
  assert.match(html, /id="publish-unavailable" disabled/);
  for (const sha of INTERNAL_PREVIEW_SHA256) assert.equal(preview.includes(sha), true);
  for (const file of [
    'ai-CAT-001-recovered-01-ff469683.png',
    'ai-CAT-001-recovered-02-af3760c6.png',
    'ai-CAT-001-recovered-03-2f891916.png',
    'ai-CAT-001-recovered-04-91cd1d7d.png'
  ]) {
    assert.equal(html.includes(file), true);
    assert.equal(preview.includes(file), true);
  }
});
