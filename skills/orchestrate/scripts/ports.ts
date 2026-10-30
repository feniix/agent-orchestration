#!/usr/bin/env node
// Finds free port blocks, one per executor. Runs on Node 24.2+ or Bun, no dependencies.
//
//   ports.ts --vars A_PORT,B_PORT --base 8000,9000 --count 3 [--step 100]
//
// Prints a JSON array with one { VAR: port } object per block, each block fully free on loopback.

import { createServer } from "node:net";
import { parseArgs } from "node:util";

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      vars: { type: "string", default: "" },
      base: { type: "string", default: "" },
      count: { type: "string", default: "1" },
      step: { type: "string", default: "100" },
    },
  });
  const vars = values.vars.split(",").filter(Boolean);
  const base = values.base.split(",").filter(Boolean).map(Number);
  if (vars.length === 0 || vars.length !== base.length) {
    console.error("--vars and --base need the same number of entries");
    process.exit(2);
  }
  const blocks: Record<string, number>[] = [];
  for (let offset = 0; blocks.length < Number(values.count); offset += Number(values.step)) {
    const ports = base.map((port) => port + offset);
    if (Math.max(...ports) > 65535) {
      console.error(`only ${blocks.length} free blocks found`);
      process.exit(1);
    }
    const free = await Promise.all(ports.map(isFree));
    if (free.every(Boolean)) {
      blocks.push(Object.fromEntries(vars.map((name, index) => [name, ports[index] as number])));
    }
  }
  console.log(JSON.stringify(blocks));
}
