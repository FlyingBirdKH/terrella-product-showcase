import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  FIRST_SHA,
  PRODUCT_ID,
  SECOND_SHA,
  applySql,
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

async function count(sql) {
  const result = await psql(db, sql);
  assert.equal(result.ok, true, result.stderr);
  return result.stdout.split('\n').pop();
}

before(async () => {
  await recreateDatabase(db);
});

test('local postgres, not production: kevin_admin write is readable by terralla_team and terralla_admin', async () => {
  await psql(db, 'truncate internal_preview.events');
  const saved = await applySql(db, { role: 'kevin_admin', eventId: 'evt-share-0000000001', sha: FIRST_SHA, selected: true, base: 0 });
  assert.equal(saved.ok, true, saved.stderr);
  const team = await readSql(db, { role: 'terralla_team' });
  const admin = await readSql(db, { role: 'terralla_admin' });
  assert.equal(team.ok, true, team.stderr);
  assert.equal(admin.ok, true, admin.stderr);
  assert.deepEqual(lastJson(team.stdout).selected, [FIRST_SHA]);
  assert.deepEqual(lastJson(admin.stdout).selected, [FIRST_SHA]);
  assert.equal(lastJson(team.stdout).saved, false);
  assert.equal(await count(`select brand_id from internal_preview.events`), 'terralla');
});

test('local postgres, not production: anonymous role cannot read or write', async () => {
  await psql(db, 'truncate internal_preview.events');
  const write = await psql(db, `set role anon; select public.internal_preview_apply_event('evt-anon-0000000001', '${PRODUCT_ID}', '${FIRST_SHA}', true, 0);`);
  const read = await psql(db, 'set role anon; select public.internal_preview_read(\'' + PRODUCT_ID + '\');');
  const table = await psql(db, 'set role anon; select count(*) from internal_preview.events;');
  assert.equal(write.ok, false);
  assert.equal(read.ok, false);
  assert.equal(table.ok, false);
  assert.match(`${write.stderr}\n${read.stderr}\n${table.stderr}`, /permission denied/i);
  assert.equal(await count('select count(*) from internal_preview.events'), '0');
});

test('local postgres, not production: terralla_team cannot write, and supplier or plain authenticated roles cannot read or write', async () => {
  await psql(db, 'truncate internal_preview.events');
  const teamWrite = await applySql(db, { role: 'terralla_team', eventId: 'evt-team-00000000001', selected: true, base: 0 });
  const plain = await applySql(db, { role: 'authenticated', eventId: 'evt-plain-0000000001', selected: true, base: 0 });
  const supplierAdmin = await readSql(db, { role: 'admin' });
  const sourcing = await applySql(db, { role: 'sourcing_manager', eventId: 'evt-source-000000001', selected: true, base: 0 });
  assert.equal(teamWrite.ok, false);
  assert.equal(plain.ok, false);
  assert.equal(supplierAdmin.ok, false);
  assert.equal(sourcing.ok, false);
  assert.match(`${teamWrite.stderr}\n${plain.stderr}\n${supplierAdmin.stderr}\n${sourcing.stderr}`, /permission denied|manager/);
  assert.equal(await count('select count(*) from internal_preview.events'), '0');
  assert.equal(await count('select count(*) from public.terralla_skus'), '1');
  const executable = migration.replace(/--[^\n]*/g, '');
  assert.equal(/\b(from|join|references)\s+auth\.users\b/i.test(executable), false);
  assert.equal(executable.includes('current_app_role'), false);
  assert.equal(executable.includes('is_internal_editor'), false);
  assert.equal(/\binsert\s+into\s+public\.terralla_skus\b/i.test(executable), false);
});

test('local postgres, not production: short sha and a different product id are rejected', async () => {
  await psql(db, 'truncate internal_preview.events');
  const short = await applySql(db, { eventId: 'evt-short-0000000001', sha: FIRST_SHA.slice(0, 12), selected: true, base: 0 });
  const other = await applySql(db, { eventId: 'evt-other-0000000001', productId: '00000000-0000-4000-8000-000000000000', selected: true, base: 0 });
  assert.equal(sqlReason(short.stderr), 'sha256');
  assert.equal(sqlReason(other.stderr), 'product');
  assert.equal(await count('select count(*) from internal_preview.events'), '0');
  assert.equal(migration.includes('TR260004'), false);
  assert.equal(migration.includes('TR260007'), false);
  assert.equal(migration.includes('TR2605002'), false);
  assert.equal(await count('select status from public.terralla_skus'), 'paused');
});

test('local postgres, not production: repeating the same event is idempotent and a changed body conflicts', async () => {
  await psql(db, 'truncate internal_preview.events');
  const first = await applySql(db, { eventId: 'evt-same-00000000001', selected: true, base: 0 });
  const again = await applySql(db, { eventId: 'evt-same-00000000001', selected: true, base: 0 });
  assert.equal(lastJson(again.stdout).idempotent, true);
  assert.equal(lastJson(again.stdout).saved, true);
  assert.equal(await count('select count(*) from internal_preview.events'), '1');
  const changed = await applySql(db, { eventId: 'evt-same-00000000001', selected: false, base: 0 });
  assert.equal(changed.ok, false);
  assert.equal(sqlReason(changed.stderr), 'idempotency_conflict');
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
  assert.equal((await applySql(db, { eventId: 'evt-bind-00000000001', sha: SECOND_SHA, selected: true, base: 0 })).ok, true);
  const removed = await applySql(db, { eventId: 'evt-unbind-000000001', sha: SECOND_SHA, selected: false, base: 1 });
  assert.equal(removed.ok, true, removed.stderr);
  const state = lastJson(removed.stdout);
  assert.deepEqual(state.selected, []);
  assert.equal(await count('select count(*) from internal_preview.events'), '2');
  assert.equal(await count(`select count(*) from internal_preview.events where sha256 = '${SECOND_SHA}'`), '2');
  assert.equal(await count('select status from public.products'), 'paused');
  assert.equal(await count('select count(*) from public.products'), '1');
  assert.equal(await count('select status from public.terralla_skus'), 'paused');
  const rollbackSql = rollback.replace(/--[^\n]*/g, '');
  const migrationSql = migration.replace(/--[^\n]*/g, '');
  assert.equal(/\b(update|delete|insert)\b/i.test(rollbackSql), false);
  assert.equal(/\b(update|delete|insert)\s+(into\s+)?(public\.)?(products|terralla_skus)\b/i.test(migrationSql), false);
});

test('local postgres, not production: rollback drops only the preview schema', async () => {
  const name = 'preview_contract_rollback';
  await recreateDatabase(name);
  await exec('psql', ['-d', name, '-v', 'ON_ERROR_STOP=1', '-f', new URL('../supabase/rollbacks/20261112160000_internal_preview_shared_down.sql', import.meta.url).pathname]);
  const products = await psql(name, 'select status from public.products');
  const schema = await psql(name, "select count(*) from information_schema.schemata where schema_name = 'internal_preview'");
  assert.equal(products.stdout.split('\n').pop(), 'paused');
  assert.equal(schema.stdout.split('\n').pop(), '0');
  const sku = await psql(name, 'select status || brand_id from (select status, brand_id from public.terralla_skus) s');
  assert.equal(sku.stdout.split('\n').pop(), 'pausedterralla');
});
