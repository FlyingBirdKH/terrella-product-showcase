import { flagsForGesture, shortcutAction } from './selection-gestures.mjs';

function groupOf(box) {
  if (box.hasAttribute('data-release')) return box.dataset.sku || '';
  return '*';
}

function listFor(doc, box) {
  const selector = box.hasAttribute('data-release') ? 'input[data-release]' : 'input[data-sha]';
  return [...doc.querySelectorAll(selector)].filter((item) => !item.disabled && groupOf(item) === groupOf(box));
}

function currentList(doc) {
  const focused = doc.activeElement && doc.activeElement.closest && doc.activeElement.closest('[data-selectable]');
  const focusedBox = focused && focused.querySelector('input[data-release], input[data-sha]');
  if (focusedBox && !focusedBox.disabled) return listFor(doc, focusedBox);
  const boxes = [...doc.querySelectorAll('input[data-release], input[data-sha]')].filter((item) => !item.disabled);
  const checked = boxes.find((item) => item.checked);
  if (checked) return listFor(doc, checked);
  if (boxes.length && boxes.every((item) => groupOf(item) === groupOf(boxes[0]))) return listFor(doc, boxes[0]);
  return [];
}

function paint(box) {
  const row = box.closest('[data-selectable], figure.gallery-item, li');
  if (!row) return;
  row.classList.toggle('is-selected', box.checked);
  row.setAttribute('aria-pressed', box.checked ? 'true' : 'false');
}

function applyFlags(list, flags) {
  list.forEach((box, index) => {
    paint(box);
    if (box.checked === flags[index]) return;
    box.checked = flags[index];
    box.dispatchEvent(new Event('change', { bubbles: true }));
    paint(box);
  });
}

function rowsFrom(list) {
  return list.map((box) => ({ group: groupOf(box), checked: box.checked }));
}

export function installSelectionUi(doc) {
  let anchor = -1;

  function toggleRow(row, shiftKey) {
    const box = row.querySelector('input[data-release], input[data-sha]');
    if (!box || box.disabled) return;
    const list = listFor(doc, box);
    const index = list.indexOf(box);
    const flags = flagsForGesture(rowsFrom(list), {
      action: shiftKey ? 'range' : 'toggle',
      index,
      anchor
    });
    applyFlags(list, flags);
    if (!shiftKey) anchor = index;
    if (typeof row.focus === 'function') row.focus();
  }

  function runBulk(action) {
    const list = currentList(doc);
    if (!list.length) {
      const status = doc.getElementById('copy-status') || doc.getElementById('save-status');
      if (status) status.textContent = '请先点一张可选图片。全选和反选只作用于当前这一个产品。';
      return;
    }
    applyFlags(list, flagsForGesture(rowsFrom(list), { action }));
  }

  doc.addEventListener('click', (event) => {
    const row = event.target.closest && event.target.closest('[data-selectable]');
    if (!row) return;
    if (event.target.closest && event.target.closest('a, button')) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    toggleRow(row, event.shiftKey === true);
  });

  doc.addEventListener('keydown', (event) => {
    const action = shortcutAction(event);
    if (!action) return;
    if (action === 'toggle') {
      const row = event.target.closest && event.target.closest('[data-selectable]');
      if (!row) return;
      event.preventDefault();
      toggleRow(row, false);
      return;
    }
    event.preventDefault();
    runBulk(action);
  });

  const selectAll = doc.getElementById('select-all-images');
  const invert = doc.getElementById('invert-selection');
  if (selectAll) selectAll.addEventListener('click', () => runBulk('all'));
  if (invert) invert.addEventListener('click', () => runBulk('invert'));
}

if (typeof document !== 'undefined') installSelectionUi(document);
