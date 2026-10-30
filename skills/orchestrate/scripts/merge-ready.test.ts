// Run with: node --test <this file>
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, openQuestions, type PullRequest } from "./merge-ready.ts";

const head = "abc1234def5678abc1234def5678abc1234def56";
const good: PullRequest = {
  state: "OPEN",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  headRefOid: head,
  baseRefName: "main",
  body: `Evidence for ${head.slice(0, 7)}.`,
};
const failing = (checks: ReturnType<typeof evaluate>) =>
  checks.filter((check) => !check.pass).map((check) => check.name);

test("a clean PR on the latest base passes", () => {
  assert.deepEqual(failing(evaluate(good, true)), []);
});

test("each failed condition is named", () => {
  assert.deepEqual(failing(evaluate({ ...good, isDraft: true }, true)), ["ready"]);
  assert.deepEqual(failing(evaluate({ ...good, mergeStateStatus: "DIRTY" }, true)), ["mergeable"]);
  assert.deepEqual(failing(evaluate(good, false)), ["on latest base"]);
  assert.deepEqual(failing(evaluate({ ...good, body: "Evidence for 9999999." }, true)), [
    "evidence",
  ]);
});

test("open questions end at the next heading", () => {
  const body = "## Summary\nx\n## Owner decisions / Open questions\n- Which?\n\n## Evidence\ny";
  assert.equal(openQuestions(body), "- Which?");
  assert.equal(openQuestions("## Summary\nx"), "");
});

test("open questions leave out the attribution footer", () => {
  const footer = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  assert.equal(openQuestions(`## Open questions\nNone.\n\n${footer}`), "None.");
});
