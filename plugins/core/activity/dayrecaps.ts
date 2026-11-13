import fs from "node:fs"
import path from "node:path"
import { bullets, HTTPError, LOADED, localDate, MACHINE_CLIENT, type Machine, OpError, section } from "../../../core/plugins.ts"
import { joinPath, Kind } from "../../../core/vault.ts"
import { buildRecap, type Read, type Sources } from "./build.ts"
import { str } from "./describe.ts"
import { between } from "./events.ts"
import { groupOf, parseRecap, RECAP_GROUPS, type RecapEntry, type RecapGroup, renderRecap } from "./recap.ts"
import { ownWrites, recaps } from "./requests.ts"
import { HOUR, plugin } from "./store.ts"

plugin.kind(new Kind({
  type: "recap", collection: "recaps", folder: "Recaps",
  parse: (_fm, body, stem) => [{ date: stem, body }, /^\d{4}-\d\d-\d\d$/.test(stem) ? [] : ["a recap's name is its date: YYYY-MM-DD.md"]],
  render: (r) => [{}, r.body || ""],
  filename: (r, at) => joinPath(at.folder, str(r.date)), key: (r) => r.date ?? null,
}))
plugin.state(() => ({}))

const DATE = /^\d{4}-\d\d-\d\d$/
const GRACE = 3 * HOUR

function recapSettings() {
  const s = plugin.loaded ? plugin.settings() : {}
  const folders = Array.isArray(s.capture_folders) ? s.capture_folders.map((x: unknown) => str(x).replace(/^\/+|\/+$/g, "")).filter(Boolean) : []
  return { on: s.recaps !== false, folders }
}

function bounds(date: string): [number, number] {
  const [y, m, d] = date.split("-").map(Number)
  return [+new Date(y, m - 1, d), +new Date(y, m - 1, d + 1)]
}
const dayBefore = (date: string, n = 1) => { const [y, m, d] = date.split("-").map(Number); return localDate(new Date(y, m - 1, d - n)) }

function lifeTypes() {
  return new Set(LOADED.filter((p) => p.manifest.category === "life" || p.manifest.category === "health").flatMap((p) => p.kinds.map((k) => k.type)))
}

function taskStatuses(): Record<string, "todo" | "doing" | "done" | "cancelled"> {
  const map = { TODO: "todo", ON_HOLD: "todo", NON_TASK: "todo", IN_PROGRESS: "doing", DONE: "done", CANCELLED: "cancelled" } as const
  for (const dir of [".obsidian", ".vaultite/obsidian"]) {
    try {
      const d = JSON.parse(fs.readFileSync(plugin.vault.abs(`${dir}/plugins/obsidian-tasks-plugin/data.json`), "utf8"))
      const all = [...(d?.statusSettings?.coreStatuses ?? []), ...(d?.statusSettings?.customStatuses ?? [])] as { symbol?: string; type?: string }[]
      return Object.fromEntries(all.filter((x) => typeof x.symbol === "string" && x.type && x.type in map).map((x) => [x.symbol!, map[x.type as keyof typeof map]]))
    } catch {}
  }
  return {}
}

const memo = { statuses: "", stretches: new Map<string, Read | null>() }
async function sourcesOf(date: string): Promise<Sources> {
  const [from, to] = bounds(date)
  const life = lifeTypes()
  const statuses = taskStatuses(), key = JSON.stringify(statuses)
  if (memo.statuses !== key) memo.stretches = new Map()
  memo.statuses = key
  return {
    from, to,
    events: between(from - HOUR).filter((e) => e.t < to + HOUR),
    changed: await plugin.ask<string[]>("history:changed", [], from),
    versions: (rel) => plugin.ask("history:versions", { gone: false, versions: [] }, rel),
    text: (rel, t) => plugin.ask<string | null>("history:text", null, rel, t),
    exists: (rel) => fs.existsSync(plugin.vault.abs(rel)),
    kindOf: (type) => ({ life: !!type && life.has(type), log: type === "log" }),
    captureFolders: recapSettings().folders,
    statuses,
    memo: memo.stretches,
    updates: pluginUpdates(),
    authored: (rel) => plugin.ask("provenance:authored", [], rel, from, to),
  }
}

function pluginUpdates(): NonNullable<Sources["updates"]> {
  const lock = plugin.vault.config("plugins-lock")
  return Object.entries(lock).flatMap(([id, l]) => {
    const history = l && typeof l === "object" && Array.isArray((l as { history?: unknown }).history) ? (l as { history: Record<string, unknown>[] }).history : []
    const m = LOADED.find((p) => p.id === id)?.manifest
    const name = typeof m?.name === "string" && m.name ? m.name : id
    return history.filter((u) => u && typeof u.at === "string").map((u) => ({ t: Date.parse(u.at as string), name, from: String(u.from), to: String(u.to),
      how: u.how === "auto" || u.how === "rollback" ? u.how : "manual" as const, notes: Array.isArray(u.notes) ? u.notes.map(String) : [] }))
  })
}

