// How a job's home server reaches its worker: starts it, follows it, tells it (landing is a tell), ends it. One kind
// per way a worker runs: `here` (this server's terminals) and `machine` (another server's, through its companion).
import fs from "node:fs"
import path from "node:path"
import { type Machine, MACHINE_CLIENT, type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { type Marks, picturesIn } from "./jobs.ts"
import type { Seen } from "./workers.ts"

/** A worker to start: its agent (claude_personal: in that account), folder and name, its first words or the session
 *  it resumes, how it runs. */
export type Start = { agent: string; cwd: string; name: string; prompt?: string; session?: string; model?: string; effort?: string; mode?: string }
/** What reading a worker asks for (the op companion.worker's params): its last turn, its diff since base, its context. */
export type Read = { turn?: boolean; session?: string; cwd?: string; base?: string; tree?: string; branch?: string; said?: string; context?: boolean; marks?: Marks }
/** The server a worker tells the user through (its terminal's VAULTITE_HOME), and its machine as that server names it. */
export type Home = { url: string; as: string }

/** One way home reaches workers. Terminal ids are the worker's own (bare: its machine's). */
export type Link = {
  kind: "here" | "machine"
  /** A worker started; its terminal's id. */
  start: (ctx: OpCtx, s: Start) => Promise<string>
  /** How it is now, as read where it runs. */
  seen: (terminal: string, r: Read) => Promise<Seen>
  /** Words typed in: a follow-up, or (`land`) their word to land its change. */
  tell: (ctx: OpCtx, terminal: string, text: string) => Promise<{ submitted?: boolean | null; why?: string }>
  land: (ctx: OpCtx, terminal: string, text: string) => Promise<{ submitted?: boolean | null; why?: string }>
  end: (ctx: OpCtx, terminal: string) => Promise<void>
  /** `text` with the pictures of this machine it names made the worker's own (copied there). */
  carry: (text: string) => Promise<string>
  /** An op run where it works (claude-code.trust, claude-code.limits, app.version). */
  there: (ctx: OpCtx, id: string, body: object, seconds?: number) => Promise<unknown>
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

export function workerLinks(plugin: Plugin, o: { seenHere: (terminal: string, r: Read) => Promise<Seen> }) {
  /** Op `id` run on machine `machine` with `body`, its server checking its owner again. */
  async function atMachine(machine: string, id: string, body: object, seconds = 15) {
    const m = await plugin.ask<Machine | null>("machines:machine", null, machine)
    if (!m || m.self) throw new OpError(`no machine '${machine}' (Machines lists them)`, 404)
    if (!m.online) throw new OpError(`${m.label} is offline`, 502)
    const r = await fetch(`${m.url}/api/ops/${id}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(seconds * 1000) }).catch(() => null)
    if (!r) throw new OpError(`${m.label} doesn't answer`, 502)
    const out = await r.json().catch(() => ({})) as Record<string, unknown>
    if (!r.ok) throw new OpError(`${m.label}: ${str(out.error) || `answered ${r.status}`}`, r.status)
    return out
  }

  // ---------- workers this machine runs, for any home (its own jobs' too): how many run now (companion.capacity)
  const KEY = "workers-here"
  const ids = () => plugin.kept<{ ids: string[] }>(KEY, { ids: [] }).ids ?? []
  /** A worker started here, for `home` (another server's job) or for this one's: its terminal's id. */
  async function startHere(ctx: OpCtx, s: Start, home?: Home) {
    const r = await ctx.op("terminal.start", { agent: s.agent, name: s.name, cwd: s.cwd, ...(s.prompt ? { prompt: s.prompt } : {}), ...(s.session ? { session: s.session } : {}),
      ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(s.mode ? { mode: s.mode } : {}), ...(home ? { home } : {}) }) as { id: string }
    plugin.keep(KEY, { ids: [...ids().filter((x) => x !== r.id), r.id].slice(-200) })
    return r.id
  }
  /** The workers running here now (those that ended are let go). */
  async function running() {
    const all = ids(), up = await Promise.all(all.map((id) => plugin.ask<boolean>("terminal:runs", false, id).catch(() => false)))
    if (up.some((x) => !x)) plugin.keep(KEY, { ids: all.filter((_, i) => up[i]) })
    return up.filter(Boolean).length
  }

  const here: Link = {
    kind: "here",
    start: (ctx, s) => startHere(ctx, s),
    seen: (terminal, r) => o.seenHere(terminal, r),
    tell: (ctx, terminal, text) => ctx.op("terminal.send", { id: terminal, text }) as Promise<{ submitted?: boolean | null; why?: string }>,
    land: (ctx, terminal, text) => here.tell(ctx, terminal, text),
    end: async (ctx, terminal) => { await ctx.op("terminal.end", { id: terminal }) },
    carry: async (text) => text,
    there: (ctx, id, body) => ctx.op(id, body as Record<string, unknown>),
  }

  /** This server as the others reach it (its address in Machines), the home its workers elsewhere tell the user through. */
  const homeUrl = async () => ((await plugin.ask<Machine[]>("machines", [])).find((m) => m.self)?.url ?? "").replace(/\/+$/, "")
  const machineLinks = new Map<string, Link>()
  function machineLink(machine: string): Link {
    const hit = machineLinks.get(machine)
    if (hit) return hit
    const link: Link = {
      kind: "machine",
      start: async (_ctx, s) => {
        const url = await homeUrl()
        const r = await atMachine(machine, "companion.worker-start", { ...s, ...(url ? { home: { url, as: machine } } : {}) }, 30)
        if (!str(r.id)) throw new OpError(`${machine} didn't say which terminal it started`, 502)
        return str(r.id)
      },
      seen: (terminal, r) => atMachine(machine, "companion.worker", { id: terminal, ...r }, 10) as Promise<Seen>,
      tell: (ctx, terminal, text) => ctx.op("terminal.send", { id: `${terminal}@${machine}`, text }) as Promise<{ submitted?: boolean | null; why?: string }>,
      land: (ctx, terminal, text) => link.tell(ctx, terminal, text),
      end: async (ctx, terminal) => { await ctx.op("terminal.end", { id: `${terminal}@${machine}` }) },
      carry: (text) => carry(machine, text),
      there: (_ctx, id, body, seconds = 10) => atMachine(machine, id, body, seconds),
    }
    machineLinks.set(machine, link)
    return link
  }

  /** `text` with the pictures of the user's screen it names copied to `machine` (its worker can't read this one's files),
   *  named by their paths there; one that couldn't be copied keeps its path here. */
  async function carry(machine: string, text: string) {
    const files = picturesIn(text).filter((f) => fs.existsSync(f))
    const m = files.length ? await plugin.ask<Machine | null>("machines:machine", null, machine) : null
    if (!m || m.self || !m.online) return text
    const there = await Promise.all(files.map(async (f) => {
      const r = await fetch(`${m.url}/api/ops/companion.picture-take?name=${encodeURIComponent(path.basename(f))}`, { method: "POST",
        headers: { ...MACHINE_CLIENT, "Content-Type": "image/png" }, body: fs.readFileSync(f), signal: AbortSignal.timeout(15_000) }).catch(() => null)
      const to = str((r?.ok ? await r.json().catch(() => null) : null)?.path)
      if (!to) console.error(`companion: jobs: couldn't copy ${path.basename(f)} to ${m.label}${r ? ` (${r.status})` : ""}`)
      return to || f
    }))
    return files.reduce((t, f, i) => t.split(f).join(there[i]), text)
  }

  return {
    /** The link to a worker placed at `w` (its machine, "" for this one). */
    of: (w: { machine: string }): Link => (w.machine ? machineLink(w.machine) : here),
    atMachine, startHere, running,
  }
}
