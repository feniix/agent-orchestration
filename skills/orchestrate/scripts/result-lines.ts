#!/usr/bin/env node
// Reports result lines that are new in a pane's text. Runs on Node 24.2+ or Bun, no dependencies.
//
//   <pane text> | result-lines.ts --pane <name> --state <file>
//
// Prints a JSON array of new lines. The first read of a pane records its scrollback as the
// baseline and prints [], which is what stops old result lines from firing.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

// Exact results only, so a brief or template echoed into a pane stays silent.
const RESULT_LINE =
  /^[^\w`]*((?:WORKER RESULT: (?:PR #\d+ ready at [0-9a-f]+|BLOCKED — \S.*))|(?:REVIEW RESULT: PR #\d+ — \S.*))$/;

export function resultLines(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    const match = RESULT_LINE.exec(line.trimEnd());
    return match?.[1] ? [match[1]] : [];
  });
}

export type Counts = Record<string, number>;

// Counts each line so a repeated identical result still fires, and a cleared pane starts over.
export function diff(previous: Counts | undefined, text: string): { counts: Counts; fresh: string[] } {
  const counts: Counts = {};
  for (const line of resultLines(text)) counts[line] = (counts[line] ?? 0) + 1;
  const fresh = previous
    ? Object.keys(counts).filter((line) => (counts[line] ?? 0) > (previous[line] ?? 0))
    : [];
  return { counts, fresh };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { pane: { type: "string" }, state: { type: "string" } },
  });
  const { pane, state } = values;
  if (!pane || !state) {
    console.error("usage: result-lines.ts --pane <name> --state <file>");
    process.exit(2);
  }
  const panes: Record<string, Counts> = existsSync(state)
    ? JSON.parse(readFileSync(state, "utf8"))
    : {};
  const { counts, fresh } = diff(panes[pane], readFileSync(0, "utf8"));
  panes[pane] = counts;
  writeFileSync(state, JSON.stringify(panes));
  console.log(JSON.stringify(fresh));
}
