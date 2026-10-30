# Handoff: orchestrate and executor skills

Written 2026-10-30 at the end of a session started in `/Users/feniix/src/personal/nextsnowline`. Read `AGENTS.md` first: it holds the design rules, contracts and gaps, and this file holds only what it omits. Facts here are a record of that session, so check them against the files. Delete this file once its contents are settled.

## How the work got here

The owner asked for an orchestrator skill and an executor skill, generic and drafted at repo level in `nextsnowline`, based on `/Users/feniix/src/personal/nextsnowline/docs/owner/multi-agent-orchestration.md`. The drafts then moved here because they are project-agnostic, and in that repo they failed `tests/unit/workflows.test.ts:226` (a skills allowlist) and AGENTS.md's "no extra project skills" rule. That repo is clean again, with nothing committed.

At the time, this directory was not a git repository and nothing had been committed, installed or run for real. It is a repository now, and `AGENTS.md` tracks what has run.

## Owner's working rules

- Wait for an explicit order before implementing, committing, opening a PR, merging or deploying.
- Mark one option "(Recommended)" with the reason in every owner question.
- Load `writing-for-agents` before writing or revising a skill or an AGENTS.md.
- Add only what was asked for. The owner questioned `session-mining/` when it appeared unannounced, then renamed it from `research/`.

## Corrections that shaped the drafts

| Owner said | Result |
| --- | --- |
| Deterministic scripting is TypeScript | All scripts are `.ts` |
| Delegate to the `herdr` skill, no custom Herdr commands | Skill text has no pane commands; a planned `herdr.ts` wrapper was dropped |
| `/implement` and its skills do executor work; "we do not rewrite the skills on our own" | `executor` is a thin layer; an `execute-ticket` draft was deleted |
| `DEPLOYED_URL` and similar are project specific; agents figure out preview and test from session context | Preview and test specifics were removed from skills and run brief |

## Decisions where the drafts depart from the owner doc

These follow real sessions, which are newer than the doc. The owner has seen this list and raised no objection, but has not explicitly approved it.

- PRs open as drafts and go ready after evidence is recorded.
- Ports live in the pane's environment, so they survive a reset.
- Rebasing happens one PR at a time, when a PR is ready and next to merge. This replaced waiting for each executor's next stopping point, after the first real run.
- Reviewers use a detached checkout (`gh pr checkout <pr> --detach`) and re-review each new head.
- Each merge is followed by one bundle: read back state, set Done, unblock tickets, notify executors.
- Executors re-record a baseline only when the owner approved that exact change.

The older `docs/agents/prompts/coordinator-implement.md` in `nextsnowline` conflicts with the owner doc on start phrase, worktree ownership, per-merge approval and merge vs rebase. It was left alone.

Considered and left out: a third `WORKER RESULT` form, polling PR comment rows, and `wait-for-commit.ts`.

## Session review coverage

`docs/handoffs/session-mining/mine/report.txt` is the output, and `docs/handoffs/session-mining/mine.ts` hardcodes `nextsnowline` as its filter. Of 358 sessions it classified 5 orchestrator, 40 executor, 44 other, 123 memory and 146 subagent.

- Read closely: the 5 orchestrator sessions and part of the executor sessions.
- Lightly covered: the 44 other sessions, mostly by first message.
- Not read: memory and subagent sessions, and most raw executor transcripts from 2026-10-24 and 10-25.
- Not included: pi sessions, since the owner asked for Claude sessions.

## Open decisions for the owner

1. **Install location.** Recommended: `~/dotfiles/agents/skills`, symlinked into `~/.claude/skills`, `~/.agents/skills` and `~/.pi/agent/skills` as the owner's other generic skills are, because Claude and pi both load from there. The owner has not confirmed this, and it changes user-level setup.
2. **`executor/scripts/run-gate.ts`.** Kept for now: it names no test command and records the real exit code, since sessions showed pipes hiding failures. It does shape how agents run verification, so the owner may drop it.
3. **`docs/handoffs/session-mining/`.** The owner renamed and moved it but did not answer whether to keep it. Deleting it was recommended; it is kept until told otherwise, and regenerating it would need the script.

## Also here

- `/Users/feniix/src/personal/agent-skills/` exists and is empty; it was left alone.
- Memory notes from that session live under that project (`~/.claude/projects/-Users-feniix-src-personal-nextsnowline/memory/`, notably `feedback-skills-delegate.md`), so sessions here will not load them. The rules above carry what matters.
- Full transcript: `/Users/feniix/.claude/projects/-Users-feniix-src-personal-nextsnowline/2141f19f-ac94-4c53-a19b-475603ecc6bf.jsonl`
