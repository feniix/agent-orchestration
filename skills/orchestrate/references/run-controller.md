# Durable runs and recovery

Use the run controller for ticket transitions and an independent supervisor for unexpected orchestrator stops. They add lifecycle enforcement around `/implement`; they do not replace Herdr or decide whether evidence is sufficient to merge.

## Start a supervised run

1. Keep run files in a durable, private, untracked directory outside the checkout. The directory must already exist. It contains the definition, state journal, transport config, adapters and supervisor log. Put its absolute path in the run brief and owner report. Do not use ephemeral scratch for recovery state.
2. Write a definition with a run `id`, positive `concurrency`, explicit boolean `mergeAuthority`, positive `maxRecoveries`, and `tickets`. Each ticket has `id`, `blockers` (ticket IDs) and `modules` (shared resource labels). Authority applies only to this run; never copy an old approval into a new definition. Include known work conflicts, not merely identical filenames.
3. Initialize: `node <orchestrate>/scripts/run.ts init --state <state.json> < <definition.json>`. The run starts paused. Show the plan and wait for the existing owner start gate.
4. After approval, submit `start` with the owner's recorded reason. Launch the supervisor as an independent long-lived process in its own Herdr pane, using the Herdr skill. It must not be an agent-owned background tool that dies when the agent turn ends. Keep that pane open until the run finishes.
5. Read `show` before every scheduling decision. Dispatch only tickets whose `frontier` entry has no reasons. Persist `dispatch` before spawning; an interrupted spawn needs inspection, not another blind dispatch. Include the resulting ticket attempt and state path in the executor brief. Use Herdr for all pane control.

Minimal definition (resource labels are chosen by the target project):

```json
{
  "id": "feature-run", "concurrency": 2, "mergeAuthority": false, "maxRecoveries": 3,
  "tickets": [
    { "id": "A", "blockers": [], "modules": ["shared-api"] },
    { "id": "B", "blockers": ["A"], "modules": ["shared-api"] }
  ]
}
```

## Controller protocol

`run.ts show --state <state.json>` returns state, revision and computed frontier. `run.ts event --state <state.json>` accepts JSON on stdin:

```json
{"revision": 0, "event": {"type": "start", "reason": "Owner approved this run"}}
```

Use the current revision; on a conflict, read again and reconsider the event rather than blindly retrying it. Events are appended inside one atomic JSON journal; history is replayed and validated on each read. Treat this as a local single-host store, not a distributed database or tamper-proof audit log.

| Event | Additional fields | Contract |
| --- | --- | --- |
| `start` | `reason` | Owner-approved start/resume from paused, waiting-owner or attention; recovery ambiguity must be reconciled first. |
| `pause`, `wait-owner` | `reason` | Suppress dispatch, merge authorization and automated recovery. Persist before waiting for an owner answer. |
| `wait-workers` | `reason` | Intentionally wait for an existing worker. Persist before ending the turn. |
| `wake` | `reason` | Return from worker wait after inspecting the result. |
| `dispatch` | `ticket` | Check dependencies, concurrency and module conflicts; reserve a new attempt before spawning. |
| `block` | `ticket`, `attempt`, `reason` | Record blocked work. It retains its slot/resource reservation until reworked or merged. |
| `rework` | `ticket`, `attempt`, `reason` | Return blocked/review work to running with a new attempt; invalidate old head evidence. |
| `ready` | `ticket`, `attempt`, `head`, `pr` | Record the full 40-character head SHA only after executor checks pass. |
| `authorize-merge` | `ticket`, `attempt`, `head`, `evidence` | Active run with authority; exact reviewed head; only one outstanding merge. |
| `merged` | `ticket`, `attempt`, `head`, `pr`, `evidence` | Record GitHub readback matching the authorized PR/head; unlock dependencies. |
| `merge-not-applied` | `ticket`, `attempt`, `evidence` | Readback confirms the PR remains open; release outstanding authorization before rework/retry. |
| `attention` | `reason` | Stop autonomous progress for reconciliation. |
| `reconcile-recovery` | `token`, `outcome`, `reason` | After transport inspection, resolve pending delivery as delivered/not-delivered. Leaves run paused for explicit resume. |
| `finish` | — | All tickets must be merged. Supervisor exits on its next poll. |

`recover` and `recovery-result` are supervisor events. They reserve a unique delivery token and consume a recovery attempt before any external call. The budget is cumulative for the run, not reset by a successful send or supervisor restart.

### Results, heads and merges

