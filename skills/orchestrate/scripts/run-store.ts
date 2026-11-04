import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialize, requireThat, transition } from './run-state.ts';
import type { Definition, Event, Run } from './run-state.ts';

type Journal = { version: 1; definition: Definition; events: { at: number; event: Event }[] };
export function canonical(path: string): string {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : resolve(realpathSync(dirname(absolute)), basename(absolute));
}
// Locks are deliberately not stolen on timeout/PID guesses. A crash needs explicit operator reconciliation.
export function lock(path: string): () => void {
  mkdirSync(path, { mode: 0o700 });
  try { writeFileSync(`${path}/owner.json`, JSON.stringify({ pid: process.pid, started: Date.now() }), { mode: 0o600 }); }
  catch (error) { rmSync(path, { recursive: true }); throw error; }
  return () => rmSync(path, { recursive: true });
}
function read(path: string): { journal: Journal; run: Run } {
  const journal: Journal = JSON.parse(readFileSync(path, 'utf8'));
  requireThat(journal.version === 1 && Array.isArray(journal.events), 'unsupported/corrupt run journal');
  let run = initialize(journal.definition);
  let previous = 0;
  for (const entry of journal.events) {
    requireThat(entry.at >= previous, 'journal time moved backwards'); previous = entry.at;
    run = transition(run, entry.event, entry.at);
  }
  return { journal, run };
}
export function loadRun(path: string): Run { return read(canonical(path)).run; }
function save(path: string, journal: Journal) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(journal, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { renameSync(temporary, path); }
  finally { if (existsSync(temporary)) rmSync(temporary); }
  const dir = openSync(dirname(path), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function createRun(path: string, definition: unknown): Run {
  path = canonical(path);
  const run = initialize(definition);
  const release = lock(`${path}.lock`);
  try {
    requireThat(!existsSync(path), 'run already exists');
    save(path, { version: 1, definition: run.definition, events: [] }); return run;
  } finally { release(); }
}
export function updateRun(path: string, revision: number, event: Event, now = Date.now()): Run {
  path = canonical(path);
  const release = lock(`${path}.lock`);
  try {
    const { journal, run } = read(path);
    requireThat(run.revision === revision, 'stale revision; read state before retrying');
    const at = Math.max(now, journal.events.at(-1)?.at ?? 0);
    const next = transition(run, event, at);
    journal.events.push({ at, event }); save(path, journal); return next;
  } finally { release(); }
}
