import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { flagsForGesture, shortcutAction } from '../selection-gestures.mjs';
import { installSelectionUi } from '../selection-ui.mjs';

function rows(sku, flags) {
  return flags.map((checked) => ({ group: sku, checked }));
}

test('select all checks every row of the current product and invert flips only those rows', () => {
  const start = rows('CAT-001', [false, true, false, false]);
  assert.deepEqual(flagsForGesture(start, { action: 'all' }), [true, true, true, true]);
  assert.deepEqual(flagsForGesture(start, { action: 'invert' }), [true, false, true, true]);
  const mixed = [
    { group: 'CAT-006', checked: true },
    { group: 'CAT-006', checked: false },
    { group: 'CAT-003', checked: true }
  ];
  assert.deepEqual(flagsForGesture(mixed.filter((row) => row.group === 'CAT-006'), { action: 'all' }), [true, true]);
  assert.deepEqual(flagsForGesture(mixed.filter((row) => row.group === 'CAT-003'), { action: 'invert' }), [false]);
});

test('row click toggles one image and shift-click checks the inclusive range', () => {
  const start = rows('CAT-001', [false, false, true, false]);
  assert.deepEqual(flagsForGesture(start, { action: 'toggle', index: 0 }), [true, false, true, false]);
  assert.deepEqual(flagsForGesture(start, { action: 'range', anchor: 0, index: 2 }), [true, true, true, false]);
  const other = [
    { group: 'CAT-006', checked: false },
    { group: 'CAT-003', checked: false }
  ];
  assert.deepEqual(flagsForGesture(other, { action: 'range', anchor: 0, index: 1 }), [false, true]);
});

test('keyboard shortcuts are discoverable and do not fire while typing', () => {
  const input = { tagName: 'INPUT', isContentEditable: false };
  assert.equal(shortcutAction({ key: 'a', metaKey: true, target: { tagName: 'BODY' } }), 'all');
  assert.equal(shortcutAction({ key: 'a', ctrlKey: true, target: { tagName: 'MAIN' } }), 'all');
  assert.equal(shortcutAction({ key: 'A', ctrlKey: true, target: { tagName: 'MAIN' } }), 'all');
  assert.equal(shortcutAction({ key: 'i', metaKey: true, target: { tagName: 'DIV' } }), 'invert');
  assert.equal(shortcutAction({ key: ' ', target: { tagName: 'FIGURE' } }), 'toggle');
  assert.equal(shortcutAction({ key: 'a', ctrlKey: true, target: input }), '');
  assert.equal(shortcutAction({ key: ' ', target: { tagName: 'BUTTON' } }), '');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../cat-001-internal-preview.html', import.meta.url), 'utf8');
  for (const source of [html, page]) {
    assert.match(source, /id="select-all-images"/);
    assert.match(source, /id="invert-selection"/);
    assert.match(source, /Ctrl\/⌘ A/);
    assert.match(source, /Ctrl\/⌘ I/);
    assert.match(source, /selection-ui\.mjs/);
    assert.match(source, /id="publish-unavailable" disabled/);
  }
  assert.match(html, /focusReleaseProduct\(releaseCopy, box\.dataset\.sku, checkedReleaseItems\(box\.dataset\.sku\)\)/);
  assert.match(html, /preview-email/);
  assert.match(page, /preview-email/);
});

test('the installed controls toggle a row, select all, and invert without enabling publish', () => {
  const boxes = [false, true, false].map((checked, index) => {
    const box = {
      checked,
      disabled: false,
      dataset: { sku: 'CAT-001', sha: String(index) },
      hasAttribute(name) { return name === 'data-release'; },
      dispatchEvent(event) { box.events.push(event.type); },
      events: [],
      closest() { return row; }
    };
    const row = {
      box,
      classList: { toggle(name, on) { row.classes[name] = on; } },
      classes: {},
      setAttribute(name, value) { row.attrs[name] = value; },
      attrs: {},
      querySelector() { return box; },
      focus() { row.focused = true; },
      closest() { return row; }
    };
    box.closest = () => row;
    return { box, row };
  });
  const rows = boxes.map((entry) => entry.row);
  const listeners = {};
  const doc = {
    activeElement: rows[0],
    addEventListener(type, fn) { listeners[type] = fn; },
    getElementById(id) {
      if (id === 'select-all-images') return selectAll;
      if (id === 'invert-selection') return invert;
      if (id === 'publish-unavailable') return { disabled: true };
      return null;
    },
    querySelectorAll() { return boxes.map((entry) => entry.box); }
  };
  rows.forEach((row) => {
    row.closest = (selector) => (selector === '[data-selectable]' ? row : null);
  });
  const selectAll = { addEventListener(type, fn) { selectAll[type] = fn; } };
  const invert = { addEventListener(type, fn) { invert[type] = fn; } };
  installSelectionUi(doc);
  listeners.click({
    target: { closest: (selector) => (selector === '[data-selectable]' ? rows[0] : null) },
    shiftKey: false,
    preventDefault() {}
  });
  assert.equal(boxes[0].box.checked, true);
  assert.equal(boxes[0].box.events.includes('change'), true);
  assert.equal(boxes[1].box.checked, true);
  selectAll.click();
  assert.deepEqual(boxes.map((entry) => entry.box.checked), [true, true, true]);
  invert.click();
  assert.deepEqual(boxes.map((entry) => entry.box.checked), [false, false, false]);
  listeners.keydown({
    key: 'a',
    ctrlKey: true,
    target: { tagName: 'MAIN', closest: () => null },
    preventDefault() { this.defaultPrevented = true; }
  });
  assert.deepEqual(boxes.map((entry) => entry.box.checked), [true, true, true]);
});
