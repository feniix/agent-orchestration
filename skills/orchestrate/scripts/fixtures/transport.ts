// Test-only transport: a real child process stands in for the orchestrator pane.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { loadRun } from '../run-store.ts';
const [action, controlPath] = process.argv.slice(2);
const input = JSON.parse(readFileSync(0, 'utf8'));
const control = JSON.parse(readFileSync(controlPath, 'utf8'));
if (action === 'observe') {
  let status = control.status;
  if (control.pid) {
    try { process.kill(control.pid, 0); status = 'working'; } catch { status = 'missing'; }
  }
  if (control.badObservation) process.exit(1);
  console.log(JSON.stringify({ target: control.target, status, workerEvent: control.workerEvent ?? false }));
} else {
  const run = loadRun(input.statePath);
  if (!['active', 'waiting-workers'].includes(run.mode) || run.recovery?.token !== input.token) {
    console.log(JSON.stringify({ outcome: 'not-delivered' }));
  } else {
    appendFileSync(controlPath + '.calls', input.token + '\n');
    if (control.behavior === 'uncertain') process.exit(1);
    if (control.behavior === 'restart') {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
      child.unref(); control.pid = child.pid; writeFileSync(controlPath, JSON.stringify(control));
    }
    console.log(JSON.stringify({ outcome: control.behavior === 'not-delivered' ? 'not-delivered' : 'delivered' }));
  }
}
