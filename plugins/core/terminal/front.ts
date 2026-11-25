import path from "node:path"
import { agentOfCommand, runsOthers, terminalAgent } from "../../../core/agents.ts"
import { type Proc, processTable } from "../../../core/plugins.ts"
import type { Listed as Shell } from "./backend.ts"
import { progName } from "./shells.ts"
import { WIN } from "./shared.ts"
import { agentOf } from "./backends.ts"
import { terms } from "./terms.ts"

export type Front = { program: string | null; agent: string | null }
type Seen = { program: string; args?: string; pid?: number; own?: boolean }

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "-zsh", "-bash", "-sh", "login", "pwsh", "powershell", "cmd", "wsl", ""])
const VERSION = /^\d+(\.\d+)+$/
/** A shell's process by its name: on Linux node-pty says the path it was started by ("/bin/bash"). */
export const byName = (x: Shell): Shell => (x.process?.includes("/") ? { ...x, process: path.basename(x.process) } : x)

let readsTable = false
export function tableAhead() {
  if (readsTable) void processTable()
  readsTable = false
}

async function seenIn(x: Shell): Promise<Seen | null> {
  if (WIN) return seenOnWindows(x)
  const shell = SHELLS.has(x.process), itself = shell ? null : { program: x.process }
  // (Claude Code's native install runs a binary named for its version: ~/.local/share/claude/versions/2.1.290)
  if (!x.pid || (!shell && !VERSION.test(x.process) && !runsOthers(x.process))) return itself
  readsTable = true
  const all = await processTable(), pid = all.get(x.pid)?.tpgid ?? 0
  if (pid <= 0 || pid === x.pid) return itself
  const args = all.get(pid)?.args ?? ""
  return { program: programNamed(args) || x.process || "shell", args, pid }
}

function programNamed(args: string) {
  const [bin = "", ...rest] = args.split(/\s+/), name = path.basename(bin).replace(/^-/, "")
  const script = SHELLS.has(name) && !rest.includes("-c") ? rest.find((a) => !a.startsWith("-")) : undefined
  return script ? path.basename(script) : name
}

/** Windows has no foreground groups: the newest program the shell started (an agent the starter runs, by its own name).
 *  A WSL distro's programs can't be seen from here: an agent's terminal reads as running its agent. */
async function seenOnWindows(x: Shell): Promise<Seen | null> {
  if (x.process === "wsl") { const a = agentOf(x.id)?.name; return a ? { program: a, own: true } : null }
  if (!x.pid) return null
  readsTable = true
  const all = [...await processTable()]
  const kids = (pid: number) => all.filter(([, p]) => p.ppid === pid && !/^(conhost|openconsole)$/.test(progName(argv0(p.args)))).sort((a, b) => b[1].started - a[1].started)
  const kid = kids(x.pid)[0]
  if (!kid) return null
  if (!/[\\/]starter\.ts\b/.test(kid[1].args)) return { program: progName(argv0(kid[1].args)) || "program", args: kid[1].args, pid: kid[0] }
  const agent = kids(kid[0])[0]
  return { program: agent ? progName(argv0(agent[1].args)) : agentOf(x.id)?.name ?? "agent", own: true }
}
const argv0 = (line: string) => (line.startsWith('"') ? line.slice(1, line.indexOf('"', 1) >>> 0) : line.split(" ")[0])

export const inFront = async (x: Shell) => (await seenIn(x))?.program ?? null

const startedOnLine = (args: string) => / -c /.test(` ${args} `)
async function onOwnLine(x: Shell) {
  if (WIN || !x.pid) return false
  readsTable = true
  return startedOnLine((await processTable()).get(x.pid)?.args ?? "")
}

function agentUnder(all: Map<number, Proc>, pid: number): string | null {
  const tty = all.get(pid)?.tpgid
  let from = new Set([pid])
  for (let deep = 0; deep < 4 && from.size; deep++) {
    const kids = [...all].filter(([, p]) => from.has(p.ppid) && p.tpgid === tty)
    for (const [, p] of kids) { const a = agentOfCommand(p.args); if (a) return a }
    from = new Set(kids.map(([k]) => k))
  }
  return null
}

const serves = (program: string) => (/^[a-z][a-z0-9]*$/.test(program) ? agentOf(`${program}-x`)?.name ?? null : null)
const saysItIs = (id: string) => { const app = terms.get(id)?.osc?.status?.app; return app ? terminalAgent(app) : null }
const mayBeOwn = (id: string, own: string, program: string) =>
  !terms.get(id)?.left && (!terminalAgent(own) || runsOthers(program) || VERSION.test(program))

async function otherIn(x: Shell, f: Seen): Promise<string | null> {
  const wraps = !!f.pid && (runsOthers(f.program) || SHELLS.has(x.process))
  return (wraps ? agentUnder(await processTable(), f.pid!) : null) ?? saysItIs(x.id)
}

export async function frontOf(x: Shell): Promise<Front> {
  const f = await seenIn(x)
  if (!f) return { program: null, agent: null }
  const program = f.program, own = agentOf(x.id)?.name ?? null
  const named = agentOfCommand(f.args || program) ?? serves(program)
  if (own && (f.own || named === own || await onOwnLine(x))) return { program, agent: own }
  const agent = named ?? await otherIn(x, f)
  return { program, agent: agent ?? (own && mayBeOwn(x.id, own, program) ? own : null) }
}

export async function atPrompt(x: Shell) {
  const args = x.pid ? (await processTable(0)).get(x.pid)?.args : undefined
  return (await inFront(byName(x))) === null && !!args && !startedOnLine(args)
}
