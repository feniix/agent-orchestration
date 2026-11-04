#!/usr/bin/env node
// init reads a definition from stdin; event reads {revision, event}; show is read-only.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createRun, loadRun, updateRun } from './run-store.ts';
import { eligibility } from './run-state.ts';

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: { state: { type: 'string' } } });
    if (!values.state || positionals.length !== 1) throw new Error('usage: run.ts init|show|event --state <file>');
    const action = positionals[0];
    if (!['init', 'show', 'event'].includes(action)) throw new Error('unknown action');
    const input = action === 'show' ? null : JSON.parse(readFileSync(0, 'utf8'));
    const run = action === 'init' ? createRun(values.state, input) : action === 'show' ? loadRun(values.state)
      : updateRun(values.state, input.revision, input.event);
    console.log(JSON.stringify({ ...run, frontier: eligibility(run) }, null, 2));
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
