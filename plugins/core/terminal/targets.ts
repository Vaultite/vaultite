import { z } from "zod"
import { parseTerminal } from "../../../core/agents.ts"
import { byUser, type Machine, MACHINE_CLIENT, OpError, type OpCtx, type Plugin, splitMachine } from "../../../core/plugins.ts"
import { allPanes, clean } from "../../../core/layout.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any
const opt = { s: z.string().optional(), n: z.number().optional(), b: z.boolean().optional() }
export const Session = z.looseObject({ id: z.string(), agent: z.string().nullable(), process: z.string(), busy: opt.b, clients: z.number(), started: z.number(), title: opt.s,
  state: opt.s, kind: opt.s, msg: opt.s, needs: opt.b, note: opt.s, backend: opt.s, session: opt.s, name: opt.s, cwd: opt.s, command: opt.s, cols: opt.n, rows: opt.n,
  activity: opt.n, machine: opt.s, machineLabel: opt.s, pid: opt.n, via: opt.n })
export type Session = z.infer<typeof Session>
const Exit = z.object({ code: z.number(), signal: z.number(), at: z.number(), lost: opt.b })
export const Ended = z.looseObject({ id: z.string(), backend: z.string(), command: z.string(), name: opt.s, note: opt.s, started: z.number(), exit: Exit })
export type Ended = z.infer<typeof Ended>
export const TabAt = z.object({ workspace: z.number(), tab: z.string() })
export type TabAt = z.infer<typeof TabAt>
export const Trouble = z.object({ since: z.number(), pid: z.number(), text: z.string() })
const Sessions = z.object({ sessions: z.array(Session), ended: z.array(Ended).optional(), starting: z.array(z.string()).optional(), trouble: Trouble.optional() })

export const freshAgent = (id: string) => { const t = parseTerminal(id); return !!t && !t.resume && !t.machine }

export async function sessions(ctx: OpCtx, ended = false) {
  return Sessions.parse(await ctx.api("GET", `terminals/sessions${ended ? "?ended=1" : ""}`))
}

export async function tabsOf(ctx: OpCtx): Promise<Map<string, TabAt[]>> {
  const out = new Map<string, TabAt[]>()
  let ws: { layout?: unknown }[] = []
  try { ws = (await ctx.api("GET", "workspaces")).workspaces ?? [] } catch (e) { if (!(e instanceof OpError)) throw e }
  ws.forEach((w, i) => {
    const l = clean(w?.layout)
    for (const p of l ? [l, ...(l.windows ?? [])].flatMap(allPanes) : []) {
      const m = /^view:terminal\/(.+)$/.exec(p.to)
      if (m) out.set(m[1], [...(out.get(m[1]) ?? []), { workspace: i + 1, tab: p.id }])
    }
  })
  return out
}

export async function closeTabs(ctx: OpCtx, id: string): Promise<number> {
  try {
    const r = await ctx.api("POST", "workspaces/close", { path: `view:terminal/${id}` })
    return r?.closed?.length ?? 0
  } catch (e) {
    if (e instanceof OpError) return 0
    throw e
  }
}

export async function show(ctx: OpCtx, to: string, split: "right" | "down" | null = null, did = "started a session") {
  const path = `view:terminal/${to}`
  try {
    if (byUser(ctx.who)) return void await ctx.ui({ action: "open", path, ...(split ? { split } : {}), newTab: !split })
    await ctx.ui({ action: "open", path, background: true })
    const who = ctx.who.label
    await ctx.ui({ action: "notify", text: `${who[0].toUpperCase()}${who.slice(1)} ${did}`, button: { label: "Show", open: path } })
  } catch (e) {
    if (e instanceof OpError && e.status === 409) throw new OpError(`no app window is open: open the app first (the session is running: vau terminal capture ${to})`, 409)
    throw e
  }
}

export async function passOn(plugin: Plugin, ctx: OpCtx, machine: string, id: string, body: object, seconds = 15): Promise<Any> {
  const m = await plugin.ask<Machine | null>("machines:machine", null, machine)
  if (!m || m.self) throw new OpError(`no machine '${machine}' to ask (Machines lists them)`, 404)
  if (ctx.who.client?.startsWith("machine/")) throw new OpError(`a call passed on from another machine runs where it's sent, not on ${m.label}`, 409)
  if (!m.online) throw new OpError(`${m.label} is offline`, 502)
  const r = await fetch(`${m.url}/api/ops/${id}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(seconds * 1000) }).catch(() => null)
  if (!r) throw new OpError(`${m.label} doesn't answer`, 502)
  const out = await r.json().catch(() => ({}))
  if (r.status === 404 && !out.id) throw new OpError(`${m.label} runs an older Vaultite, without ${id}`, 409)
  if (!r.ok) throw new OpError(`${m.label}: ${out.error || `answered ${r.status}`}`, r.status)
  return out
}

export async function elsewhere(plugin: Plugin, machine: string): Promise<string | null> {
  if (!machine) return null
  const m = await plugin.ask<Machine | null>("machines:machine", null, machine)
  return m?.self ? null : machine
}

export async function target(plugin: Plugin, ctx: OpCtx, raw: string | undefined, o: { ended?: boolean } = {}): Promise<[string, string]> {
  const given = String(raw ?? "").trim().replace(/^view:terminal\//, "")
  if (!given) throw new OpError("which terminal? give its id, its name or the end of its id (vau terminal lists them)")
  const [own, at] = splitMachine(given)
  const machine = await elsewhere(plugin, at)
  if (machine) return [own, machine]
  const r = await sessions(ctx, o.ended)
  const all: { id: string; name?: string; ended?: boolean }[] = [...r.sessions, ...(r.ended ?? []).filter((e) => !r.sessions.some((s) => s.id === e.id)).map((e) => ({ id: e.id, name: e.name, ended: true }))]
  if (all.some((s) => s.id === own)) return [own, ""]
  const low = own.toLowerCase()
  const pick = (found: typeof all, how: string) => {
    const hits = found.some((s) => !s.ended) ? found.filter((s) => !s.ended) : found
    if (hits.length === 1) return hits[0].id
    if (hits.length > 1) throw new OpError(`'${own}' is ${hits.length} terminals' ${how}: ${hits.slice(0, 8).map((s) => s.id).join(", ")} (give more of its id)`, 409)
    return null
  }
  const id = pick(all.filter((s) => s.name?.toLowerCase() === low), "name")
    ?? (own.length >= 3 ? pick(all.filter((s) => s.id.endsWith(own)), "id ending") ?? pick(all.filter((s) => s.id.startsWith(own)), "id start") : null)
  if (id) return [id, ""]
  if (/^[\w-]{1,64}$/.test(own) && (parseTerminal(own) || /^[a-z0-9]{8}$/.test(own))) return [own, ""]
  throw new OpError(`no terminal '${own}' here (vau terminal lists them; another machine's is <id>@<machine>)`, 404)
}

export async function there(plugin: Plugin, ctx: OpCtx, machine: string, op: string, body: Record<string, unknown>, seconds?: number) {
  const out = await passOn(plugin, ctx, machine, op, body, seconds)
  return { ...out, ...(typeof out.id === "string" ? { id: `${out.id}@${machine}` } : {}), machine }
}

export async function shown(ctx: OpCtx, id: string, split: "right" | "down" | null = null, did?: string) {
  try { await show(ctx, id, split, did); return true } catch (e) { if (e instanceof OpError && e.status === 409) return false; throw e }
}
