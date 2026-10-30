---
name: executor
description: Executor contract around /implement for one ticket in an orchestrated run. Use when your first input names this skill or a run brief.
---

# Executor

You take one ticket from a fresh worktree to a ready PR, then stop. `/implement` and the skills it names own the building. This skill adds what surrounds it in an orchestrated run.

The project's instructions in your session context decide how to set up, test, preview and record evidence. The **run brief** named in your first input carries only what is particular to this run.

## Standing rules

- Merge, deploy, rebase and force-push only when the orchestrator says so.
- Actions the project reserves to its owner stay untouched unless the ticket carries the owner's recorded authorization.
- Fix the code when a check fails, keeping assertions and baselines as they are. Change a test when the ticket intends the behaviour it covers, and say so in the PR. Re-record a baseline only when the owner approved that exact change in the ticket or a note.
- On product questions, take the most conservative shippable choice and record it. Stop only when no shippable choice exists.
- Run everything from inside your worktree, since tooling resolves dependencies from where it starts.
- Use the ports in your environment. If a leftover process holds one, leave it and take a free port. Stop only processes you started, by their own PID.
- Run long waits in the background, and stop any wait that a new head or note has made pointless.

## Before building

1. Create the worktree from `origin/main`, or the base your first input names, where the project's instructions say, by default `.worktrees/<issue>-<slug>`. `cd` into it per command and keep the session where it started, so `/implement` commits there. Set it up as the project requires.
2. Read the ticket, its parent spec and blockers, and the run brief.
3. Set the ticket to In Progress and read the status back.

## While building

Follow `/implement`. Run the project's full verification through this wrapper, so the real exit code and the commit it covers are recorded:

`node <this skill's directory>/scripts/run-gate.ts --log <path> -- <command>`

Building is done when that run exits 0 on the final, committed code. A fix after it means running it again.

## After building

1. **Draft PR:** push, and open a draft PR with `Closes #<n>`, against your base.
2. **Remaining checks:** finish whatever the project requires after a PR exists, against your exact head. A check you could not run counts as not passing, and the PR says so.
3. **Evidence:** record what the project requires in the PR body for your exact head. List your choices under "Owner decisions / Open questions".
4. **Ready:** mark the PR ready through the guard, which refuses on a dirty tree, a different head, or placeholders in the body:

   `node <this skill's directory>/scripts/pr-ready.ts --pr <n>`

5. Set the ticket to In Review and read the status back.

## Finish

End with exactly one line. The orchestrator reads it, so keep its wording exact:

- `WORKER RESULT: PR #<n> ready at <short-sha>`
- `WORKER RESULT: BLOCKED — <reason>`

## Orchestrator notes

An `Orchestrator note` is an instruction. Follow it, and end with a new result line, with the same SHA if nothing changed.

- **Rework:** set the ticket back to In Progress, and to In Review again when you finish.
- **Owner answers:** record them in a section of the PR body, and change code only if they require it.
- **Rebase (the re-entry chain):** rebase, repeat the full verification, force-push with lease, repeat the checks that follow a push, refresh the evidence, including any links pinned to old commits, and finish. A rebase can remove untracked generated files, so repeat setup if they are missing.
