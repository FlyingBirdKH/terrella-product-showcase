import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256, setSelection } from '../lib/internal-preview-store.mjs';

test('the retired file store cannot report a saved selection', async () => {
  await assert.rejects(setSelection(), (error) => error.reason === 'store-not-configured' && error.status === 503);
});

test('the allowlist is only the confirmed CAT-001 id and four full hashes', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261112160000_internal_preview_shared.sql', import.meta.url), 'utf8');
  assert.equal(INTERNAL_PREVIEW_PRODUCT_ID, '426bf18c-8649-4aa5-939c-f0b33eca95f8');
  assert.equal(sql.includes(INTERNAL_PREVIEW_PRODUCT_ID), true);
  assert.equal(INTERNAL_PREVIEW_SHA256.length, 4);
  for (const sha of INTERNAL_PREVIEW_SHA256) {
    assert.match(sha, /^[a-f0-9]{64}$/);
    assert.equal(sql.includes(sha), true);
  }
});
