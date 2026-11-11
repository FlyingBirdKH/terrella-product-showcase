import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SIMULATION_LABEL,
  applySimulatedReadback,
  createSimulation,
  readbackView,
  recordSimulatedApproval,
  requestImageChange,
  setTemporaryPick
} from './image-availability-sim.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ledger = JSON.parse(readFileSync(new URL('../image-availability.json', import.meta.url), 'utf8'));
const start = html.indexOf('function cleanToken(');
const end = html.indexOf('const releasePicks');
const fns = new Function(`${html.slice(start, end)}\nreturn { parseAvailabilityDocument, badgesForImage };`)();

const EXAMPLE_SHA_A = 'ff4696836d2ac0320db1bf247cd8e89e3760795c696caf0bbf61ffeb3033f342';
const EXAMPLE_SHA_B = '2f89191684cdab6756eafe1e4c116d801a36451cd6bc1f3be3c647f19929f44d';
const OTHER_SHA = '91cd1d7d67d7bacfba741d14c26dc340789a0836412518af4241fe0bb4a3fa0c';

function row(overrides = {}) {
  return {
    sku: 'CAT-001',
    sha256: EXAMPLE_SHA_A,
    target: 'example-target',
    approval: { state: 'approved', evidence: 'example-approval-evidence' },
    sync: { state: 'pending', evidence: '' },
    ...overrides
  };
}

test('canonical ledger is empty and does not contain the CAT-001 review SHAs', () => {
  assert.equal(ledger.schema, 'terrella.image-availability.v1');
  assert.deepEqual(ledger.records, []);
  const text = JSON.stringify(ledger);
  for (const sha of [EXAMPLE_SHA_A, EXAMPLE_SHA_B, OTHER_SHA, 'af3760c6b82472fcc1999dec44079feb5089613ccc6e247b4a9c94acfc7746c4']) {
    assert.equal(text.includes(sha), false);
  }
});

test('example document and malformed document never count as synced', () => {
  const example = fns.parseAvailabilityDocument({
    schema: 'terrella.image-availability.v1',
    example: true,
    records: [row({ sync: { state: 'verified', evidence: 'example-should-not-count' } })]
  });
  assert.equal(example.ok, false);
  assert.deepEqual(fns.badgesForImage(example.index, 'CAT-001', EXAMPLE_SHA_A).synced, []);
  const malformed = fns.parseAvailabilityDocument('{');
  assert.equal(malformed.ok, false);
  assert.deepEqual(fns.badgesForImage(malformed.index, 'CAT-001', EXAMPLE_SHA_A), {
    approved: [], synced: [], revoked: [], conflict: []
  });
});

test('approved evidence is not a sync badge, and identity mismatches do not cross over', () => {
  const parsed = fns.parseAvailabilityDocument({
    schema: 'terrella.image-availability.v1',
    records: [
      row(),
      row({
        sha256: EXAMPLE_SHA_B,
        target: 'other-example',
        approval: { state: 'pending', evidence: '' },
        sync: { state: 'verified', evidence: 'example-sync-evidence' }
      }),
      { sku: 'CAT-002', sha256: EXAMPLE_SHA_A, target: 'example-target', sync: { state: 'verified', evidence: 'wrong-sku' } },
      { sku: 'CAT-001', sha256: 'abcd', target: 'example-target', approval: { state: 'approved', evidence: 'bad-sha' } }
    ]
  });
  assert.equal(parsed.ok, true);
  const onlyApproved = fns.badgesForImage(parsed.index, 'CAT-001', EXAMPLE_SHA_A);
  assert.deepEqual(onlyApproved.approved, ['example-target']);
  assert.deepEqual(onlyApproved.synced, []);
  const other = fns.badgesForImage(parsed.index, 'CAT-001', EXAMPLE_SHA_B);
  assert.deepEqual(other.synced, ['other-example']);
  assert.deepEqual(other.approved, []);
  assert.deepEqual(fns.badgesForImage(parsed.index, 'CAT-002', EXAMPLE_SHA_A).synced, ['example-target']);
  assert.deepEqual(fns.badgesForImage(parsed.index, 'CAT-099', EXAMPLE_SHA_A).approved, []);
});

