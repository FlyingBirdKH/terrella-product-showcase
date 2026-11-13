import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('// release-copy-list:start');
const end = html.indexOf('let copyEpoch');
const source = html.slice(start, end);
const pure = new Function(`${source}\nreturn { emptyReleaseCopy, focusReleaseProduct, selectReleaseImage, unselectReleaseImage, itemsForReleaseExport, adoptReleasePicks, releaseListText };`)();

const PREVIEW_ID = '0f057213-b8af-4982-9e44-582a2a1d3469';

function sha(n) {
  return n.toString(16).padStart(64, '0');
}

function item(sku, n, productId = '') {
  return {
    short_id: `${sku}·${n}`,
    sku,
    sha256: sha(n),
    version: 'v1',
    path: `https://terralla-internal.b-cdn.net/products/${sku}/${n}.png`,
    productId
  };
}

function skus(items) {
  return items.map(entry => entry.sku);
}

function shas(items) {
  return items.map(entry => entry.sha256);
}

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

test('the copy button exports the focused product, not the global pick map', () => {
  const change = html.slice(html.indexOf("app.addEventListener('change'"), html.indexOf('function hideManualList'));
  const click = html.slice(html.indexOf("getElementById('copy-release')"), html.indexOf('function validProducts'));
  assert.match(change, /focusReleaseProduct\(releaseCopy, box\.dataset\.sku, checkedReleaseItems\(box\.dataset\.sku\)\)/);
  assert.match(change, /unselectReleaseImage\(releaseCopy, box\.dataset\.sku, box\.dataset\.sha\)/);
  assert.match(click, /const items = itemsForReleaseExport\(releaseCopy\)/);
  assert.match(click, /releaseListText\(items\)/);
  assert.equal(click.includes('releasePicks.values'), false);
  assert.match(html, /adoptReleasePicks\(releaseCopy, INTERNAL_PREVIEW_SKU, seeded\)/);
  assert.match(html, /0f057213-b8af-4982-9e44-582a2a1d3469/);
  assert.equal(html.includes('426bf18c-8649-4aa5-939c-f0b33eca95f8'), false);
});

test('exporting product B after product A contains only B, with no duplicates', () => {
  const productA = [1, 2, 3, 4].map(n => item('CAT-006', n));
  const productB = [5, 6, 7, 8, 9].map(n => item('CAT-003', n));
  let state = pure.focusReleaseProduct(pure.emptyReleaseCopy(), 'CAT-006', productA);
  const first = pure.itemsForReleaseExport(state);
  const firstText = pure.releaseListText(first);
  assert.deepEqual(skus(first), ['CAT-006', 'CAT-006', 'CAT-006', 'CAT-006']);
  assert.match(firstText, /张数：4/);
  assert.equal(occurrences(firstText, 'sku: CAT-006'), 4);

  state = pure.focusReleaseProduct(state, 'CAT-003', productB.concat(productA));
  const second = pure.itemsForReleaseExport(state);
  const secondText = pure.releaseListText(second);
  assert.deepEqual(shas(second), productB.map(entry => entry.sha256));
  assert.deepEqual(skus(second), ['CAT-003', 'CAT-003', 'CAT-003', 'CAT-003', 'CAT-003']);
  assert.match(secondText, /张数：5/);
  assert.equal(secondText.includes('CAT-006'), false);
  for (const entry of productA) assert.equal(secondText.includes(entry.sha256), false);
  for (const entry of productB) assert.equal(occurrences(secondText, entry.sha256), 1);
  assert.equal(new Set(shas(second)).size, second.length);
});

test('a later export of the same product follows the current selection', () => {
  let state = pure.focusReleaseProduct(pure.emptyReleaseCopy(), 'CAT-045', [1, 2, 3, 4].map(n => item('CAT-045', n)));
  state = pure.unselectReleaseImage(state, 'CAT-045', sha(2));
  state = pure.selectReleaseImage(state, item('CAT-045', 3));
  state = pure.focusReleaseProduct(state, 'CAT-045', [1, 3, 4, 10, 3].map(n => item('CAT-045', n)));
  const again = pure.itemsForReleaseExport(state);
  assert.deepEqual(shas(again), [sha(1), sha(3), sha(4), sha(10)]);
  const text = pure.releaseListText(again);
  assert.match(text, /张数：4/);
  assert.equal(text.includes('CAT-006'), false);
  assert.equal(text.includes(sha(2)), false);
  for (const digest of shas(again)) assert.equal(occurrences(text, digest), 1);
});

test('clearing the current product does not restore the previous product', () => {
  let state = pure.focusReleaseProduct(pure.emptyReleaseCopy(), 'CAT-006', [1, 2, 3, 4].map(n => item('CAT-006', n)));
  state = pure.focusReleaseProduct(state, 'CAT-003', [5, 6].map(n => item('CAT-003', n)));
  state = pure.unselectReleaseImage(state, 'CAT-003', sha(5));
  assert.deepEqual(shas(pure.itemsForReleaseExport(state)), [sha(6)]);
  state = pure.unselectReleaseImage(state, 'CAT-003', sha(6));
  assert.deepEqual(pure.itemsForReleaseExport(state), []);
  state = pure.unselectReleaseImage(state, 'CAT-006', sha(1));
  assert.deepEqual(pure.itemsForReleaseExport(state), []);
});

