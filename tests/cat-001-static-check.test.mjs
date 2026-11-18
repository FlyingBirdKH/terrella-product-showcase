import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../cat-001-static-check.html', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8');
const expected = [
  ['001·ff4696', 'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342', 'ai-CAT-001-recovered-01-ff469683.png'],
  ['001·af3760', 'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4', 'ai-CAT-001-recovered-02-af3760c6.png'],
  ['001·2f8919', '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d', 'ai-CAT-001-recovered-03-2f891916.png'],
  ['001·91cd1d', '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c', 'ai-CAT-001-recovered-04-91cd1d7d.png']
];

test('static check page lists the four Bunny URLs in manifest order', () => {
  assert.match(page, /静态核验，尚未同步商城/);
  assert.doesNotMatch(page, /加入购物车|立即购买|buy now|checkout/i);
  assert.doesNotMatch(page, /href="https?:\/\/terralla\.com/);
  assert.equal(page.includes('已同步'), false);
  let cursor = 0;
  for (const [index, [shortId, sha, file]] of expected.entries()) {
    const shortAt = page.indexOf(shortId, cursor);
    const shaAt = page.indexOf(sha, cursor);
    const fileAt = page.indexOf(file, cursor);
    assert.ok(shortAt > cursor && shaAt > cursor && fileAt > cursor, `missing item ${index + 1}`);
    assert.ok(shortAt < shaAt && shaAt < fileAt);
    cursor = fileAt + file.length;
    assert.equal(page.indexOf(sha, cursor), -1);
  }
  assert.equal(ledger.includes('ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342'), false);
  assert.equal(ledger.includes('terralla.com'), false);
});