test('revoked, failed, and conflicting records do not show success', () => {
  const parsed = fns.parseAvailabilityDocument({
    schema: 'terrella.image-availability.v1',
    records: [
      row({ approval: { state: 'revoked', evidence: 'example-revoked' }, sync: { state: 'revoked', evidence: 'example-revoked' } }),
      row({ sha256: OTHER_SHA, approval: { state: 'approved', evidence: 'example-approval-evidence' }, sync: { state: 'failed', evidence: 'example-failed' } }),
      row({ sha256: EXAMPLE_SHA_B, sync: { state: 'verified', evidence: 'one' } }),
      row({ sha256: EXAMPLE_SHA_B, sync: { state: 'verified', evidence: 'two' } })
    ]
  });
  assert.deepEqual(fns.badgesForImage(parsed.index, 'CAT-001', EXAMPLE_SHA_A).approved, []);
  assert.deepEqual(fns.badgesForImage(parsed.index, 'CAT-001', EXAMPLE_SHA_A).revoked, ['example-target']);
  const mixed = fns.parseAvailabilityDocument({
    schema: 'terrella.image-availability.v1',
    records: [
      row({ sync: { state: 'verified', evidence: 'example-sync-evidence' }, approval: { state: 'revoked', evidence: 'example-revoked' } }),
      row({ sha256: EXAMPLE_SHA_B, approval: { state: 'approved', evidence: 'example-approval-evidence' }, sync: { state: 'revoked', evidence: 'example-revoked' } })
    ]
  });
  const render = new Function('esc', `${html.slice(start, end)}
    return function(index, sku, sha){
      availabilityPhase = 'ready';
      availabilityIndex = index;
      return durableBadgeHtml(sku, sha);
    };
  `)(value => String(value));
  const revokedApproval = render(mixed.index, 'CAT-001', EXAMPLE_SHA_A);
  const revokedSync = render(mixed.index, 'CAT-001', EXAMPLE_SHA_B);
  assert.match(revokedApproval, /已撤回 · example-target/);
  assert.match(revokedApproval, /已同步 · example-target/);
  assert.doesNotMatch(revokedApproval, /已放行/);
  assert.match(revokedSync, /已撤回 · example-target/);
  assert.match(revokedSync, /已放行 · example-target/);
  assert.doesNotMatch(revokedSync, /已同步/);
  const failed = fns.badgesForImage(parsed.index, 'CAT-001', OTHER_SHA);
  assert.deepEqual(failed.approved, ['example-target']);
  assert.deepEqual(failed.synced, []);
  assert.deepEqual(fns.badgesForImage(parsed.index, 'CAT-001', EXAMPLE_SHA_B).conflict, ['example-target']);
  assert.deepEqual(fns.badgesForImage(parsed.index, 'CAT-001', EXAMPLE_SHA_B).synced, []);
});

test('simulation keeps picks, approval, and actual publish state apart', () => {
  let sim = createSimulation();
  assert.equal(sim.label, SIMULATION_LABEL);
  const picked = setTemporaryPick(sim, { sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target' }, true);
  sim = picked.sim;
  assert.equal(sim.picks.length, 1);
  assert.equal(sim.approved.length, 0);
  assert.equal(sim.actual.length, 0);

  const denied = requestImageChange(sim, {
    actor: 'public', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', intent: 'publish', baseGeneration: sim.generation
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'public-cannot-mutate');
  assert.equal(denied.sim.actual.length, 0);

  const desired = requestImageChange(sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', intent: 'publish', baseGeneration: sim.generation
  });
  assert.equal(desired.ok, true);
  assert.equal(desired.shownSuccess, false);
  assert.equal(desired.sim.actual.length, 0);
  assert.equal(desired.sim.desired[0].originalsRetained, true);
  assert.equal(desired.sim.desired[0].productRetained, true);
  assert.equal(desired.sim.desired[0].scope, 'image');

  const failed = applySimulatedReadback(desired.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', baseGeneration: desired.sim.generation,
    readback: { ok: false, simulation: true }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.shownSuccess, false);
  assert.deepEqual(failed.sim.actual, []);

  const published = applySimulatedReadback(desired.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', baseGeneration: desired.sim.generation,
    readback: { ok: true, simulation: true, present: true, sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target' }
  });
  assert.equal(published.ok, true);
  assert.equal(published.sim.actual[0].actual, 'published');
  assert.equal(published.sim.actual[0].evidence, 'simulation:readback');

  const stale = applySimulatedReadback(desired.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', baseGeneration: desired.sim.generation,
    readback: { ok: true, simulation: true, present: true, sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target' }
  });
  const raced = applySimulatedReadback(published.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_B, target: 'example-target', baseGeneration: desired.sim.generation,
    readback: { ok: true, simulation: true, present: true, sku: 'CAT-001', sha256: EXAMPLE_SHA_B, target: 'example-target' }
  });
  assert.equal(stale.ok, true);
  assert.equal(raced.ok, false);
  assert.equal(raced.reason, 'stale');
  assert.equal(raced.sim.actual.length, 1);

  const unpublishDesire = requestImageChange(published.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', intent: 'unpublish', baseGeneration: published.sim.generation
  });
  const withdrawn = applySimulatedReadback(unpublishDesire.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', baseGeneration: unpublishDesire.sim.generation,
    readback: { ok: true, simulation: true, present: false, sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target' }
  });
  assert.equal(withdrawn.sim.actual[0].actual, 'not-published');
  assert.equal(withdrawn.sim.actual[0].originalsRetained, true);
  assert.equal(withdrawn.sim.actual[0].productRetained, true);

  const reselect = requestImageChange(withdrawn.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', intent: 'publish', baseGeneration: withdrawn.sim.generation
  });
  const again = applySimulatedReadback(reselect.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target', baseGeneration: reselect.sim.generation,
    readback: { ok: true, simulation: true, present: true, sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target' }
  });
  assert.equal(again.sim.actual[0].actual, 'published');

  const approved = recordSimulatedApproval(again.sim, {
    actor: 'manager', sku: 'CAT-001', sha256: EXAMPLE_SHA_A, target: 'example-target',
    evidence: 'simulation:approval', baseGeneration: again.sim.generation
  });
  assert.equal(approved.actualUnchanged, true);
  assert.equal(approved.sim.actual[0].actual, 'published');
  const view = readbackView(approved.sim);
  assert.equal(view.picks.length, 1);
  assert.equal(view.approved[0].state, 'approved');
  assert.equal(view.actual[0].actual, 'published');
  assert.equal(view.picks[0] === view.approved[0], false);
});
