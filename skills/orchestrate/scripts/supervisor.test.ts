import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createRun, loadRun, updateRun } from './run-store.ts';
import { config, observation, policy, hook } from './supervisor.ts';
const script = fileURLToPath(new URL('./supervisor.ts', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/transport.ts', import.meta.url));
const definition = { id: 'test', concurrency: 1, maxRecoveries: 2, mergeAuthority: false,
  tickets: [{ id: 'A', blockers: [], modules: [] }] };
async function until(check: () => boolean, timeout = 6000) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error('condition timed out'); await new Promise(r => setTimeout(r, 20)); }
}
function setup(t: { after: (fn: () => unknown) => void }, control: object = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'supervisor-')), state = join(dir, 'run.json'), transport = join(dir, 'transport.json');
  createRun(state, definition); updateRun(state, 0, { type: 'start', reason: 'approved' });
  writeFileSync(transport, JSON.stringify({ target: 'pane-test', status: 'idle', ...control }));
  const configuration = { target: 'pane-test', observe: [process.execPath, fixture, 'observe', transport],
    resume: [process.execPath, fixture, 'resume', transport], pollMs: 20, graceMs: 60, cooldownMs: 100, timeoutMs: 3000 };
  const configPath = join(dir, 'config.json'); writeFileSync(configPath, JSON.stringify(configuration));
  t.after(() => {
    try { const c = JSON.parse(readFileSync(transport, 'utf8')); if (c.pid) process.kill(c.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true });
  });
  return { state, transport, configPath, configuration,
    send(event: object) { return updateRun(state, loadRun(state).revision, event as { type: string }); },
    calls() { return existsSync(transport + '.calls') ? readFileSync(transport + '.calls', 'utf8').trim().split('\n').length : 0; },
    launch(extra: string[] = []) {
      const child = spawn(process.execPath, [script, '--state', state, '--config', configPath, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; });
      const closed = once(child, 'close');
      return { child, closed, output: () => output, async stop() { child.kill('SIGTERM'); await closed; } };
    } };
}
test('policy distinguishes intentional waits, missing processes and uncertain statuses', () => {
  const run = createPolicyRun();
  const o = { target: 'pane', status: 'idle' as const, workerEvent: false };
  assert.equal(policy(run, o), 'recover');
  assert.equal(policy({ ...run, mode: 'waiting-owner' }, o), 'hold');
  assert.equal(policy({ ...run, mode: 'waiting-workers' }, o), 'hold');
  assert.equal(policy({ ...run, mode: 'waiting-workers' }, { ...o, workerEvent: true }), 'recover');
  assert.equal(policy({ ...run, mode: 'waiting-workers' }, { ...o, status: 'missing' }), 'recover');
  assert.equal(policy(run, { ...o, status: 'working' }), 'watch');
  assert.equal(policy(run, { ...o, status: 'unknown' }), 'attention');
});
import { initialize, transition } from './run-state.ts';
function createPolicyRun() { return transition(initialize(definition), { type: 'start', reason: 'approved' }, 1); }
test('configuration and transport identity fail closed', () => {
  assert.throws(() => config({}));
  assert.throws(() => observation({ target: 'wrong', status: 'idle', workerEvent: false }, 'pane'));
  assert.throws(() => observation({ target: 'pane', status: 'idle' }, 'pane'));
});
test('hook timeout is bounded and not interpreted as proof of no delivery', async () => {
  await assert.rejects(hook([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {}, 50), /uncertain/);
});
test('independent supervisor restarts an actually killed orchestrator process', async t => {
  const orchestrator = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const death = once(orchestrator, 'close');
  const f = setup(t, { pid: orchestrator.pid, behavior: 'restart' });
  const supervisor = f.launch();
  try {
    await until(() => supervisor.output().includes('watch'));
    assert.equal(f.calls(), 0);
    orchestrator.kill('SIGKILL'); await death;
    await until(() => loadRun(f.state).recovery?.outcome === 'delivered');
    const newPid = JSON.parse(readFileSync(f.transport, 'utf8')).pid;
    assert.notEqual(newPid, orchestrator.pid); assert.doesNotThrow(() => process.kill(newPid, 0));
    assert.equal(f.calls(), 1); assert.equal(loadRun(f.state).recoveries, 1);
  } finally { await supervisor.stop(); }
});
test('idle owner wait stays paused while worker completion wakes a worker wait', async t => {
  const f = setup(t); f.send({ type: 'wait-owner', reason: 'design decision' });
  let supervisor = f.launch();
  await until(() => supervisor.output().includes('hold'));
  assert.equal(f.calls(), 0); await supervisor.stop();
  f.send({ type: 'start', reason: 'owner answered' }); f.send({ type: 'dispatch', ticket: 'A' });
  f.send({ type: 'wait-workers', reason: 'implementation ongoing' });
  supervisor = f.launch();
  try {
    await until(() => supervisor.output().includes('hold')); assert.equal(f.calls(), 0);
    writeFileSync(f.transport, JSON.stringify({ target: 'pane-test', status: 'idle', workerEvent: true }));
    await until(() => f.calls() > 0);
  } finally { await supervisor.stop(); }
});
test('definite non-delivery retries to persisted budget; restart cannot reset it', async t => {
  const f = setup(t, { behavior: 'not-delivered' }); let supervisor = f.launch();
  await until(() => loadRun(f.state).mode === 'attention'); await supervisor.stop();
  assert.equal(f.calls(), 2); assert.equal(loadRun(f.state).recoveries, 2);
  supervisor = f.launch(['--once']); await supervisor.closed;
  assert.equal(f.calls(), 2);
});
test('ambiguous delivery stops after one attempt, including after supervisor restart', async t => {
  const f = setup(t, { behavior: 'uncertain' }); const supervisor = f.launch();
  await until(() => loadRun(f.state).mode === 'attention'); await supervisor.stop();
  assert.equal(f.calls(), 1); assert.equal(loadRun(f.state).recovery?.outcome, 'pending');
  const again = f.launch(['--once']); await again.closed; assert.equal(f.calls(), 1);
});
test('persisted interrupted recovery is reconciled, never resent', async t => {
  const f = setup(t); f.send({ type: 'recover', token: 'interrupted' });
  const supervisor = f.launch(['--once']); await supervisor.closed;
  assert.equal(loadRun(f.state).mode, 'attention'); assert.equal(f.calls(), 0);
});
test('observation errors never trigger a restart', async t => {
  const f = setup(t, { badObservation: true }); const supervisor = f.launch(['--once']); await supervisor.closed;
  assert.equal(f.calls(), 0); assert.equal(loadRun(f.state).recoveries, 0);
  assert.match(supervisor.output(), /observation-error/);
});
test('second supervisor cannot act on the same run', async t => {
  const f = setup(t); f.send({ type: 'pause', reason: 'owner wait' });
  const first = f.launch(); await until(() => first.output().includes('hold'));
  try {
    const second = f.launch(['--once']); const result = await second.closed;
    assert.equal(result[0], 1); assert.match(second.output(), /EEXIST/); assert.equal(f.calls(), 0);
  } finally { await first.stop(); }
});
test('hook deadline does not wait for a descendant holding inherited pipes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hook-descendant-')), pidFile = join(dir, 'pid');
  t.after(() => {
    try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true });
  });
  const code = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    writeFileSync(process.argv[1],String(child.pid)); setInterval(()=>{},1000);`;
  const started = Date.now();
  await assert.rejects(hook([process.execPath, '-e', code, pidFile], {}, 250), /timeout.*uncertain/);
  assert.ok(existsSync(pidFile), 'fixture descendant started');
  assert.ok(Date.now() - started < 1500, 'deadline must not wait for long-lived descendant');
});
