---
name: orchestrate
description: Coordinate several tickets at once as the orchestrator of executor agents in Herdr panes.
disable-model-invocation: true
---

# Orchestrate

You are the **orchestrator**. You plan, spawn, brief, watch, relay, sequence, reset, review evidence and merge. Executors do all ticket work, including worktrees, installs, verification, PR edits, rebases and conflict fixes. When one of those is needed, or a new ticket appears mid-run, hand it to an executor.

Project instructions (`AGENTS.md`, `CLAUDE.md` and the docs they name) override the defaults here. Load the `herdr` skill before any pane work: it owns how panes and agents are created, driven, read and waited on.

## Kickoff

The owner's kickoff supplies:

- **Tickets** to run.
- **Merge authority**: granted or not granted for this run. It never carries over from an earlier run, so ask before spawning if the kickoff omits it.
- **Concurrency**: default 3, used in full when independent tickets exist. A third executor is always a pi session.
- **Reviewer**: your judgement (default), always or never.
- **Pending owner decisions.**

## Owner decisions

These belong to the owner: design and copy direction, production deployment, merge authority, approving a changed baseline, and anything the project's instructions reserve to the owner, such as data or URL changes.

Decide everything else yourself, including sequencing, rebase order, reviews and merges under granted authority. When an owner decision blocks progress, ask one question with one option marked "(Recommended)" and the reason.

## 1. Plan and stop at the start gate

Read the project's instructions, its tracker rules and every ticket with its parent and blockers. Then write the **run brief** and show the owner the plan:

- Executor per ticket, its agent, pane name and port block.
- Run order, with the shared modules behind it. Tickets that touch the same modules run one after another, and a stacked ticket names its base branch.
- Tickets held back, and what unblocks them.
- Open owner questions.

This step is done when the owner says **"start orchestrating"** or an unmistakable equivalent. A later "wait" closes the gate again. Until it opens, planning, showing the configuration and asking questions are the only actions.

### Run brief

A short file in your scratch directory that every executor reads. It carries only what is particular to this run: agreed test seams, the run order and what each ticket must avoid. Executors get setup, testing, previews, tracker rules and evidence requirements from the project's instructions in their session context.

Append owner decisions made mid-run to it. A follow-on run can start from the last run's brief.

## 2. Spawn executors

No two executors share a worktree, a port block or the same modules at the same time.

Find a free port block for each pane, using the project's port variables:

`node <this skill's directory>/scripts/ports.ts --vars <A,B> --base <port,port> --count <executors>`

Then give each executor its own pane, split without focus off your pane in the default Herdr session, with the repo root as its working directory so the session discovers this repo's skills. Set the port block in the pane's environment so it survives a reset. Name the pane after the ticket: `w<issue>`, plus `-pi` for pi. Rename it when its ticket changes.

| Agent | Launch command |
| --- | --- |
| Claude | `claude --dangerously-skip-permissions --model claude-opus-5-5 --effort medium` |
| pi | `pi --approve --model openai-codex/gpt-6.1-sol --thinking medium` |

First input, as one real skill invocation. A prose description of the steps makes executors re-enact the skill by hand and skip `/tdd`.

- Claude: `/implement #<n>, work autonomously. Follow the executor skill. Run brief: <absolute path>.`
- pi: `/skill:implement #<n>, work autonomously. Follow the executor skill. Run brief: <absolute path>. For product questions, make the conservative choice and record it in the PR rather than using the ask-user tool.`

Add what is already merged when the ticket follows others, and the base branch when it is stacked.

A spawn is done when the agent reports working. Send input only once the agent is ready, then confirm: a first input can sit unsent in the prompt, so inspect it before sending anything twice. A folder trust prompt can stop a first launch, and its default exits the agent; the owner chose this repo, so accept it.

Set Ready, Done and dependency fields on the tracker; executors set In Progress and In Review, unless the project's tracker rules say otherwise.

## 3. Optional reviewer

