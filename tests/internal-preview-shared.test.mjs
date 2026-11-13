import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BRAND_USER,
  FIRST_SHA,
  OTHER_USER,
  applySql,
  brandClaims,
  lastJson,
  psql,
  readSql,
  recreateDatabase,
  sqlReason
} from './preview-postgres.mjs';

const exec = promisify(execFile);
const db = 'preview_contract';
const migration = readFileSync(new URL('../supabase/migrations/20261112160000_internal_preview_shared.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/20261112160000_internal_preview_shared_down.sql', import.meta.url), 'utf8');
const migrationSql = migration.replace(/--[^\n]*/g, '');

async function count(sql) {
  const result = await psql(db, sql);
  assert.equal(result.ok, true, result.stderr);
  return result.stdout.split('\n').pop();
}

before(async () => {
  await recreateDatabase(db);
});

test('local postgres uses only standard roles and grants execute to authenticated', async () => {
  assert.equal(/\bcreate\s+role\b/i.test(migrationSql), false);
  assert.equal(migrationSql.includes('kevin_admin'), false);
  assert.equal(migrationSql.includes('426bf18c-8649-4aa5-939c-f0b33eca95f8'), false);
  assert.equal(migrationSql.includes('product_image_selections'), false);
  assert.equal(migrationSql.includes('product_assets'), false);
  assert.equal(migrationSql.includes('terralla_admin'), false);
  assert.equal(migrationSql.includes('terralla_team'), false);
  assert.equal(rollback.includes('managers'), false);
  assert.equal(await count("select count(*) from pg_roles where rolname in ('kevin_admin', 'terralla_admin', 'terralla_team')"), '0');
  assert.equal(await count("select has_function_privilege('authenticated', 'public.internal_preview_apply_event(text,uuid,text,boolean,bigint)', 'execute')"), 't');
  assert.equal(await count("select has_function_privilege('anon', 'public.internal_preview_apply_event(text,uuid,text,boolean,bigint)', 'execute')"), 'f');
  assert.equal(await count("select has_function_privilege('service_role', 'public.internal_preview_apply_event(text,uuid,text,boolean,bigint)', 'execute')"), 'f');
});

test('local postgres, not production: authenticated brand admin is visible to a second connection', async () => {
  await psql(db, 'truncate internal_preview.events');
  const saved = await applySql(db, { eventId: 'evt-share-0000000001', sha: FIRST_SHA, selected: true, base: 0 });
  assert.equal(saved.ok, true, saved.stderr);
  const other = await readSql(db, {});
  assert.equal(other.ok, true, other.stderr);
  assert.deepEqual(lastJson(other.stdout).selected, [FIRST_SHA]);
  assert.equal(lastJson(other.stdout).saved, false);
  assert.equal(await count('select actor::text from internal_preview.events'), BRAND_USER);
  assert.equal(await count('select brand_id from internal_preview.events'), 'terralla');
});

test('local postgres, not production: forgery, missing sub, wrong brand, anon, and service_role are rejected', async () => {
  await psql(db, 'truncate internal_preview.events');
  const forged = await applySql(db, {
    claims: { sub: OTHER_USER, role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: { terrella_brand_admin: 'terralla' } },
    eventId: 'evt-forged-0000000001'
  });
  const supplier = await applySql(db, {
    claims: { sub: OTHER_USER, role: 'authenticated', app_metadata: { role: 'sourcing_manager' }, user_metadata: { role: 'admin' } },
    eventId: 'evt-supplier-00000001'
  });
  const wrongBrand = await applySql(db, {
    claims: brandClaims({ app_metadata: { terrella_brand_admin: 'other' } }),
    eventId: 'evt-brand-00000000001'
  });
  const missingSub = await applySql(db, {
    claims: { role: 'authenticated', app_metadata: { terrella_brand_admin: 'terralla' } },
    claimSub: '',
    eventId: 'evt-nosub-0000000001'
  });
  const mismatched = await applySql(db, { claimSub: OTHER_USER, eventId: 'evt-mismatch-0000001' });
  const anon = await applySql(db, { claims: { role: 'anon', sub: BRAND_USER }, eventId: 'evt-anon-00000000001' });
  const service = await applySql(db, {
    claims: { role: 'service_role', sub: BRAND_USER, app_metadata: { terrella_brand_admin: 'terralla' } },
    eventId: 'evt-service-00000001'
  });
  assert.equal(sqlReason(forged.stderr), 'brand-access-missing');
  assert.equal(sqlReason(supplier.stderr), 'brand-access-missing');
  assert.equal(sqlReason(wrongBrand.stderr), 'brand-access-missing');
  assert.equal(sqlReason(missingSub.stderr), 'sub');
  assert.equal(sqlReason(mismatched.stderr), 'sub');
  assert.equal(anon.ok, false);
  assert.equal(service.ok, false);
  const table = await psql(db, 'set role authenticated; select count(*) from internal_preview.events;');
  assert.equal(table.ok, false);
  assert.match(table.stderr, /permission denied/i);
  assert.equal(await count('select count(*) from internal_preview.events'), '0');
  assert.equal(await count('select status from public.terralla_skus'), 'paused');
});

