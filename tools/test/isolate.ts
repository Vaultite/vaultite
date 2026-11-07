// Imported first by every test and QA entry point: a run's first process gives it a temp folder (TMPDIR), removed at
// its end, failed or not, and fails the run if anything in it reached the user's own vaults (core/testrun.ts).
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { REFUSED_FILE } from "../../core/testrun.ts"
import { runtimeDirFor } from "../../core/runtime.ts"
import { asFromDock } from "../../core/sessionenv.ts"

const PREFIX = "vt-"
const OWNER = "owner.pid"
/** Folders outside the run's that it works in (a vault given a QA script): its end looks for agents there too. */
const FOLDERS = "folders.txt"

function begin() {
  const tmp = os.tmpdir(), home = os.homedir()
  sweep(tmp)
  // (short: sockets go in it, and a Mac's socket path holds 104 bytes)
  const run = fs.mkdtempSync(path.join(tmp, PREFIX))
  fs.writeFileSync(path.join(run, OWNER), String(process.pid))
  // (a Vaultite terminal's or an agent session's variables would point what the run starts at the user's server)
  asFromDock(process.env, true)
  Object.assign(process.env, {
    VAULTITE_TEST: "1", VAULTITE_TEST_RUN: run, VAULTITE_TEST_HOME: home, VAULTITE_TEST_TMPDIR: tmp, TMPDIR: run,
    ...(process.platform === "win32" ? { TEMP: run, TMP: run } : {}),
    // (claude.ai's connectors are the user's: their Vaultite one writes the real vault, whatever vault the test serves)
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  })
  const runtime = runtimeDirFor(tmp), refused = path.join(runtime, REFUSED_FILE)
  const from = size(refused), began = Date.now()
  process.on("exit", (code) => {
    const reached = touches(run, refused, from, began, home)
    if (reached.length) {
      console.log(`\nFAIL this run reached the user's own vault (tests use a throwaway one: tools/test/isolate.ts):\n${reached.map((r) => `  ${r}`).join("\n")}`)
      process.exitCode = code || 1
    }
    // (what it started first: a server still running would write into the folder again)
    endChildren()
    remove(run)
  })
  return run
}

/** Ends every process this one started, and theirs (killed with it rather than left running on the folder). */
function endChildren() {
  if (process.platform === "win32") return
  const kids = new Map<number, number[]>()
  for (const line of spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).stdout?.split("\n") ?? []) {
    const [p, pp] = line.trim().split(/\s+/).map(Number)
    if (p && pp) kids.set(pp, [...kids.get(pp) ?? [], p])
  }
  for (let todo = [...kids.get(process.pid) ?? []]; todo.length;) {
    const p = todo.pop()!
    todo.push(...kids.get(p) ?? [])
    try { process.kill(p, "SIGKILL") } catch { /* gone */ }
  }
}

const size = (f: string) => { try { return fs.statSync(f).size } catch { return 0 } }
const remove = (dir: string) => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* the OS's cleanup */ } }
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM" } }

/** Runs that ended without removing their folder (killed, or a crash): the next one removes it. */
export function sweep(tmp: string) {
  let names: string[] = []
  try { names = fs.readdirSync(tmp).filter((n) => n.startsWith(PREFIX)) } catch { return }
  for (const n of names) {
    const dir = path.join(tmp, n)
    let pid = 0
    try { pid = Number(fs.readFileSync(path.join(dir, OWNER), "utf8")) } catch { /* not a run's (left alone), or its first moment */ }
    if (pid && !alive(pid)) remove(dir)
  }
}

/** What in this run reached the user's own vaults: its server or app refused one, the user's server refused its vau
 *  (`refused`, past `from`), or an agent on the user's accounts ran in its folders and called a claude.ai connector. */
export function touches(run: string, refused: string, from: number, began: number, home: string): string[] {
  const out: string[] = []
  const lines = (text: string) => text.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
  try { for (const r of lines(fs.readFileSync(path.join(run, "refused.jsonl"), "utf8"))) out.push(r.why ?? JSON.stringify(r)) } catch { /* none */ }
  try {
    const fd = fs.openSync(refused, "r"), len = fs.fstatSync(fd).size - from
    const buf = Buffer.alloc(Math.max(0, len))
    if (len > 0) fs.readSync(fd, buf, 0, len, from)
    fs.closeSync(fd)
    const id = path.basename(run)
    for (const r of lines(buf.toString("utf8"))) if (r.run === id) out.push(`the user's server refused ${r.call}`)
  } catch { /* none */ }
  out.push(...connectorCalls(run, began, home))
  return out
}

/** Coding agents' sessions in the user's Claude Code accounts whose folder is in the run, since it began, that called a
 *  claude.ai connector (mcp__claude_ai_*): those reach the user's own services, their vault among them. */
function connectorCalls(run: string, began: number, home: string): string[] {
  const enc = (p: string) => p.replace(/[^a-zA-Z0-9]/g, "-")
  const real = (p: string) => { try { return fs.realpathSync(p) } catch { return p } }
  let more: string[] = []
  try { more = fs.readFileSync(path.join(run, FOLDERS), "utf8").split("\n").filter(Boolean) } catch { /* none */ }
  const prefixes = [...new Set([run, ...more].flatMap((p) => [enc(p), enc(real(p))]))]
  let accounts: string[] = []
  try { accounts = fs.readdirSync(home).filter((n) => /^\.claude(-[\w]+)?$/.test(n)).map((n) => path.join(home, n)) } catch { /* none */ }
  const out: string[] = []
  for (const a of accounts) {
    const projects = path.join(a, "projects")
    let dirs: string[] = []
    try { dirs = fs.readdirSync(projects).filter((d) => prefixes.some((p) => d.startsWith(p))) } catch { continue }
    for (const d of dirs) {
      for (const f of walk(path.join(projects, d))) {
        if (!f.endsWith(".jsonl") || (fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0) < began) continue
        const used = [...new Set([...fs.readFileSync(f, "utf8").matchAll(/"name":"(mcp__claude_ai_[\w-]+)"/g)].map((m) => m[1]))]
        if (used.length) out.push(`a Claude Code session (${f}) called ${used.join(", ")}`)
      }
    }
  }
  return out
}

function walk(dir: string): string[] {
  let out: string[] = []
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) out = out.concat(e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) } catch { /* gone */ }
  return out
}

/** Tells the run's end that it works in `dir` too. */
export const worksIn = (dir: string) => { try { fs.appendFileSync(path.join(process.env.VAULTITE_TEST_RUN!, FOLDERS), path.resolve(dir) + "\n") } catch { /* not a run */ } }

/** A copy of a real vault keeps its machines: with them it shares their tabs and state, and follows their terminals. */
export function forgetMachines(vault: string) {
  const dir = path.join(vault, ".vaultite", "plugins", "machines")
  try { if (!JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8")).machines?.length) return } catch { return }
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ machines: [] }) + "\n")
  fs.rmSync(path.join(dir, "vault.json"), { force: true })
}

/** The run's folder, every temp folder of its tests in it; what it starts (suites, tools/qa.ts' scripts) shares it.
 *  (Last: begin() uses what's above.) */
export const RUN = process.env.VAULTITE_TEST_RUN || begin()