Keep the existing worker/reviewer result-line formats. They are wakeup hints, not sufficient proof for a `ready` event. The orchestrator must correlate the assigned pane/session and attempt and inspect the actual PR head and evidence. It must not relabel an old line with the current attempt.

Use the existing ready/merge scripts and review requirements before recording readiness/authorization. The controller validates state and references, not the truth of external evidence. Run `gh pr merge` with the authorized head match through the existing workflow. An interrupted merge stays `merge-authorized`: query GitHub and record `merged` or `merge-not-applied` before doing anything else to that ticket. Changed heads require rework and new verification.

Observations such as `ready` and `merged` may be recorded while paused; they never grant new authority. A pause cannot undo an external operation already in flight.

## Supervisor transport

Launch `node <orchestrate>/scripts/supervisor.ts --state <state.json> --config <transport.json>`. `--once` performs one observation/policy tick; it is a diagnostic, not an immediate recovery override. Keep stdout as the supervisor log.

Configuration:

```json
{
  "target": "exact-orchestrator-pane-id",
  "observe": ["node", "/absolute/run/observe.ts"],
  "resume": ["node", "/absolute/run/resume.ts"],
  "pollMs": 30000, "graceMs": 60000, "cooldownMs": 120000, "timeoutMs": 30000
}
```

Transport adapters are run-local executables, not shell strings. Build them using the installed Herdr skill and live CLI discovery inside a Herdr-managed session; this package does not duplicate Herdr's changing CLI. Do not activate recovery until the adapter contract has been checked on the actual target. Use absolute executable paths when PATH differs between panes.

**Observe adapter:** receives `{target, run}` on stdin. Return exactly one JSON object `{target, status, workerEvent}`. Status is `working`, `idle`, `done`, `missing`, `blocked`, or `unknown`. Identity must match. `workerEvent` means a newly relevant worker result or unexpected worker stop requires orchestrator attention; it is not simply “a worker exists”. Inspect the workers assigned by the run brief. A failed API read is an error/unknown, never evidence of `missing`.

**Resume adapter:** receives `{target, token, statePath, revision, run, observation, instruction}`. Before sending, reload run state, confirm this pending token and active/worker-wait mode, and re-inspect the exact target. If it is already working or the owner paused, return `not-delivered`. Otherwise resume the existing agent or relaunch the confirmed stopped agent using the saved run brief. Do not kill a working agent. The prompt must require pane/PR reconciliation before work and preserve run authority. Confirm the prompt was accepted; an unconfirmed send is `uncertain`, not a retry opportunity. Persist/recognize tokens if the transport has its own retry behavior.

Return `{ "outcome": "delivered" }`, `not-delivered` (proof no input was sent), or `uncertain`. Nonzero exit, malformed output and timeout are uncertain. Adapter stdout is protocol-only; stderr is drained but intentionally not copied into run state. Hooks must not leave detached mutating children after timeout: the supervisor can bound the direct hook process, not arbitrary descendants.

### Recovery policy

- Paused, waiting-owner, attention and finished runs never trigger recovery.
- Working agents are observed, never interrupted for being slow. Detecting a falsely working/hung agent requires transport-specific evidence and operator review.
- Idle/done active agents recover only after a stable grace period. Worker waits remain idle until a worker event, unless the orchestrator process is positively missing.
- Unknown/blocked status requires attention. Failed observations are logged and retried without sending input.
- Definite non-delivery or a delivered prompt that leaves the agent stopped can retry after cooldown, within the durable budget. Exhaustion leaves `attention`.
- An interrupted pending recovery or uncertain delivery leaves `attention` until explicit reconciliation. No blind replay.

## Restart and locks

Run files are private (0600), atomically replaced and fsynced. Short writer locks serialize journal changes; a separate supervisor lock excludes duplicate supervisors. Lock ownership is recorded. Graceful SIGINT/SIGTERM releases the supervisor lock after the current bounded hook/poll finishes.

After SIGKILL or host failure, a lock can remain. Inspect its `owner.json`, the actual process and any transport operation; only after confirming the old writer/supervisor is stopped, remove that specific lock directory. Never steal a lock on age alone. Restart the supervisor with the same state/config; reconcile any pending recovery before owner-approved resume. Host-reboot service installation and automatic supervisor replacement are outside this change.

## Validation boundary

Automated tests exercise real independent processes, kill a fixture orchestrator, and verify recovery, pause/wait policy, retry exhaustion and uncertain delivery. The fixture is not a Herdr adapter. Live Herdr discovery, prompt readback and pane-relaunch behavior must be validated in a managed Herdr session before production use.
