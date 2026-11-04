import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./run.ts', import.meta.url));
const definition = { id: 'run', concurrency: 1, maxRecoveries: 2, mergeAuthority: false,
  tickets: [{ id: 'A', blockers: [], modules: [] }] };
function execute(path: string, action: string, input?: unknown) {
  return spawnSync(process.execPath, [cli, action, '--state', path], { input: JSON.stringify(input), encoding: 'utf8' });
}
test('CLI persists history across fresh processes and rejects stale updates without modifying state', t => {
  const dir = mkdtempSync(join(tmpdir(), 'run-cli-')); t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'run.json');
  assert.equal(execute(path, 'init', definition).status, 0);
  assert.equal(execute(path, 'event', { revision: 0, event: { type: 'start', reason: 'approved' } }).status, 0);
  assert.equal(JSON.parse(execute(path, 'show').stdout).mode, 'active');
  const before = readFileSync(path, 'utf8');
  assert.equal(execute(path, 'event', { revision: 0, event: { type: 'pause', reason: 'stale' } }).status, 1);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(execute(path, 'init', definition).status, 1);
  assert.equal(JSON.parse(before).events.length, 1);
  mkdirSync(path + '.lock');
  assert.equal(execute(path, 'event', { revision: 1, event: { type: 'pause', reason: 'locked' } }).status, 1);
  assert.equal(readFileSync(path, 'utf8'), before);
});
test('two competing CLI writers accept only one revision', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'run-race-')); t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'run.json'); execute(path, 'init', definition);
  const results = await Promise.all([1, 2].map(i => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, 'event', '--state', path], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('close', resolve); child.stdin.end(JSON.stringify({ revision: 0, event: { type: 'start', reason: `writer ${i}` } }));
  })));
  assert.deepEqual(results.sort(), [0, 1]); assert.equal(JSON.parse(execute(path, 'show').stdout).revision, 1);
});
test('corrupt journal fails closed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'run-corrupt-')); t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, 'run.json'); writeFileSync(path, '{');
  assert.equal(execute(path, 'show').status, 1);
});
