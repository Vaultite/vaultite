// Dispatch: a note handed to a coding agent (or a shell command) in a new terminal on this machine or another of the
// Machines. The agent gets the note's path, not its text, so it reads the latest version and can edit it.
import fs from "node:fs"
import path from "node:path"
import { quote, startAgent } from "../../../core/codingagents.ts"
import { AGENT, agentIn, newTerminalId } from "../../../core/terminalids.ts"
import { type Machine, MACHINE_CLIENT, type OpCtx, OpError, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** An action (types.ts has it for the app): an agent started with `prompt`, or a shell `command` typed into a new shell.
 *  `report: false`: the agent isn't told to end with a report (nor its terminal ended after one). `open`: its terminal's
 *  tab opens in the user's window (by itself only when nothing comes back to the inbox: a command, no report). */
export type Action = { id: string; label: string; icon?: string; agent?: string; prompt?: string; command?: string; report?: boolean; open?: boolean }

export const DEFAULT_PROMPT = "Read the note {path} and do what it asks."
/** What an agent is told after its prompt while the Inbox is on: it works alone, and its report is where the user answers. */
export const REPORT = "Do it all the way, then end with `vau inbox report` (vau inbox report --help): the user reads it in their " +
  "inbox, your terminal ends after this turn, and their reply comes back to you."
export const DEFAULT_ACTIONS: Action[] = [{ id: "claude", label: "Claude Code", icon: "claude", agent: "claude", prompt: DEFAULT_PROMPT }]

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

/** Its settings' `actions` read leniently (an id from the label when it has none; one without an agent or a command
 *  left out), else the default. */
export function actions(): Action[] {
  const raw = plugin.settings().actions
  if (!Array.isArray(raw)) return DEFAULT_ACTIONS
  const out: Action[] = []
  for (const x of raw) {
    if (!x || typeof x !== "object") continue
    const r = x as Record<string, unknown>
    const agent = str(r.agent), command = str(r.command)
    if (!(agent && AGENT.test(agent)) && !command) continue
    const label = str(r.label) || agent || "Command"
    let id = slug(str(r.id)) || slug(label) || "action", n = 2
    while (out.some((a) => a.id === id)) id = `${slug(str(r.id)) || slug(label) || "action"}-${n++}`
    const a: Action = { id, label }
    if (str(r.icon)) a.icon = str(r.icon)
    if (agent && AGENT.test(agent)) {
      a.agent = agent
      a.prompt = typeof r.prompt === "string" && r.prompt.trim() ? r.prompt : DEFAULT_PROMPT
      if (r.report === false) a.report = false
    }
    else a.command = command
    if (typeof r.open === "boolean") a.open = r.open
    out.push(a)
  }
  return out
}

plugin.state(() => ({ dispatch: { actions: actions(), defaults: DEFAULT_ACTIONS } }))

/** A template with {path}, {file}, {title} and {vault} filled in (shell-quoted in a command); other braces stay. */
export function fill(template: string, vars: Record<string, string>, shell = false) {
  return template.replace(/\{(path|file|title|vault)\}/g, (_m, k: string) => (shell ? quote(vars[k]) : vars[k]))
}

/** How dispatch.run's refusal of a command not yet allowed here starts (the app asks the user on it). */
export const COMMAND_UNSEEN = "This machine hasn't run this action's command before:"

/** The machine `id` names when it isn't this one (Machines), else null. */
async function machineFor(id: string | undefined): Promise<Machine | null> {
  if (!id) return null
  const m = await plugin.ask<Machine | null>("machines:machine", null, id)
  if (m) return m.self ? null : m
  const ids = await plugin.ask<string[]>("machines:ids", [])
  throw new OpError(`no machine '${id}'${ids.length ? ` (${ids.join(", ")})` : ": Machines is off or lists none"}`, 404)
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Waits (20 s at most) for machine `m`'s copy of `rel` to read as this one's: iCloud may still be bringing it there. */
async function sameCopy(m: Machine, rel: string) {
  const mine = fs.readFileSync(plugin.vault.abs(rel), "utf8")
  let found = false
  for (const until = Date.now() + 20000; Date.now() < until; await pause(1000)) {
    try {
      const r = await fetch(`${m.url}/api/file?path=${encodeURIComponent(rel)}`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(5000) })
      if (r.status === 413 || r.status === 415) return // not text: there, as far as it says
      if (r.ok) { found = true; if ((await r.json() as { text?: string }).text === mine) return }
    } catch { /* tried again */ }
  }
  if (!found) throw new OpError(`${m.label} doesn't have ${rel} yet (its sync may still be bringing it there)`, 409)
}

/** Runs it on machine `m` (its server, which checks its owner again), once its copy of the file is this one's. Once
 *  only: a dispatch another machine passed on isn't passed on again. */
async function onMachine(ctx: OpCtx, m: Machine, rel: string, a: Action, allow: boolean, account: string, again: boolean) {
  if (ctx.who.client?.startsWith("machine/")) throw new OpError(`a dispatch passed on from another machine runs where it's sent, not on ${m.label}`, 409)
  if (!m.online) throw new OpError(`${m.label} is offline`, 502)
  if (!m.vault || m.vault !== await plugin.ask<string>("machines:vault", "")) {
    throw new OpError(`${m.label} ${m.vault ? "has a vault of its own, not this one" : "doesn't say which vault it has (an older Vaultite)"}, so it can't open ${rel}`, 409)
  }
  if (!m.plugins?.includes(plugin.id) || !m.plugins.includes("terminal")) throw new OpError(`${m.label} has Dispatch or Terminal turned off`, 409)
  await sameCopy(m, rel)
  let r: Response
  try {
    r = await fetch(`${m.url}/api/ops/dispatch.run`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify({ path: rel, action: a.id, open: false, ...(allow ? { allow: true } : {}), ...(account ? { account } : {}), ...(again ? { again: true } : {}) }), signal: AbortSignal.timeout(30000) })
  } catch {
    throw new OpError(`${m.label} doesn't answer`, 502)
  }
  let out: { id?: string; handed?: boolean; running?: boolean; error?: string } = {}
  try { out = await r.json() as typeof out } catch { /* not JSON */ }
  if (!r.ok || !out.id) throw new OpError(`${m.label}: ${out.error || `answered ${r.status}`}`, r.ok ? 502 : r.status)
  return { id: `${out.id}@${m.id}`, handed: !!out.handed, running: !!out.running }
}