const built = new Map<string, { at: number; version: number; entries: Promise<RecapEntry[]> }>()
function build(date: string) {
  const hit = built.get(date), version = plugin.vault.version
  if (hit && hit.version === version && Date.now() - hit.at < 20_000) return hit.entries
  const entries = sourcesOf(date).then(buildRecap)
  built.set(date, { at: Date.now(), version, entries })
  if (built.size > 40) built.delete(built.keys().next().value!)
  entries.catch(() => built.delete(date))
  return entries
}

const recapOf = (date: string) => (plugin.vault.has("recaps") ? plugin.vault.get("recaps", date) : null)

async function writeRecap(date: string) {
  const entries = await build(date)
  const vault = plugin.vault
  return await vault.lock(async () => {
    await vault.sync()
    const old = recapOf(date)
    if (!old && !entries.length) return null
    const body = renderRecap(entries, parseRecap(old?.body ?? ""))
    if (old && old.body.trim() === body.trim()) return old.id + ".md"
    const rel = `${old ? old.id : joinPath(vault.home("recaps") ?? "Recaps", date)}.md`
    ownWrites.set(rel, Date.now())
    const saved = await vault.save("recaps", { date, body }, old?.id ?? null)
    if (saved) ownWrites.set(`${saved.id}.md`, Date.now())
    await vault.sync()
    return saved ? `${saved.id}.md` : null
  })
}

// One machine writes the recaps: iCloud shows one of two machines' writes of a file and hides the other.
async function recapWriter(): Promise<{ id: string; m: Machine | null } | null> {
  const ids = await plugin.ask<string[]>("machines:ids", []), self = await plugin.ask<string>("machines:self", "")
  const writer = await plugin.ask<string | null>("machines:writer", null) ?? ids[0]
  if (!writer || !self || self === writer) return null
  return { id: writer, m: await plugin.ask<Machine | null>("machines:machine", null, writer) }
}
async function writeThere({ id, m }: { id: string; m: Machine | null }, client: string | null | undefined, params: object) {
  const name = m?.label || id, why = `${name} writes the recaps (their job runs there)`
  if (!m || client?.startsWith("machine/")) throw new OpError(`${why}: write it there`, 409)
  if (!m.online) throw new OpError(`${why} and is offline: try again once it's back`, 502)
  let r: Response
  try {
    r = await fetch(`${m.url}/api/ops/activity.recap`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(params), signal: AbortSignal.timeout(60_000) })
  } catch { throw new OpError(`${why} and doesn't answer`, 502) }
  const out = await r.json().catch(() => ({})) as { error?: unknown; days?: RecapDay[] }
  if (!r.ok) throw new OpError(`${name}: ${typeof out.error === "string" ? out.error : `answered ${r.status}`}`, r.status)
  return out as { days: RecapDay[] }
}

function written(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(plugin.localDir(), "recaps.json"), "utf8")).days ?? []) } catch { return new Set() }
}
function markWritten(dates: string[]) {
  const all = [...new Set([...written(), ...dates])].sort().slice(-400)
  try { fs.writeFileSync(path.join(plugin.localDir(), "recaps.json"), JSON.stringify({ days: all })) } catch {}
}

export async function recapsDue() {
  if (!recapSettings().on || !plugin.vault.has("recaps")) return
  const now = Date.now(), today = localDate(now)
  const done = written()
  const late = now - bounds(today)[0] < GRACE
  const dirty = recaps.dirty
  const days = dirty ? [today, ...(late ? [dayBefore(today)] : [])] : []
  recaps.dirty = false
  for (let i = late ? 2 : 1; i <= 7; i++) { const d = dayBefore(today, i); if (!done.has(d) && !recapOf(d)) days.push(d) }
  try { for (const d of days) { built.delete(d); await writeRecap(d) } } catch (e) { if (dirty) recaps.dirty = true; throw e }
  markWritten(days.filter((d) => d !== today))
}
plugin.every("recaps", { every: "5m" }, recapsDue)

type RecapDay = { date: string; entries: RecapEntry[]; live: boolean; path?: string }
async function recapDay(date: string): Promise<RecapDay> {
  const today = localDate(Date.now())
  const f = recapOf(date)
  const fresh = date === today || (date === dayBefore(today) && Date.now() - bounds(today)[0] < GRACE)
  if (f && !fresh) return { date, entries: parseRecap(f.body).entries, live: false, path: `${f.id}.md` }
  if (date > today) return { date, entries: [], live: false }
  return { date, entries: await build(date), live: true, ...(f ? { path: `${f.id}.md` } : {}) }
}

