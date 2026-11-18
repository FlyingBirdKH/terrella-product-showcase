export function blocksShortcut(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable === true;
}

export function shortcutAction(event) {
  if (!event || blocksShortcut(event.target)) return '';
  const key = String(event.key || '').toLowerCase();
  const mod = event.metaKey === true || event.ctrlKey === true;
  if (mod && event.altKey !== true && key === 'a') return 'all';
  if (mod && event.altKey !== true && key === 'i') return 'invert';
  if (!mod && event.altKey !== true && event.shiftKey !== true && (key === ' ' || key === 'spacebar')) {
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
    if (tag === 'button' || tag === 'a') return '';
    return 'toggle';
  }
  return '';
}

function checkedFlags(rows) {
  return rows.map((row) => row.checked === true);
}

export function selectAllFlags(rows) {
  return rows.map(() => true);
}

export function invertFlags(rows) {
  return checkedFlags(rows).map((flag) => !flag);
}

export function toggleIndex(rows, index) {
  return checkedFlags(rows).map((flag, i) => (i === index ? !flag : flag));
}

export function checkRange(rows, anchor, index) {
  if (anchor < 0 || index < 0 || anchor >= rows.length || index >= rows.length) return toggleIndex(rows, index);
  if (rows[anchor].group !== rows[index].group) return toggleIndex(rows, index);
  const start = Math.min(anchor, index);
  const end = Math.max(anchor, index);
  return checkedFlags(rows).map((flag, i) => (i >= start && i <= end ? true : flag));
}

export function flagsForGesture(rows, { action, index = -1, anchor = -1 } = {}) {
  if (action === 'all') return selectAllFlags(rows);
  if (action === 'invert') return invertFlags(rows);
  if (action === 'range') return checkRange(rows, anchor, index);
  if (action === 'toggle') return toggleIndex(rows, index);
  return checkedFlags(rows);
}
