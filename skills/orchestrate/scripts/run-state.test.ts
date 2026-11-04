import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialize, transition, eligibility } from './run-state.ts';
import type { Event } from './run-state.ts';

export const definition = { id: 'example', concurrency: 2, maxRecoveries: 2, mergeAuthority: true,
  tickets: [ { id: 'A', blockers: [], modules: ['api'] }, { id: 'B', blockers: [], modules: ['ui'] },
    { id: 'C', blockers: ['A', 'B'], modules: ['api'] } ] };
const head = 'a'.repeat(40);
function machine(d = definition) {
  let run = initialize(d);
  return { get run() { return run; }, send(event: Event) { run = transition(run, event, 1); return run; } };
}
test('reject malformed graphs before any work', () => {
  for (const tickets of [[], [{ id: 'A', blockers: ['unknown'], modules: [] }],
    [{ id: 'A', blockers: ['A'], modules: [] }], [definition.tickets[0], definition.tickets[0]],
    [{ id: 'A', blockers: ['B'], modules: [] }, { id: 'B', blockers: ['A'], modules: [] }]]) {
    assert.throws(() => initialize({ ...definition, tickets }));
  }
  assert.throws(() => initialize({ ...definition, mergeAuthority: undefined }));
  assert.throws(() => initialize({ ...definition, concurrency: 0 }));
});
test('owner start gate, parallel frontier and merged dependencies', () => {
  const m = machine();
  assert.throws(() => m.send({ type: 'dispatch', ticket: 'A' }), /paused/);
  m.send({ type: 'start', reason: 'Owner approved' });
  assert.deepEqual(eligibility(m.run).filter(t => !t.reasons.length).map(t => t.id), ['A', 'B']);
  for (const ticket of ['A', 'B']) m.send({ type: 'dispatch', ticket });
  assert.throws(() => m.send({ type: 'dispatch', ticket: 'C' }), /concurrency/);
  for (const ticket of ['A', 'B']) {
    m.send({ type: 'ready', ticket, attempt: 1, head, pr: 1 });
    assert.throws(() => m.send({ type: 'merged', ticket, attempt: 1, head, pr: 1, evidence: 'readback' }));
    m.send({ type: 'authorize-merge', ticket, attempt: 1, head, evidence: 'checks' });
    m.send({ type: 'merged', ticket, attempt: 1, head, pr: 1, evidence: 'readback' });
  }
  assert.deepEqual(eligibility(m.run), [{ id: 'C', reasons: [] }]);
});
test('declared module conflicts reserve slots through review and blocked states', () => {
  const m = machine({ ...definition, tickets: definition.tickets.map(t => ({ ...t, modules: ['shared'] })) });
  m.send({ type: 'start', reason: 'approved' }); m.send({ type: 'dispatch', ticket: 'A' });
  m.send({ type: 'block', ticket: 'A', attempt: 1, reason: 'needs input' });
  assert.throws(() => m.send({ type: 'dispatch', ticket: 'B' }), /module conflict/);
});
test('rework changes attempt and invalidates head; stale result cannot ready ticket', () => {
  const m = machine(); m.send({ type: 'start', reason: 'approved' }); m.send({ type: 'dispatch', ticket: 'A' });
  m.send({ type: 'ready', ticket: 'A', attempt: 1, head, pr: 1 });
  m.send({ type: 'rework', ticket: 'A', attempt: 1, reason: 'changed head' });
  assert.equal(m.run.tickets[0].head, undefined);
  assert.throws(() => m.send({ type: 'ready', ticket: 'A', attempt: 1, head, pr: 1 }), /stale attempt/);
});
test('pause allows observations but not dispatch or merge authorization', () => {
  const m = machine(); m.send({ type: 'start', reason: 'approved' }); m.send({ type: 'dispatch', ticket: 'A' });
  m.send({ type: 'pause', reason: 'owner said wait' });
  m.send({ type: 'ready', ticket: 'A', attempt: 1, head, pr: 1 });
  assert.throws(() => m.send({ type: 'authorize-merge', ticket: 'A', attempt: 1, head, evidence: 'checks' }), /active/);
});
test('merge authority and exact SHA enforced; only one outstanding merge', () => {
  const m = machine(); m.send({ type: 'start', reason: 'approved' });
  for (const ticket of ['A', 'B']) {
    m.send({ type: 'dispatch', ticket }); m.send({ type: 'ready', ticket, attempt: 1, head, pr: 1 });
  }
  assert.throws(() => m.send({ type: 'authorize-merge', ticket: 'A', attempt: 1, head: 'b'.repeat(40), evidence: 'checks' }));
  m.send({ type: 'authorize-merge', ticket: 'A', attempt: 1, head, evidence: 'checks' });
  assert.throws(() => m.send({ type: 'authorize-merge', ticket: 'B', attempt: 1, head, evidence: 'checks' }), /another merge/);
  const denied = { ...m.run, definition: { ...definition, mergeAuthority: false } };
  assert.throws(() => transition(denied, { type: 'authorize-merge', ticket: 'B', attempt: 1, head, evidence: 'checks' }, 1), /authority/);
});
test('uncertain recovery requires explicit reconciliation and does not replenish budget', () => {
  const m = machine(); m.send({ type: 'start', reason: 'approved' });
  m.send({ type: 'recover', token: 'one' });
  m.send({ type: 'recovery-result', token: 'one', outcome: 'uncertain', reason: 'timeout' });
  assert.equal(m.run.mode, 'attention');
  assert.throws(() => m.send({ type: 'start', reason: 'resume' }), /reconcile/);
  m.send({ type: 'reconcile-recovery', token: 'one', outcome: 'delivered', reason: 'checked target' });
  m.send({ type: 'start', reason: 'owner resumed' });
  assert.equal(m.run.recoveries, 1);
});
test('interrupted merge must be reconciled before rework or another authorization', () => {
  const m = machine(); m.send({ type: 'start', reason: 'approved' }); m.send({ type: 'dispatch', ticket: 'A' });
  m.send({ type: 'ready', ticket: 'A', attempt: 1, head, pr: 1 });
  m.send({ type: 'authorize-merge', ticket: 'A', attempt: 1, head, evidence: 'checked exact head' });
  assert.throws(() => m.send({ type: 'rework', ticket: 'A', attempt: 1, reason: 'uncertain merge' }));
  m.send({ type: 'merge-not-applied', ticket: 'A', attempt: 1, evidence: 'GitHub confirms PR open' });
  m.send({ type: 'rework', ticket: 'A', attempt: 1, reason: 'now safe to reverify' });
  assert.equal(m.run.tickets[0].attempt, 2);
});
test('owner pause during recovery completion is retained', () => {
  const m = machine(); m.send({ type: 'start', reason: 'approved' }); m.send({ type: 'recover', token: 'one' });
  m.send({ type: 'pause', reason: 'owner wait' });
  m.send({ type: 'recovery-result', token: 'one', outcome: 'delivered' });
  assert.equal(m.run.mode, 'paused'); assert.equal(m.run.reason, 'owner wait');
});