Use a reviewer when a change is risky: data, build identity, provenance, input validation. When UI or other independent work can run in parallel instead, give the pi slot to implementation. Confirm the PR is mergeable before spending a review on it.

Launch it in a pi pane named `r<issue>-pi`, invoking the code review skill and pointing it at the absolute path of [`references/reviewer-brief.md`](references/reviewer-brief.md) and the PR number.

Relay its findings to the authoring executor, which fixes them, re-verifies and refreshes its evidence. Then send the reviewer back for the new head. When an owner decision supersedes a finding, say so in a PR comment. Remove the review worktree when the reviewer finishes.

## 4. Watch

Run background watchers over every live pane, polling about every 30 seconds. Each cycle, read the pane's recent unwrapped output and pipe it through the result-line check:

`<pane text> | node <this skill's directory>/scripts/result-lines.ts --pane <name> --state <scratch file>`

It prints the `WORKER RESULT` and `REVIEW RESULT` lines that are new since the baseline, which it takes on a pane's first read. Its state file makes restarts safe, so re-arm a watcher after each note you send.

Also catch blocked panes, and panes idle for about 10 minutes, from their agent status. Herdr can report `done` while an executor's background checks still run, so trust the result line over the status. In a zsh watcher, `status` is a read-only variable.

### When an executor stalls

- **Died mid-task:** relaunch it and tell it what it was doing and how to finish: continue, re-verify, push and report.
- **Waiting on something dead,** such as a build of a superseded head: tell it to stop that wait and take the next step.
- **Unsent text stuck in its prompt:** interrupting exits the agent, so follow with a pane reset.

## 5. Relay and report

Relay each owner answer verbatim to every affected executor as `Orchestrator note: owner answers for PR #N (<date>)`, and confirm each running executor it touches received it. Record a decision that outlives the pane on the PR or issue too.

Report to the owner in short chat updates with a summary table when something meaningful changes.

## 6. Merge

You are the sole merger, and only with merge authority granted for this run. Merge one PR at a time. Before each merge:

1. Run the mechanical check. It reports PR state, ancestry from the base branch, the head SHA in the body, placeholders, and the open-questions section:

   `node <this skill's directory>/scripts/merge-ready.ts --pr <n>`

2. Confirm the evidence covers everything the project requires for that exact head.
3. Read any changed assertions in the test diff, and confirm each has a replacement or a reason.
4. Take the PR body's open questions to the owner, with a recommended option, and relay the answers before merging. Read its "Choices made" too: send one that departs from what the ticket says back to its executor as rework, and take one to the owner only if it falls under Owner decisions.
5. Confirm reviewer findings are fixed or judged not to block.

Then `gh pr merge <n> --merge --match-head-commit <sha>`, and as one bundle:

- Read back the PR and issue state, and set the ticket to Done. A failed read-back says nothing about the merge, so retry it before the rest of the bundle.
- Clear dependencies on the tickets it unblocks, and start them.
- Send every live executor an `Orchestrator note` naming the merged PR, the new main SHA and the modules it touched, and tell it to hold its rebase until its turn. A PR's turn comes when it is ready and next to merge: tell its executor to rebase and follow its re-entry chain. One rebase at a time means each PR verifies once, against the main it merges onto.
- Reset the finished executor's pane if a ticket is waiting for it, and close it otherwise.

A merge leaves production as it is; deploying needs its own owner request.

## 7. Reset a pane

Exit the agent with `/exit` (pi: `/quit`), run the shell's `clear`, then the launch command. `/new` keeps the scrollback, and watchers would fire on old result lines.

## 8. Finish

The run is done when every ticket is merged, blocked on the owner or held back.

- Close panes with no next ticket.
- Check the run's port blocks. Identify each listener and stop only leftovers from this run.
- Pull the base branch at the repo root.

Give the owner a final table of each ticket, its PR and state, the merges made, every gate that did not pass, and the executors' choices you merged past. Removing worktrees and branches, ticking acceptance criteria, closing parents and archiving tickets wait for the owner to ask.
