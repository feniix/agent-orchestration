// Classifies this project's Claude sessions and counts the operations each role performed.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const out = process.argv[2] as string;
const base = join(homedir(), ".claude/projects");

type Session = {
  file: string; cwd: string; first: string; role: string; start: string;
  errors: {cmd:string;err:string}[]; said: string[]; bash: string[]; skills: string[]; users: string[]; tools: Record<string, number>; subagent: boolean;
};

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.flatMap((b) => (b?.type === "text" ? [String(b.text)] : [])).join("\n");
  }
  return "";
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return name.endsWith(".jsonl") ? [path] : [];
  });
}

const sessions: Session[] = [];
for (const dir of readdirSync(base).filter((n) => n.includes("nextsnowline"))) {
  for (const file of walk(join(base, dir))) {
    const ids = new Map<string,string>();
    const s: Session = { file, cwd: "", first: "", role: "other", start: "", errors: [], said: [], bash: [], skills: [], users: [], tools: {}, subagent: file.includes("/subagents/") };
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      if (!raw) continue;
      let e: any;
      try { e = JSON.parse(raw); } catch { continue; }
      if (!s.cwd && e.cwd) s.cwd = e.cwd;
      if (!s.start && e.timestamp) s.start = e.timestamp;
      if (e.type === "user" && !e.isMeta) {
        const t = text(e.message?.content).trim();
        if (t && !/^<command-name>\/(clear|exit|compact|model|effort|login|resume)/.test(t) && !t.startsWith("<local-command") && !t.startsWith("<system-reminder") && !t.startsWith("<task-notification") && !t.startsWith("Caveat:")) {
          if (!s.first) s.first = t.slice(0, 400);
          s.users.push(t);
        }
      }
      if (e.type === "user" && Array.isArray(e.message?.content)) {
        for (const b of e.message.content) {
          if (b?.type === "tool_result" && b.is_error && ids.has(b.tool_use_id)) {
            s.errors.push({ cmd: (ids.get(b.tool_use_id) as string).slice(0, 300), err: text(b.content).slice(0, 400) || String(b.content).slice(0, 400) });
          }
        }
      }
      if (e.type === "assistant" && Array.isArray(e.message?.content)) {
        for (const b of e.message.content) if (b?.type === "text" && /WORKER RESULT|REVIEW RESULT|Orchestrator note/.test(b.text)) s.said.push(String(b.text).slice(0, 400));
        for (const b of e.message.content) {
          if (b?.type !== "tool_use") continue;
          s.tools[b.name] = (s.tools[b.name] ?? 0) + 1;
          if (b.name === "Bash" && b.input?.command) { s.bash.push(String(b.input.command)); ids.set(b.id, String(b.input.command)); }
          if (b.name === "Skill") s.skills.push(String(b.input?.skill));
        }
      }
    }
    const herdrControl = s.bash.filter((c) => /\bherdr (pane (split|run|send|rename|close)|agent (start|prompt|send)|wait)/.test(c)).length;
    const first = s.first; const allUsers = s.users.join("\n");
    const orch = herdrControl >= 3 && !file.includes("2141f19f");
    const memory = (s.tools["mcp__hindsight__hindsight_ingest_document"] ?? 0) > 0 && s.bash.length < 40 && !/\/implement/.test(allUsers);
    const exec = !memory && (/<command-name>\/implement|^\/implement|WORKER RESULT|\/execute/.test(allUsers) || s.said.some((x) => /WORKER RESULT/.test(x)) || (/\.worktrees\//.test(s.cwd) && s.bash.length >= 5));
    s.role = s.subagent ? "subagent" : orch ? "orchestrator" : exec ? "executor" : memory ? "memory" : "other";
    sessions.push(s);
  }
}

// Reduces a command line to its verb, keeping the words that distinguish operations.
function verbs(cmd: string): string[] {
  const found: string[] = [];
  for (const part of cmd.split(/\n|&&|\|\||;|\|/)) {
    const w = part.trim().replace(/^(\w+=\S+\s+)+/, "").split(/\s+/);
    const h = w[0] ?? "";
    if (h === "herdr") {
      const i = w[1] === "--session" ? 3 : 1;
      found.push(w.slice(0, i + 2).filter((x) => !x.startsWith("-") && !x.includes(":")).join(" "));
    }
    else if (h === "gh") found.push(w.slice(0, w[1] === "api" ? 2 : 3).join(" "));
    else if (h === "git") found.push(w.slice(0, w[1] === "-C" ? 4 : 2).filter((_, k) => w[1] !== "-C" || k === 0 || k === 3).join(" "));
    else if (h === "bun" || h === "bunx") found.push(w.slice(0, 3).join(" "));
    else if (/^(node|npx|curl|lsof|wrangler|sleep|kill|pkill)$/.test(h)) found.push(h);
  }
  return found;
}

const roles = ["orchestrator", "executor", "other", "memory", "subagent"];
const report: string[] = [];
for (const role of roles) {
  const group = sessions.filter((s) => s.role === role);
  const verb: Record<string, number> = {};
  const skills: Record<string, number> = {};
  const tools: Record<string, number> = {};
  for (const s of group) {
    for (const c of s.bash) for (const v of verbs(c)) verb[v] = (verb[v] ?? 0) + 1;
    for (const k of s.skills) skills[k] = (skills[k] ?? 0) + 1;
    for (const [k, n] of Object.entries(s.tools)) tools[k] = (tools[k] ?? 0) + n;
  }
  const top = (r: Record<string, number>, n: number) => Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}\t${k}`).join("\n");
  report.push(`## ${role}: ${group.length} sessions, ${group.reduce((n, s) => n + s.bash.length, 0)} bash calls`, "### tools", top(tools, 15), "### skills", top(skills, 20), "### commands", top(verb, 70), "");
}
writeFileSync(join(out, "report.txt"), report.join("\n"));

const index = sessions.filter((s) => !s.subagent).sort((a, b) => a.start.localeCompare(b.start)).map((s) => ({
  role: s.role, start: s.start.slice(0, 16), cwd: s.cwd.replace(/.*nextsnowline/, "."), bash: s.bash.length,
  users: s.users.length, first: s.first.slice(0, 200).replace(/\n/g, " "), file: s.file,
}));
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 1));

for (const role of ["orchestrator", "executor"]) {
  const rows = sessions.filter((s) => s.role === role).map((s) => ({ file: s.file, start: s.start, cwd: s.cwd, first: s.first, users: s.users.map((u) => u.slice(0, 1500)), bash: s.bash.map((c) => c.slice(0, 600)), skills: s.skills, errors: s.errors, said: s.said }));
  writeFileSync(join(out, `${role}.json`), JSON.stringify(rows, null, 1));
}
console.log(roles.map((r) => `${r}=${sessions.filter((s) => s.role === r).length}`).join(" "), "total", sessions.length);
for (const s of index.filter((i) => i.role === "orchestrator")) console.log(s.start, "bash", s.bash, "users", s.users, s.cwd, "|", s.first.slice(0, 110));
