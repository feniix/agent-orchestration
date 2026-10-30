#!/usr/bin/env node
// Marks a draft PR ready only when its evidence is for the local, clean head. Runs on Node 24.2+
// or Bun, needs gh and git.
//
//   pr-ready.ts --pr <n>
//
// Exits 0 once the PR is ready and 1 with the reasons otherwise.

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

// Hex tokens of 7+ characters are commit candidates, so full and short SHAs match each other.
function namesCommit(body: string, sha: string): boolean {
  const tokens = body.toLowerCase().match(/\b[0-9a-f]{7,40}\b/g) ?? [];
  return tokens.some((token) => sha.toLowerCase().startsWith(token));
}

// Unfilled tokens only, since evidence can legitimately show commands with angle-bracket arguments.
const PLACEHOLDER = /\b(?:TBD|TODO|PENDING)\b|<(?:short-)?sha>|__[A-Z][A-Z_]*__/;

export function bodyProblems(body: string, head: string): string[] {
  const problems: string[] = [];
  if (!namesCommit(body, head)) problems.push(`body does not name head ${head.slice(0, 7)}`);
  const placeholder = PLACEHOLDER.exec(body)?.[0];
  if (placeholder) problems.push(`body still has placeholder ${placeholder}`);
  return problems;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { pr: { type: "string" } } });
  if (!values.pr) {
    console.error("usage: pr-ready.ts --pr <n>");
    process.exit(2);
  }
  const pr: { headRefOid: string; body: string } = JSON.parse(
    execFileSync("gh", ["pr", "view", values.pr, "--json", "headRefOid,body"], {
      encoding: "utf8",
    }),
  );
  const head = git("rev-parse", "HEAD");
  const problems = bodyProblems(pr.body, pr.headRefOid);
  if (head !== pr.headRefOid) problems.push(`local ${head} differs from PR ${pr.headRefOid}`);
  if (git("status", "--porcelain")) problems.push("worktree has uncommitted changes");
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  execFileSync("gh", ["pr", "ready", values.pr], { stdio: "inherit" });
}