/** The sessions dispatch started here, by what they run (action, file, account): asked the same again while one still
 *  runs, that one answers (a second click, a phone's double tap), unless asked `again`. */
const started = new Map<string, Promise<{ id: string; handed: boolean }>>()
async function stillRuns(ctx: OpCtx, id: string) {
  try { return ((await ctx.api("GET", "terminals/sessions")) as { sessions: { id: string }[] }).sessions.some((x) => x.id === id) } catch { return false }
}

/** Whether an action's terminal opens by itself: its `open`, else only when nothing comes back to the inbox. */
export const opens = (a: Action, handed: boolean) => a.open ?? !handed

const vaultDir = () => { try { return fs.realpathSync(plugin.vault.path) } catch { return plugin.vault.path } }

/** Starts it in a new terminal here: the agent with its prompt (told to report, with the Inbox on), or the command. */
async function startHere(ctx: OpCtx, a: Action, rel: string, account: string, allow: boolean) {
  // A command is the vault's setting, and a synced or shared vault mustn't pick what runs here: this machine says yes once.
  if (a.command && !plugin.allows(`command:${a.command}`)) {
    if (!allow) throw new OpError(`${COMMAND_UNSEEN} ${a.label} runs \`${a.command}\`. Ask the user, then run it again with allow`, 409)
    plugin.allow(`command:${a.command}`)
  }
  const vars = { path: rel, file: path.join(vaultDir(), rel), title: path.basename(rel).replace(/\.md$/i, ""), vault: vaultDir() }
  if (a.agent) {
    const id = newTerminalId(account ? agentIn(a.agent.split("_")[0], account) : a.agent)
    const hand = a.report === false ? null : plugin.service("inbox:handed") as ((t: string) => void) | null
    await startAgent(ctx, id, fill(a.prompt ?? DEFAULT_PROMPT, vars) + (hand ? `\n\n${REPORT}` : ""))
    hand?.(id)
    return { id, handed: !!hand }
  }
  const id = newTerminalId()
  await ctx.api("POST", `terminals/${id}`)
  await ctx.api("POST", `terminals/${id}/send`, { text: fill(a.command!, vars, true), enter: true })
  return { id, handed: false }
}

