import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const INTERNAL_PREVIEW_PRODUCT_ID = '426bf18c-8649-4aa5-939c-f0b33eca95f8';
export const INTERNAL_PREVIEW_SHA256 = [
  'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342',
  'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4',
  '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d',
  '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c'
];

const ALLOWED = new Set(INTERNAL_PREVIEW_SHA256);
const locks = new Map();

function emptyStore() {
  return {
    schema: 'terrella.internal-preview.v1',
    label: 'internal-preview-not-official-store',
    selections: []
  };
}

function lock(filePath, fn) {
  const previous = locks.get(filePath) || Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(filePath, run.then(() => {}, () => {}));
  return run;
}

export async function readStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || parsed.schema !== 'terrella.internal-preview.v1' || !Array.isArray(parsed.selections)) {
      return emptyStore();
    }
    return parsed;
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

export function selectedForProduct(store, productId) {
  return store.selections
    .filter((item) => item && item.productId === productId && ALLOWED.has(item.sha256))
    .map((item) => item.sha256);
}

export async function setSelection(filePath, input) {
  return lock(filePath, async () => {
    if (!input || input.productId !== INTERNAL_PREVIEW_PRODUCT_ID) {
      const error = new Error('product');
      error.status = 400;
      throw error;
    }
    const sha256 = String(input.sha256 || '').toLowerCase();
    if (!ALLOWED.has(sha256)) {
      const error = new Error('sha256');
      error.status = 400;
      throw error;
    }
    if (typeof input.selected !== 'boolean') {
      const error = new Error('selected');
      error.status = 400;
      throw error;
    }
    const current = await readStore(filePath);
    const selections = current.selections.filter((item) => !(item.productId === input.productId && item.sha256 === sha256));
    if (input.selected) selections.push({ productId: input.productId, sha256 });
    const next = {
      schema: 'terrella.internal-preview.v1',
      label: 'internal-preview-not-official-store',
      selections
    };
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temporary, filePath);
    return {
      ok: true,
      saved: true,
      label: next.label,
      productId: input.productId,
      selected: selectedForProduct(next, input.productId)
    };
  });
}

export function previewPayload(store, productId = INTERNAL_PREVIEW_PRODUCT_ID) {
  return {
    ok: true,
    label: 'internal-preview-not-official-store',
    productId,
    selected: selectedForProduct(store, productId)
  };
}
