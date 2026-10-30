// Run with: node --test <this file>
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bodyProblems } from "./pr-ready.ts";

const head = "abc1234def5678abc1234def5678abc1234def56";

test("the ready guard names missing heads and placeholders", () => {
  assert.deepEqual(bodyProblems(`Evidence at ${head}.`, head), []);
  assert.deepEqual(bodyProblems(`Evidence at ${head.slice(0, 7)}.`, head), []);
  assert.deepEqual(bodyProblems("Evidence at 9999999.", head), ["body does not name head abc1234"]);
  assert.deepEqual(bodyProblems(`${head} result: __PENDING_RESULT__`, head), [
    "body still has placeholder __PENDING_RESULT__",
  ]);
  assert.deepEqual(bodyProblems(`${head} result: TBD`, head), ["body still has placeholder TBD"]);
  assert.deepEqual(bodyProblems(`${head} \`check --url <url>\`: exit 0`, head), []);
  assert.deepEqual(bodyProblems(`${head} <details><summary>log</summary></details>`, head), []);
});

test("the gate wrapper logs output and passes on the real exit code", () => {
  const log = join(mkdtempSync(join(tmpdir(), "run-gate-")), "gate.log");
  const script = fileURLToPath(new URL("./run-gate.ts", import.meta.url));
  const failing = spawnSync(
    process.execPath,
    [script, "--log", log, "--", "sh", "-c", "echo out; echo err >&2; exit 3"],
    { encoding: "utf8" },
  );
  assert.equal(failing.status, 3);
  assert.equal(JSON.parse(failing.stdout).exit, 3);
  assert.equal(readFileSync(log, "utf8"), "out\nerr\n");

  const passing = spawnSync(process.execPath, [script, "--log", log, "--", "true"], {
    encoding: "utf8",
  });
  assert.equal(passing.status, 0);
  assert.equal(JSON.parse(passing.stdout).error, null);
});

test("the gate wrapper names a command that cannot start", () => {
  const log = join(mkdtempSync(join(tmpdir(), "run-gate-")), "gate.log");
  const script = fileURLToPath(new URL("./run-gate.ts", import.meta.url));
  const missing = spawnSync(process.execPath, [script, "--log", log, "--", "no-such-command-xyz"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stdout).error, /no-such-command-xyz/);
  assert.match(readFileSync(log, "utf8"), /no-such-command-xyz/);
});
