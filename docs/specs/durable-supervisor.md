## Problem Statement

An orchestrator provider error can leave its pane idle with nothing to wake it. Pane idle/done alone cannot distinguish a failure from intentionally waiting for the owner. Ticket state and recovery intent currently live mainly in agent context.

## Solution

Add a durable run controller and an independent polling supervisor. The controller validates dependency and lifecycle transitions; the supervisor observes the orchestrator through configured transport adapters and resumes unexpected stops with a bounded recovery budget. Preserve Herdr as the pane transport and the orchestrator as the sole merge decision-maker.

## User Stories

1. As an owner, I want runs to remain paused until I authorize start.
2. As an owner, I want explicit waiting-for-owner state so idle detection cannot resume past my decision.
3. As an orchestrator, I want dependencies and module conflicts checked before dispatch.
4. As an orchestrator, I want attempt IDs so old worker results cannot advance new work.
5. As an owner, I want state and history to survive process restarts.
6. As an orchestrator, I want evidence associated with the exact PR head and invalidated by rework.
7. As an owner, I want independent monitoring to resume an unexpectedly stopped orchestrator.
8. As an owner, I want intentional worker waits distinguished from crashes.
9. As an owner, I want recovery retries bounded and observable.
10. As an owner, I want ambiguous delivery or interrupted recovery to stop for reconciliation rather than repeat external actions.
11. As an orchestrator, I want a confirmed merge before dependencies unlock.
12. As an operator, I want a repeatable local crash-recovery test without production side effects.

## Implementation Decisions

- Dependency-free, erasable TypeScript on Node 24; local versioned JSON state and transition history committed atomically under a writer lock.
- Validate ticket graphs, explicit run modes, concurrency, declared module conflicts, revision and attempt IDs.
- Exact-head readiness and merge authorization; merge readback is an explicit observation, never inferred from command success.
- Independent supervisor process with single-instance lock, configurable polling/grace/cooldown, finite recovery budget, and structured JSON observation/recovery hooks executed as argv without shell interpolation.
- Transport hooks own Herdr syntax and verify target identity. Supervisor owns policy. No pane control from outside a Herdr-managed session.
- Persist a recovery intent before sending. An uncertain send or interrupted in-flight recovery requires reconciliation, not blind replay.
- Pauses suppress new dispatch and recovery while permitting observations of work already in progress. No automatic merge authority or deployment.
- Agent skill documentation points to one run-controller reference; existing executor result-line contracts remain compatible.

## Testing Decisions

Exercise the CLI in temporary directories, plus pure transition/policy tests following existing node:test conventions. Validate DAG rejection, dependency frontiers, module conflicts, transitions, stale revisions/results, restart persistence, owner pauses, worker waits, retry exhaustion, ambiguous recovery and simultaneous writers/supervisors. Use fake transport executables to exercise actual supervisor processes, including killing/restarting an orchestrator fixture. Run all existing script tests.

## Out of Scope

Graph databases, general-purpose workflow frameworks, rewriting /implement, automatic deployment, autonomous merging, host-reboot service installation and killing healthy agents.

## Further Notes

Approved by Seb in Discord on 2026-11-04 after requesting recovery rather than state persistence alone. Continue through branch, implementation, tests and PR. Do not merge or deploy. Live Herdr validation requires a Herdr-managed environment; report separately from fixture validation.

## Definition of Done

- [ ] Controller and independent supervisor implemented.
- [ ] Crash/idle recovery and pause boundaries validated with executable fixtures.
- [ ] Existing tests pass; documentation describes adapter setup and recovery boundaries.
- [ ] PR includes spec, validation evidence and remaining live-environment gaps.

