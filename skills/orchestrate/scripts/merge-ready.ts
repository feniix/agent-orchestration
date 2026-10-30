#!/usr/bin/env node
// Mechanical pre-merge check for one PR. Runs on Node 24.2+ or Bun, needs gh and git.
//
//   merge-ready.ts --pr <n>
//
// Prints JSON with each check and the open-questions section, for the orchestrator to read.
// Exits 0 when every check passes and 1 otherwise. It never merges.

import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { bodyProblems } from "../../executor/scripts/pr-ready.ts";

export type PullRequest = {
  state: string;
  isDraft: boolean;
  mergeStateStatus: string;
  headRefOid: string;
  baseRefName: string;
  body: string;
};

export type Check = { name: string; pass: boolean; detail: string };

export function evaluate(pr: PullRequest, containsBase: boolean): Check[] {
  const problems = bodyProblems(pr.body, pr.headRefOid);
  return [
    { name: "open", pass: pr.state === "OPEN", detail: pr.state },
    { name: "ready", pass: !pr.isDraft, detail: pr.isDraft ? "draft" : "ready" },
    {
      name: "mergeable",
      pass: pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "HAS_HOOKS",
      detail: pr.mergeStateStatus,
    },
    {
      name: "on latest base",
      pass: containsBase,
      detail: containsBase ? pr.baseRefName : `head lacks latest ${pr.baseRefName}`,
    },
    { name: "evidence", pass: problems.length === 0, detail: problems.join("; ") || "body ok" },
  ];
}

// The section under the first heading naming open questions, up to the next heading of any level.
export function openQuestions(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^#+ .*open questions/i.test(line));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#+ /.test(line));
  return rest
    .slice(0, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { pr: { type: "string" } } });
  if (!values.pr) {
    console.error("usage: merge-ready.ts --pr <n>");
    process.exit(2);
  }
  const fields = "state,isDraft,mergeStateStatus,headRefOid,baseRefName,body";
  const pr: PullRequest = JSON.parse(
    execFileSync("gh", ["pr", "view", values.pr, "--json", fields], { encoding: "utf8" }),
  );
  execFileSync(
    "git",
    ["fetch", "--quiet", "origin", pr.baseRefName, `refs/pull/${values.pr}/head`],
    { stdio: "inherit" },
  );
  const containsBase =
    spawnSync("git", [
      "merge-base",
      "--is-ancestor",
      `origin/${pr.baseRefName}`,
      pr.headRefOid,
    ]).status === 0;
  const checks = evaluate(pr, containsBase);
  const ready = checks.every((check) => check.pass);
  console.log(
    JSON.stringify(
      { ready, head: pr.headRefOid, checks, openQuestions: openQuestions(pr.body) },
      null,
      2,
    ),
  );
  process.exit(ready ? 0 : 1);
}
