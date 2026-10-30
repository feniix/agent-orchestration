# Agent Orchestration

Development home of the `orchestrate` and `executor` skills, which run several tickets at once with agents in Herdr panes. Orchestrations themselves run in target projects.

`session-mining/` is a one-off review of one project's Claude sessions, kept as a record and excluded from installs.

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
- **Evals:** none yet. Keep `skill-creator` workspaces outside `skills/`, so they never install as skills.
- **Real runs:** none yet, and only a real run exercises spawning, watching and merging. Also unexercised: `merge-ready.ts` on an open PR, and the `gh pr ready` step in `pr-ready.ts`, which needs a throwaway draft PR because it changes the PR.

## Using the skills

Neither is installed yet, so sessions cannot load them from here. Once installed, the owner runs `/orchestrate` in a target project; the Kickoff section of `orchestrate/SKILL.md` lists what it needs.