async function recapDays(date: string, days: number) {
  const out: RecapDay[] = []
  for (let i = 0; i < days; i++) out.push(await recapDay(dayBefore(date, i)))
  return out
}

const dateOf = (v: unknown) => {
  const s = str(v).toLowerCase()
  if (!s || s === "today") return localDate(Date.now())
  if (s === "yesterday") return dayBefore(localDate(Date.now()))
  if (!DATE.test(s)) throw new HTTPError(400, `a date is YYYY-MM-DD, today or yesterday, not '${v}'`)
  return s
}

plugin.route("GET", "activity/recap", async (req) => ({ days: await recapDays(dateOf(req.query.date), Math.min(31, Math.max(1, Number(req.query.days) || 1))) }), { lock: false })

async function recapCounts(weeks: number) {
  const today = localDate(Date.now())
  const from = dayBefore(today, weeks * 7 - 1)
  const out: Record<string, Partial<Record<RecapGroup, number>>> = {}
  const count = (date: string, entries: RecapEntry[]) => {
    const c: Partial<Record<RecapGroup, number>> = {}
    for (const e of entries) { const g = groupOf(e.kind); if (g) c[g] = (c[g] ?? 0) + Math.max(1, e.items.length) }
    out[date] = c
  }
  for (const r of plugin.vault.has("recaps") ? plugin.vault.items("recaps") : []) {
    if (typeof r.date === "string" && r.date >= from && r.date < today) count(r.date, parseRecap(r.body ?? "").entries)
  }
  count(today, await build(today))
  return { from, to: today, days: out }
}

plugin.route("GET", "activity/recap/counts", async (req) => recapCounts(Math.min(53, Math.max(1, Number(req.query.weeks) || 10))), { lock: false })

const recapText = (days: RecapDay[]) => days.map((d) =>
  `### ${d.date}\n\n${d.entries.length ? renderRecap(d.entries).trim() : "_Nothing recorded._"}`).join("\n\n")

plugin.op({
  id: "activity.recap",
  cli: "recap",
  summary: "What the user did on a day: notes made and changed (with what changed), tasks done or dropped, things captured, logs, agents' sessions.",
  help: `A day's recap, as its Recaps/<date>.md says it (today's made now). Kept in the vault for good; made from this
machine's Activity and File history, so a past day without a file can be made only while those still have it.

  vau recap                      today
  vau recap yesterday
  vau recap 2026-10-06 --days 7  that week, newest first
  vau recap 2026-10-06 --write   write (or refresh) that day's file now`,
  kind: "read",
  params: {
    date: { type: "string", description: "YYYY-MM-DD, today (the default) or yesterday" },
    days: { type: "integer", minimum: 1, maximum: 31, default: 1, description: "how many days, ending with that date" },
    write: { type: "boolean", description: "write that day's Recaps file now (its entries replaced, your lines kept), on the machine that writes them: Machines' first, which runs their job" },
  },
  args: ["date"],
  run: async ({ date, days, write }, ctx) => {
    const d = dateOf(date)
    if (write) {
      const there = await recapWriter()
      if (there) return await writeThere(there, ctx.who.client, { date: d, days: days ?? 1, write: true })
      built.delete(d)
      await writeRecap(d)
    }
    return { days: await recapDays(d, days ?? 1) }
  },
  text: (r: { days: RecapDay[] }) => recapText(r.days),
})

plugin.block("recap", async (ctx) => {
  const o = ctx.options
  const stem = ctx.path.split("/").pop()!.replace(/\.md$/, "")
  const date = typeof o.date === "string" && o.date ? dateOf(o.date) : DATE.test(stem) ? stem : ctx.today
  const days = await recapDays(date, Math.max(1, Number(o.days) || 1))
  return section(typeof o.title === "string" && o.title ? o.title : days.length === 1 ? `What you did on ${date}` : `What you did, the ${days.length} days to ${date}`, recapText(days))
})

plugin.block("recap-stats", async (ctx) => {
  const c = await recapCounts(Math.max(1, Number(ctx.options.weeks) || 10))
  const total = (g: RecapGroup) => Object.values(c.days).reduce((n, d) => n + (d[g] ?? 0), 0)
  const active = Object.values(c.days).filter((d) => Object.values(d).some((n) => n)).length
  return section(`Since ${c.from}`, `${active} days with something done.`, bullets(RECAP_GROUPS.map((g) => total(g.id) ? `${g.label}: ${total(g.id)}` : "")))
})
