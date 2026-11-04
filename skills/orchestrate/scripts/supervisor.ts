#!/usr/bin/env node
// Independent supervisor. Transport adapters are argv arrays; Herdr remains transport-owned.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { canonical, loadRun, lock, updateRun } from './run-store.ts';
import { requireThat } from './run-state.ts';
import type { Run } from './run-state.ts';

export type Observation = {
  target: string; status: 'working' | 'idle' | 'done' | 'missing' | 'blocked' | 'unknown';
  // A worker result/stop requiring orchestrator attention, not mere worker activity.
  workerEvent: boolean;
};
export type Config = {
  target: string; observe: string[]; resume: string[];
  pollMs: number; graceMs: number; cooldownMs: number; timeoutMs: number;
};
export function config(input: unknown): Config {
  requireThat(input && typeof input === 'object', 'config must be an object');
  const c = input as Config;
  requireThat(typeof c.target === 'string' && c.target.trim(), 'target identity required');
  for (const name of ['observe', 'resume'] as const) {
    requireThat(Array.isArray(c[name]) && c[name].length && c[name].every(s => typeof s === 'string' && s.length), `${name} argv required`);
  }
  for (const name of ['pollMs', 'graceMs', 'cooldownMs', 'timeoutMs'] as const) {
    requireThat(Number.isSafeInteger(c[name]) && c[name] > 0, `${name} must be a positive integer`);
  }
  return c;
}
export function observation(input: unknown, target: string): Observation {
  requireThat(input && typeof input === 'object', 'invalid observation');
  const o = input as Observation;
  requireThat(o.target === target, 'transport target mismatch');
  requireThat(['working', 'idle', 'done', 'missing', 'blocked', 'unknown'].includes(o.status), 'invalid transport status');
  requireThat(typeof o.workerEvent === 'boolean', 'workerEvent must be explicit');
  return o;
}
export function policy(run: Run, o: Observation): 'hold' | 'watch' | 'recover' | 'attention' {
  if (!['active', 'waiting-workers'].includes(run.mode)) return 'hold';
  if (run.recovery?.outcome === 'pending') return 'attention';
  if (o.status === 'working') return 'watch';
  if (o.status === 'blocked' || o.status === 'unknown') return 'attention';
  if (run.mode === 'waiting-workers' && !o.workerEvent && o.status !== 'missing') return 'hold';
  return run.recoveries < run.definition.maxRecoveries ? 'recover' : 'attention';
}

// Bound both output and runtime. Never interpret hook text as a shell command.
export async function hook(argv: string[], input: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', size = 0, settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.kill('SIGKILL');
      // Descendants may retain inherited pipes. They must not own our timeout or shutdown.
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('hook timeout; delivery may be uncertain')), timeoutMs);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) fail(new Error('hook output limit; delivery may be uncertain'));
      else output += chunk;
    });
    // Drain stderr without putting potentially private transport output in state or logs.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', fail);
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) { fail(new Error(`hook exited ${code}; delivery may be uncertain`)); return; }
      let reply: unknown;
      try { reply = JSON.parse(output); } catch { fail(new Error('hook did not return JSON')); return; }
      settled = true; clearTimeout(timer); resolve(reply);
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function supervise(path: string, c: Config, once = false, stop = () => false) {
  path = canonical(path);
  const release = lock(`${path}.supervisor-lock`);
  let unhealthySince: number | undefined;
  let fingerprint = '';
  const report = (status: string, detail: string) => console.log(JSON.stringify({ at: Date.now(), status, detail }));
  try {
    // Never resend an intent whose previous process may have delivered it.
    let initial = loadRun(path);
    if (initial.recovery?.outcome === 'pending' && initial.mode !== 'attention') {
      updateRun(path, initial.revision, { type: 'attention', reason: 'Interrupted recovery: reconcile transport delivery before resuming' });
    }
    do {
      try {
        let run = loadRun(path);
        if (run.mode === 'finished') { report('finished', 'All tickets merged'); return; }
        if (!['active', 'waiting-workers'].includes(run.mode)) {
          unhealthySince = undefined; report('hold', run.reason);
        } else {
          const o = observation(await hook(c.observe, { target: c.target, run }, c.timeoutMs), c.target);
          // Re-read after an external call: a concurrent owner pause supersedes the observation.
          const latest = loadRun(path);
          if (latest.revision !== run.revision) { unhealthySince = undefined; continue; }
          const next = policy(run, o);
          const key = `${run.revision}:${run.mode}:${o.status}:${o.workerEvent}`;
          if (next === 'attention') {
            updateRun(path, run.revision, { type: 'attention', reason: run.recoveries >= run.definition.maxRecoveries
              ? 'Recovery budget exhausted; owner intervention required' : `Transport ${o.status} or unresolved recovery; inspect before proceeding` });
            unhealthySince = undefined; report('attention', 'Run requires operator reconciliation');
          } else if (next !== 'recover') {
            unhealthySince = undefined; report(next, o.status);
          } else {
            if (fingerprint !== key) { fingerprint = key; unhealthySince = Date.now(); }
            unhealthySince ??= Date.now();
            const cooled = !run.recovery || Date.now() - run.recovery.at >= c.cooldownMs;
            if (Date.now() - unhealthySince >= c.graceMs && cooled) {
              // The second observation narrows the read/send race. Adapters must also recheck before sending.
              const fresh = observation(await hook(c.observe, { target: c.target, run }, c.timeoutMs), c.target);
              requireThat(loadRun(path).revision === run.revision, 'state changed before recovery');
              if (policy(run, fresh) !== 'recover') { unhealthySince = undefined; continue; }
              const token = randomUUID();
              run = updateRun(path, run.revision, { type: 'recover', token });
              let outcome = 'uncertain';
              try {
                const reply = await hook(c.resume, {
                  target: c.target, token, statePath: path, revision: run.revision, run, observation: fresh,
                  instruction: 'Reconcile current panes and PR state before continuing. Preserve owner pauses and existing authority. Never blindly repeat an uncertain merge.'
                }, c.timeoutMs) as { outcome?: string };
                requireThat(reply && ['delivered', 'not-delivered', 'uncertain'].includes(String(reply.outcome)), 'invalid resume outcome');
                outcome = reply.outcome!;
              } catch { /* Uncertain transport failure is not an invitation to replay. */ }
              const after = loadRun(path);
              // A concurrent pause is retained by recovery-result; it only settles the intent.
              updateRun(path, after.revision, { type: 'recovery-result', token, outcome,
                reason: 'Recovery delivery uncertain; reconcile before retrying' });
              unhealthySince = undefined;
              report(outcome, `Recovery ${run.recoveries}/${run.definition.maxRecoveries}`);
            } else report('grace', o.status);
          }
        }
      } catch (error) {
        unhealthySince = undefined;
        // Failed observation does not establish a dead agent. Leave state intact and try reading again.
        report('observation-error', (error as Error).message);
      }
      if (!once && !stop()) await new Promise(resolve => setTimeout(resolve, c.pollMs));
    } while (!once && !stop());
  } finally { release(); }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: { state: { type: 'string' }, config: { type: 'string' }, once: { type: 'boolean' } } });
    requireThat(values.state && values.config, 'usage: supervisor.ts --state <file> --config <file> [--once]');
    let stopping = false;
    process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
    await supervise(values.state, config(JSON.parse(readFileSync(values.config, 'utf8'))), values.once, () => stopping);
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
