import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { INTERNAL_PREVIEW_PRODUCT_ID, INTERNAL_PREVIEW_SHA256 } from '../lib/internal-preview-allowlist.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20261113193000_selection_claim_rls.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/20261113193000_selection_claim_rls_down.sql', import.meta.url), 'utf8');
const compare = readFileSync(new URL('../supabase/migrations/20261113200000_selection_compare_and_swap.sql', import.meta.url), 'utf8');
const compareRollback = readFileSync(new URL('../supabase/rollbacks/20261113200000_selection_compare_and_swap_down.sql', import.meta.url), 'utf8');

test('the selection claim migration is pinned to CAT-001 and does not grant a shared role', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\)::text = coalesce\(auth\.jwt\(\) ->> 'sub', ''\)/);
  assert.match(migration, /app_metadata' ->> 'terrella_brand_admin', ''\) = 'terralla'/);
  assert.match(migration, /app_metadata' ->> 'terrella_brand_reader', ''\) = 'terralla'/);
  assert.match(migration, new RegExp(INTERNAL_PREVIEW_PRODUCT_ID));
  for (const sha of INTERNAL_PREVIEW_SHA256) assert.match(migration, new RegExp(sha));
  assert.equal(migration.includes('user_metadata'), false);
  assert.equal(migration.includes('426bf18c-8649-4aa5-939c-f0b33eca95f8'), false);
  assert.equal(migration.includes('CAT-013'), false);
  assert.equal(migration.includes('service_role'), false);
  assert.equal(migration.includes('insert into public.products'), false);
  assert.equal(migration.includes('product_assets'), false);
  assert.match(migration, /for insert/);
  assert.match(migration, /for delete/);
  assert.equal(migration.includes('for update'), false);
  assert.match(rollback, /drop policy if exists product_image_selections_select/);
  assert.match(rollback, /revoke all on table public\.product_image_selections from authenticated/);
  assert.equal(rollback.includes('disable row level security'), false);
  assert.match(compare, /where not exists/);
  assert.match(compare, /apply_image_selection/);
  assert.match(compare, new RegExp(INTERNAL_PREVIEW_PRODUCT_ID));
  for (const sha of INTERNAL_PREVIEW_SHA256) assert.match(compare, new RegExp(sha));
  assert.equal(compare.includes('user_metadata'), false);
  assert.equal(compare.includes('service_role'), false);
  assert.equal(compare.includes('CAT-003'), false);
  assert.equal(compare.includes('CAT-006'), false);
  assert.match(compareRollback, /drop function if exists public\.apply_image_selection/);
});