plugin.op({
  owner: "the terminal",
  id: "dispatch.run",
  cli: "dispatch",
  summary: "Hand a file to a coding agent in a new terminal on this machine or another (Claude Code by default), told to read it and do what it asks.",
  help: `Runs one of Dispatch's actions on a file: an agent started with its prompt (the file's path, not its text, so it
reads the latest version and can edit it), or a shell command, in a new terminal shown in the user's window. Without
action, the first one. The actions are the plugin's settings (vau docs dispatch). With machine, on another of the
Machines (one with this vault): its terminal is <id>@<machine>. With account, the agent runs in that one of its
accounts (Claude Code: its config folders).

  vau dispatch "Notes/Garden plan.md"
  vau dispatch Notes/Idea.md --action codex
  vau dispatch Notes/Idea.md --machine studio --account personal`,
  kind: "write",
  lock: false, // starting a shell holds nothing of the vault
  params: {
    path: { type: "string", format: "path", required: true, description: "the file to hand over (Notes/Idea.md)" },
    action: { type: "string", description: "the action's id (claude); the first one when left out" },
    machine: { type: "string", description: "run it on another of the Machines, by its id (studio); this one when left out" },
    account: { type: "string", description: "the agent's account to run in (personal); the action's own when left out" },
    open: { type: "boolean", description: "open its terminal's tab in the user's window (default: the action's open; an agent that reports to the inbox runs in the background)" },
    allow: { type: "boolean", description: "run a command action this machine hasn't run before (ask the user first: it's a shell command a setting names)" },
    again: { type: "boolean", description: "start another session even when one this file's dispatch started still runs (else that one answers, running: true)" },
  },
  args: ["path"],
  action: { on: ["*"], param: "path", label: "Hand to a coding agent", icon: "bot", menu: false },
  run: async ({ path: rel, action, machine, open, allow, account, again }, ctx) => {
    const list = actions()
    const a = action ? list.find((x) => x.id === action) : list[0]
    if (!a) throw new OpError(action ? `no action '${action}': ${list.map((x) => x.id).join(", ") || "there are none"}` : "there are no actions (the setting actions)")
    if (account && (!a.agent || !/^[a-z0-9]{1,32}$/.test(account))) throw new OpError(a.agent ? `'${account}' isn't an account's id` : `${a.label} runs a command, not an agent with accounts`)
    if (rel.startsWith("/") || rel.split("/").includes("..")) throw new OpError(`'${rel}' isn't a path in the vault`)
    const abs = plugin.vault.abs(rel)
    try { if (!fs.statSync(abs).isFile()) throw new Error() } catch { throw new OpError(`there's no file '${rel}'`, 404) }
    const m = await machineFor(machine)
    const key = `${a.id}\n${rel}\n${account ?? ""}`
    let r: { id: string; handed: boolean; running?: boolean } | null = null
    if (m) r = await onMachine(ctx, m, rel, a, !!allow, account ?? "", !!again)
    else if (!again && started.has(key)) {
      try { const was = await started.get(key)!; if (await stillRuns(ctx, was.id)) r = { ...was, running: true } } catch { /* it didn't start */ }
    }
    if (!r) {
      const p = startHere(ctx, a, rel, account ?? "", !!allow)
      started.set(key, p)
      p.catch(() => { if (started.get(key) === p) started.delete(key) })
      r = await p
    }
    const { id, handed, running } = r
    let shown = false
    if (open ?? opens(a, handed)) {
      try { await ctx.ui({ action: "open", path: `view:terminal/${id}`, newTab: true }); shown = true } catch (e) {
        if (!(e instanceof OpError && e.status === 409)) throw e
      }
    }
    return { id, action: a.id, path: rel, shown, handed, ...(running ? { running } : {}), ...(m ? { machine: m.id } : {}), ...(account ? { account } : {}) }
  },
  text: (r) => `${r.running ? "Already running:" : "Dispatched"} ${r.path} to ${r.action}${r.account ? ` (${r.account})` : ""}${r.machine ? ` on ${r.machine}` : ""} in ${r.id}${r.shown ? "" : ` (${r.handed
    ? "in the background: its report comes to the inbox" : "no tab open"}; vau terminal screen ${r.machine ? `${r.id.split("@")[0]} on that machine` : r.id})`}.`,
})
