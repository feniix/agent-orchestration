#!/usr/bin/env node
// Runs a command to a log and reports its real exit code and the commit it covered, which a pipe
// would hide. Runs on Node 24.2+ or Bun, no dependencies.
//
//   run-gate.ts --log <path> -- <command> [args...]
//
// Prints JSON { exit, signal, error, head, dirty, seconds, log } and exits with the command's own
// code. A command that cannot start exits 1, with the reason in both error and the log.

import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

function git(...args: string[]): string | null {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { log: { type: "string" } },
  });
  const [command, ...args] = positionals;
  if (!values.log || !command) {
    console.error("usage: run-gate.ts --log <path> -- <command> [args...]");
    process.exit(2);
  }
  const log = resolve(values.log);
  const fd = openSync(log, "w");
  const started = Date.now();
  const result = spawnSync(command, args, { stdio: ["ignore", fd, fd] });
  const error = result.error?.message ?? null;
  if (error) writeSync(fd, `${error}\n`);
  closeSync(fd);
  const exit = result.status ?? 1;
  console.log(
    JSON.stringify({
      exit,
      signal: result.signal,
      error,
      head: git("rev-parse", "HEAD"),
      dirty: Boolean(git("status", "--porcelain")),
      seconds: Math.round((Date.now() - started) / 1000),
      log,
    }),
  );
  process.exit(exit);
}
