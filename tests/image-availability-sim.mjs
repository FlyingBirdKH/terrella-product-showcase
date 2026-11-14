/**
 * SIMULATION ONLY.
 * Not terralla.com, not Bunny, and not a manager backend.
 * Nothing here is a real site readback or an approval record.
 */
export const SIMULATION_LABEL = 'simulation-not-a-backend-or-site-readback';

export function createSimulation() {
  return {
    label: SIMULATION_LABEL,
    generation: 1,
    picks: [],
    desired: [],
    approved: [],
    actual: []
  };
}

function imageKey(item) {
  return `${item.sku}\n${item.sha256}\n${item.target}`;
}

function clone(sim) {
  return {
    label: sim.label,
    generation: sim.generation,
    picks: sim.picks.map(item => ({ ...item })),
    desired: sim.desired.map(item => ({ ...item })),
    approved: sim.approved.map(item => ({ ...item, approval: { ...item.approval } })),
    actual: sim.actual.map(item => ({ ...item }))
  };
}

export function setTemporaryPick(sim, pick, selected) {
  const next = clone(sim);
  const key = imageKey(pick);
  next.picks = next.picks.filter(item => imageKey(item) !== key);
  if (selected) next.picks.push({ sku: pick.sku, sha256: pick.sha256, target: pick.target, temporary: true });
  return { ok: true, sim: next, approved: next.approved, actual: next.actual };
}

export function recordSimulatedApproval(sim, { actor, sku, sha256, target, evidence, baseGeneration }) {
  if (sim.label !== SIMULATION_LABEL) return { ok: false, reason: 'not-simulation', sim };
  if (actor !== 'manager') return { ok: false, reason: 'public-cannot-mutate', sim };
  if (baseGeneration !== sim.generation) return { ok: false, reason: 'stale', sim };
  if (!evidence || !String(evidence).startsWith('simulation:')) return { ok: false, reason: 'evidence', sim };
  const next = clone(sim);
  const key = imageKey({ sku, sha256, target });
  next.approved = next.approved.filter(item => imageKey(item) !== key);
  next.approved.push({ sku, sha256, target, approval: { state: 'approved', evidence } });
  next.generation += 1;
  return { ok: true, sim: next, actualUnchanged: true };
}

export function requestImageChange(sim, { actor, sku, sha256, target, intent, baseGeneration }) {
  if (sim.label !== SIMULATION_LABEL) return { ok: false, reason: 'not-simulation', sim };
  if (actor !== 'manager') return { ok: false, reason: 'public-cannot-mutate', sim };
  if (baseGeneration !== sim.generation) return { ok: false, reason: 'stale', sim };
  if (intent !== 'publish' && intent !== 'unpublish') return { ok: false, reason: 'intent', sim };
  const next = clone(sim);
  next.desired.push({
    sku,
    sha256,
    target,
    intent,
    baseGeneration,
    scope: 'image',
    originalsRetained: true,
    productRetained: true
  });
  return { ok: true, reason: 'desired-only', sim: next, shownSuccess: false, actual: next.actual };
}

export function applySimulatedReadback(sim, { actor, sku, sha256, target, baseGeneration, readback }) {
  if (sim.label !== SIMULATION_LABEL) return { ok: false, reason: 'not-simulation', sim, shownSuccess: false };
  if (actor !== 'manager') return { ok: false, reason: 'public-cannot-mutate', sim, shownSuccess: false };
  if (baseGeneration !== sim.generation) return { ok: false, reason: 'stale', sim, shownSuccess: false };
  const desire = [...sim.desired].reverse().find(item => item.sku === sku && item.sha256 === sha256 && item.target === target);
  if (!desire) return { ok: false, reason: 'no-intent', sim, shownSuccess: false };
  if (!readback || readback.ok !== true) return { ok: false, reason: 'readback-failed', sim, shownSuccess: false };
  if (readback.sku !== sku || readback.sha256 !== sha256 || readback.target !== target) {
    return { ok: false, reason: 'readback-identity', sim, shownSuccess: false };
  }
  const expectPresent = desire.intent === 'publish';
  if (readback.present !== expectPresent || readback.simulation !== true) {
    return { ok: false, reason: 'readback-mismatch', sim, shownSuccess: false };
  }
  const next = clone(sim);
  const key = imageKey({ sku, sha256, target });
  next.actual = next.actual.filter(item => imageKey(item) !== key);
  next.actual.push({
    sku,
    sha256,
    target,
    actual: readback.present ? 'published' : 'not-published',
    evidence: 'simulation:readback',
    originalsRetained: true,
    productRetained: true,
    generation: sim.generation + 1
  });
  next.generation += 1;
  return { ok: true, reason: 'readback-confirmed', sim: next, shownSuccess: true, actual: next.actual };
}

export function readbackView(sim) {
  return {
    label: sim.label,
    picks: sim.picks.map(item => item.sku + item.sha256),
    approved: sim.approved.map(item => ({ sku: item.sku, sha256: item.sha256, target: item.target, state: item.approval.state })),
    actual: sim.actual.map(item => ({ sku: item.sku, sha256: item.sha256, target: item.target, actual: item.actual }))
  };
}