test('local postgres, not production: a brand reader can read and cannot write', async () => {
  await psql(db, 'truncate internal_preview.events');
  assert.equal((await applySql(db, { eventId: 'evt-reader-setup-0001', selected: true, base: 0 })).ok, true);
  const reader = brandClaims({
    sub: OTHER_USER,
    app_metadata: { terrella_brand_reader: 'terralla' },
    user_metadata: { terrella_brand_admin: 'terralla' }
  });
  const seen = await readSql(db, { claims: reader });
  assert.equal(seen.ok, true, seen.stderr);
  assert.deepEqual(lastJson(seen.stdout).selected, [FIRST_SHA]);
  const write = await applySql(db, { claims: reader, eventId: 'evt-reader-write-0001', sha: FIRST_SHA, selected: false, base: 1 });
  assert.equal(sqlReason(write.stderr), 'brand-admin-missing');
  const forgedReader = await readSql(db, {
    claims: { sub: OTHER_USER, role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: { terrella_brand_reader: 'terralla' } }
  });
  assert.equal(sqlReason(forgedReader.stderr), 'brand-access-missing');
  assert.equal(await count('select count(*) from internal_preview.events'), '1');
});

test('local postgres, not production: short sha and a different product id are rejected', async () => {
  await psql(db, 'truncate internal_preview.events');
  const short = await applySql(db, { eventId: 'evt-short-0000000001', sha: FIRST_SHA.slice(0, 12), selected: true, base: 0 });
  const other = await applySql(db, { eventId: 'evt-other-0000000001', productId: '00000000-0000-4000-8000-000000000000', selected: true, base: 0 });
  assert.equal(sqlReason(short.stderr), 'sha256');
  assert.equal(sqlReason(other.stderr), 'product');
  assert.equal(await count('select count(*) from internal_preview.events'), '0');
  assert.equal(migrationSql.includes('TR260004'), false);
  assert.equal(migrationSql.includes('TR260007'), false);
  assert.equal(migrationSql.includes('TR2605002'), false);
});

test('local postgres, not production: repeating the same event is idempotent and a changed body conflicts', async () => {
  await psql(db, 'truncate internal_preview.events');
  const first = await applySql(db, { eventId: 'evt-same-00000000001', selected: true, base: 0 });
  const again = await applySql(db, { eventId: 'evt-same-00000000001', selected: true, base: 0 });
  assert.equal(lastJson(again.stdout).idempotent, true);
  assert.equal(await count('select count(*) from internal_preview.events'), '1');
  const changed = await applySql(db, { eventId: 'evt-same-00000000001', selected: false, base: 0 });
  assert.equal(sqlReason(changed.stderr), 'idempotency_conflict');
  const otherUser = await applySql(db, {
    claims: brandClaims({ sub: OTHER_USER }),
    eventId: 'evt-same-00000000001',
    selected: true,
    base: 0
  });
  assert.equal(sqlReason(otherUser.stderr), 'idempotency_conflict');
  assert.equal(await count('select count(*) from internal_preview.events'), '1');
});

test('local postgres, not production: concurrent writers with the same base revision conflict', async () => {
  await psql(db, 'truncate internal_preview.events');
  const [left, right] = await Promise.all([
    applySql(db, { eventId: 'evt-race-00000000001', selected: true, base: 0 }),
    applySql(db, { eventId: 'evt-race-00000000002', selected: true, base: 0 })
  ]);
  const results = [left, right];
  assert.equal(results.filter((item) => item.ok).length, 1);
  assert.equal(results.filter((item) => sqlReason(item.stderr) === 'revision_conflict').length, 1);
  assert.equal(await count('select count(*) from internal_preview.events'), '1');
});

test('local postgres, not production: unbind keeps history and does not change the product row', async () => {
  await psql(db, 'truncate internal_preview.events');
  assert.equal((await applySql(db, { eventId: 'evt-bind-00000000001', selected: true, base: 0 })).ok, true);
  const removed = await applySql(db, { eventId: 'evt-unbind-000000001', selected: false, base: 1 });
  assert.equal(removed.ok, true, removed.stderr);
  assert.deepEqual(lastJson(removed.stdout).selected, []);
  assert.equal(await count('select count(*) from internal_preview.events'), '2');
  assert.equal(await count('select actor::text from internal_preview.events order by revision desc limit 1'), BRAND_USER);
  assert.equal(await count('select status from public.products'), 'candidate');
  assert.equal(await count('select count(*) from public.product_image_selections'), '0');
  assert.equal(await count('select count(*) from public.product_assets'), '0');
  assert.equal(await count('select status from public.terralla_skus'), 'paused');
  assert.equal(/\b(update|delete|insert)\s+(into\s+)?(public\.)?(products|terralla_skus)\b/i.test(migrationSql), false);
});

test('local postgres, not production: rollback drops only the preview schema', async () => {
  const name = 'preview_contract_rollback';
  await recreateDatabase(name);
  await exec('psql', ['-d', name, '-v', 'ON_ERROR_STOP=1', '-f', new URL('../supabase/rollbacks/20261112160000_internal_preview_shared_down.sql', import.meta.url).pathname]);
  const products = await psql(name, 'select status from public.products');
  const schema = await psql(name, "select count(*) from information_schema.schemata where schema_name = 'internal_preview'");
  const roles = await psql(name, "select count(*) from pg_roles where rolname = 'authenticated'");
  assert.equal(products.stdout.split('\n').pop(), 'candidate');
  const selections = await psql(name, 'select count(*) from public.product_image_selections');
  const assets = await psql(name, 'select count(*) from public.product_assets');
  assert.equal(selections.stdout.split('\n').pop(), '0');
  assert.equal(assets.stdout.split('\n').pop(), '0');
  assert.equal(schema.stdout.split('\n').pop(), '0');
  assert.equal(roles.stdout.split('\n').pop(), '1');
});