test('saved CAT-001 preview checks do not leak into another product export', () => {
  const preview = [11, 12, 13, 14].map(n => item('CAT-001', n, PREVIEW_ID));
  const other = [5, 6, 7, 8, 9].map(n => item('CAT-003', n));
  let state = pure.adoptReleasePicks(pure.emptyReleaseCopy(), 'CAT-001', preview);
  assert.deepEqual(shas(pure.itemsForReleaseExport(state)), preview.map(entry => entry.sha256));
  state = pure.focusReleaseProduct(state, 'CAT-003', other);
  state = pure.adoptReleasePicks(state, 'CAT-001', preview);
  state = pure.selectReleaseImage(state, preview[0]);
  const exported = pure.itemsForReleaseExport(state);
  assert.deepEqual(shas(exported), other.map(entry => entry.sha256));
  assert.equal(pure.releaseListText(exported).includes('CAT-001'), false);
});

test('checkbox changes on the page keep the copy list to the active product', () => {
  const boxes = [];
  const previewSelected = new Set();
  const document = {
    querySelectorAll(selector) {
      assert.equal(selector, 'input[data-release]');
      return boxes;
    }
  };
  const page = new Function('document', 'previewSelected', `
    const releasePicks = new Map();
    let releaseCopy = { sku: '', items: [] };
    ${source}
    return {
      check(sku) {
        releaseCopy = focusReleaseProduct(releaseCopy, sku, checkedReleaseItems(sku));
        mirrorReleasePicks();
        clearOtherTemporaryChecks(sku);
      },
      uncheck(sku, sha256) {
        releaseCopy = unselectReleaseImage(releaseCopy, sku, sha256);
        mirrorReleasePicks();
      },
      adopt(sku, items) {
        releaseCopy = adoptReleasePicks(releaseCopy, sku, items);
        mirrorReleasePicks();
      },
      remember(box) {
        const picked = releaseItemFromBox(box);
        if (releaseCopy.sku && picked.sku !== releaseCopy.sku) return false;
        releaseCopy = selectReleaseImage(releaseCopy, picked);
        mirrorReleasePicks();
        return true;
      },
      snapshot() {
        const items = itemsForReleaseExport(releaseCopy);
        const nodes = [...document.querySelectorAll('input[data-release]')];
        return { items, text: releaseListText(items), checked: nodes.filter(box => box.checked).map(box => box.dataset.sku + ':' + box.dataset.sha) };
      }
    };
  `)(document, previewSelected);

  function box(sku, n, productId = '') {
    const node = {
      dataset: {
        sku,
        sha: sha(n),
        short: `${sku}·${n}`,
        version: 'v1',
        path: `https://terralla-internal.b-cdn.net/products/${sku}/${n}.png`,
        productId
      },
      checked: false
    };
    boxes.push(node);
    return node;
  }

  const productA = [1, 2, 3, 4].map(n => box('CAT-006', n));
  for (const node of productA) {
    node.checked = true;
    page.check('CAT-006');
  }
  const first = page.snapshot();
  assert.deepEqual(shas(first.items), [1, 2, 3, 4].map(sha));
  assert.match(first.text, /张数：4/);

  const productB = [5, 6, 7, 8, 9].map(n => box('CAT-003', n));
  for (const node of productB) {
    node.checked = true;
    page.check('CAT-003');
  }
  const second = page.snapshot();
  assert.deepEqual(shas(second.items), [5, 6, 7, 8, 9].map(sha));
  assert.equal(second.text.includes('CAT-006'), false);
  for (const digest of [1, 2, 3, 4].map(sha)) assert.equal(occurrences(second.text, digest), 0);
  for (const digest of [5, 6, 7, 8, 9].map(sha)) assert.equal(occurrences(second.text, digest), 1);
  assert.deepEqual(productA.map(node => node.checked), [false, false, false, false]);

  productB[0].checked = false;
  page.uncheck('CAT-003', productB[0].dataset.sha);
  const extra = box('CAT-003', 10);
  extra.checked = true;
  page.check('CAT-003');
  const again = page.snapshot();
  assert.deepEqual(shas(again.items), [6, 7, 8, 9, 10].map(sha));
  assert.equal(again.text.includes(sha(5)), false);
  assert.equal(again.text.includes('CAT-006'), false);

  const preview = [11, 12, 13, 14].map(n => box('CAT-001', n, PREVIEW_ID));
  for (const node of preview) {
    node.checked = true;
    previewSelected.add(node.dataset.sha);
  }
  page.adopt('CAT-001', preview.map(node => ({
    short_id: node.dataset.short,
    sku: node.dataset.sku,
    sha256: node.dataset.sha,
    version: node.dataset.version,
    path: node.dataset.path,
    productId: node.dataset.productId
  })));
  assert.deepEqual(shas(page.snapshot().items), [6, 7, 8, 9, 10].map(sha));
  assert.equal(page.remember(preview[0]), false);
  for (const node of productB.slice(1)) node.checked = false;
  extra.checked = false;
  for (const node of productB.slice(1)) page.uncheck('CAT-003', node.dataset.sha);
  page.uncheck('CAT-003', extra.dataset.sha);
  const emptied = page.snapshot();
  assert.deepEqual(emptied.items, []);
  assert.equal(emptied.text.includes('CAT-001'), false);
  assert.equal(emptied.text.includes('CAT-006'), false);
  assert.deepEqual(preview.map(node => node.checked), [true, true, true, true]);
});
