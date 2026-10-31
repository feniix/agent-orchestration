# Agent Orchestration

Development home of the `orchestrate` and `executor` skills, which run several tickets at once with agents in Herdr panes. Orchestrations themselves run in target projects.

`docs/handoffs/session-mining/` is a one-off review of one project's Claude sessions, kept as a record and excluded from installs.

## Changing a skill

1. Load `writing-for-agents`, plus `skill-creator` for a new skill, evals or a description change.
2. Tie the change to an observed source: an owner correction or a real run's transcript.
3. Check every changed line against the design rules, and update every contract the change touches.
4. The change is done when `node --test skills/*/scripts/*.test.ts` passes and each gap below that it affects is reported.

## Design rules

- **Generic:** the target project's instructions, in the session's context, supply setup, testing, previews, evidence and tracker rules. Skills and run briefs name no project commands, ports or URLs, even as examples.
- **Delegating:** `herdr` owns pane commands, and `/implement` and the skills it names own building. These skills carry only what surrounds that work, leaving out the owning skill's CLI syntax and steps.
- **Invocation:** `/implement` sets `disable-model-invocation`, so it only works as an agent's literal first input. `orchestrate` therefore sends it first, and `executor` keeps a description the model can reach. `orchestrate` is owner-invoked because it spawns agents and merges.
- **Scripts:** deterministic logic goes in dependency-free TypeScript with erasable syntax, an `import.meta.main` guard and `node:test` coverage of pure functions. Merge decisions stay with the orchestrator, which reads the script's report.
- **Guards:** run text-matching guards against real data first. The placeholder pattern in `pr-ready.ts` once flagged 20 of 40 real merged PR bodies for a legitimate `<preview>`.

## Contracts

Each pair changes in the same edit:

- **Result lines:** `executor/SKILL.md` and `orchestrate/references/reviewer-brief.md` match the pattern in `orchestrate/scripts/result-lines.ts` word for word, because watchers read them.
- **Open questions:** the heading named in `executor/SKILL.md` is the one `openQuestions` finds in `merge-ready.ts`.
- **Evidence guard:** `merge-ready.ts` imports `bodyProblems` from `executor/scripts/pr-ready.ts`, so the skills install side by side.

## Gaps

- **Typecheck:** unavailable, because there is no `package.json` or Node type definitions.
- **Evals:** no `skill-creator` evals yet, and the scenario runs below are not repeatable from this repo. Keep `skill-creator` workspaces outside `skills/`, so they never install as skills.
- **Real runs:** thirteen so far, all on small tickets in throwaway repos and each run once. They exercised spawning Claude and pi, watching, owner relay, rebasing with a real conflict, merging, the `gh pr ready` step, a killed executor, a killed orchestrator, tickets the PR widened, owner-only values, a baseline gate, stale evidence, the reviewer path and heavy evidence. Unexercised: a real codebase, a read-back retry, and reading a stopped pane right away, which was added after the run that needed it.
- **Unwatched stalls:** an orchestrator cut off by an API error shows the same `idle` status as one waiting for the owner, and nothing wakes it.
- **Repeated result lines:** a watcher can re-report an old result line, whose cause is unconfirmed. Orchestrators have discarded these by SHA so far, and only `merge-ready.ts` guards it.
- **Mixed agent rules:** the owner's pi instructions ban AI attribution trailers and Claude's do not, so a pi reviewer flags Claude executors' commits. This is undecided.

## Using the skills

Neither is installed at user level, because the install location is undecided. Sessions started in this repo load them through `.claude/skills` and `.agents/skills`, and a target project needs its own links to `skills/`, kept out of its commits by `.git/info/exclude`. The owner then runs `/orchestrate` there; the Kickoff section of `orchestrate/SKILL.md` lists what it needs.
