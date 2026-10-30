// Run with: node --test <this file>
import assert from "node:assert/strict";
import { test } from "node:test";
import { diff, resultLines } from "./result-lines.ts";

const line = "WORKER RESULT: PR #1 ready at aaaaaaa";

test("matches exact results and skips quoted templates", () => {
  const text = [
    "⏺ WORKER RESULT: PR #12 ready at abc1234",
    "WORKER RESULT: BLOCKED — no shippable choice",
    "REVIEW RESULT: PR #12 — no blocking findings",
    "- `WORKER RESULT: PR #<n> ready at <short-sha>`",
    "WORKER RESULT: PR #<n> ready at <short-sha>",
    "the WORKER RESULT: PR #12 ready at abc1234 line",
  ].join("\n");
  assert.deepEqual(resultLines(text), [
    "WORKER RESULT: PR #12 ready at abc1234",
    "WORKER RESULT: BLOCKED — no shippable choice",
    "REVIEW RESULT: PR #12 — no blocking findings",
  ]);
});

test("the first read is a baseline and later lines fire", () => {
  const first = diff(undefined, line);
  assert.deepEqual(first.fresh, []);
  assert.deepEqual(diff(first.counts, line).fresh, []);
  const next = "WORKER RESULT: PR #1 ready at bbbbbbb";
  assert.deepEqual(diff(first.counts, `${line}\n${next}`).fresh, [next]);
});

test("a repeated identical line fires", () => {
  const first = diff(undefined, line);
  assert.deepEqual(diff(first.counts, `${line}\n${line}`).fresh, [line]);
});

test("a cleared pane fires on its next result line", () => {
  const first = diff(undefined, line);
  const cleared = diff(first.counts, "");
  assert.deepEqual(cleared.fresh, []);
  assert.deepEqual(diff(cleared.counts, line).fresh, [line]);
});
