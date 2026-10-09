// Logs: one file per entry, its area's fields in frontmatter (format: AGENTS.md). Areas are this plugin's settings,
// brought by the plugins that draw them (`log-areas`); POST upserts on (source, ext_id) so imports can rerun.
import { bullets, fmtMin, HTTPError, LOADED, OpError, Plugin, section, source, today, weekStart } from "../../../core/plugins.ts"
import { dirOf, isArchived, type Item, joinPath, Kind, num, safeName, slug, sortBy, str, truthy } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const RESERVED = ["area", "date", "duration_min", "title", "source", "ext_id"]

/** The areas the plugins that are on bring (plugin.provide("log-areas", () => [{slug, name, icon, tint, parent, fields,
 *  weekly_goal, blocks}])), in plugin order; the first to bring a slug wins. */
function brought(): Item[] {
  const skip = plugin.vault.switchedOff()
  const seen = new Set<string>(), out: Item[] = []
  for (const p of LOADED) {
    if (skip.has(p.id) || !Object.hasOwn(p.services, "log-areas")) continue
    let list: unknown
    try { list = p.services["log-areas"]() } catch { continue } // one plugin's areas failing mustn't take the others
    for (const a of Array.isArray(list) ? list : []) {
      if (a && typeof a === "object" && typeof a.slug === "string" && !seen.has(a.slug)) { seen.add(a.slug); out.push(a) }
    }
  }
  return out
}

/** A colour's name (`pink`, or a plugin's: `health`), as a dashboard's `tint:` names one; anything else is none. */
const colour = (v: unknown) => (typeof v === "string" && /^[a-z][a-z-]*$/.test(v) ? v : null)

const title = (s: string) => s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

/** The areas setting (else the areas plugins bring), normalised: [{slug, name, icon, tint, parent, track_duration,
 *  fields, weekly_goal, blocks, archived, link}]. */
export function areas(): Item[] {
  const set = plugin.settings({}).areas
  const theirs = brought()
  const by = new Map(theirs.map((a) => [a.slug, a]))
  return (Array.isArray(set) && set.length ? set : theirs).filter((a: Item) => a && typeof a === "object").map((a: Item) => ({
    slug: a.slug, name: a.name || title(a.slug), icon: a.icon || by.get(a.slug)?.icon || "",
    tint: colour(a.tint) ?? colour(by.get(a.slug)?.tint),
    parent: a.parent ?? null, track_duration: a.track_duration !== false,
    fields: truthy(a.fields) ? a.fields : [], weekly_goal: a.weekly_goal ?? null,
    blocks: (truthy(a.blocks) ? a.blocks : []).filter((b: unknown) => typeof b === "string"), archived: truthy(a.archived),
    link: a.link && typeof a.link === "object" && a.link.url ? { label: str(a.link.label || "Open"), url: str(a.link.url) } : null,
  }))
}

/** The area `given` (a slug, or a name: "Deep work") as its slug, added to the areas setting when it isn't there yet:
 *  a log for a new area makes it (with the areas brought so far, which the setting then lists). */
function ensureArea(given: string): string {
  const known = areas()
  const hit = known.find((a) => a.slug === given) ?? known.find((a) => str(a.name).toLowerCase() === given.toLowerCase())
  if (hit) return hit.slug
  const s = /^[a-z0-9][a-z0-9-]*$/.test(given) ? given : slug(given)
  if (!s) throw new OpError(`'${given}' can't be an area's name`)
  if (known.some((a) => a.slug === s)) return s
  const cur = plugin.settings({}), set = cur.areas
  const list = Array.isArray(set) && set.length ? set : brought()
  plugin.saveSettings({ ...cur, areas: [...list, s === given ? { slug: s } : { slug: s, name: given }] })
  return s
}

function areaName(slug: unknown) {
  return areas().find((a) => a.slug === slug)?.name ?? title(truthy(slug) ? str(slug) : "Other")
}

/** Frontmatter keys that are the core's, never a log's data (core/fileprops.ts). */
const CORE_KEYS = ["type", "archived"]

function parse(fm: Item, body: string, stem: string): [Item, string[]] {
  const problems: string[] = []
  const slugs = new Set(areas().map((a) => a.slug))
  const area = fm.area
  if (!truthy(area)) problems.push("missing `area:`")
  else if (!slugs.has(area)) problems.push(`area \`${str(area)}\` isn't in the areas setting (.vaultite/plugins/logs/data.json)`)
  // Every other key is the log's data, but the core's: `type`, and `archived` (the vault puts it on the item).
  const data: Item = {}
  for (const [k, v] of Object.entries(fm)) if (!RESERVED.includes(k) && !CORE_KEYS.includes(k)) data[k] = v
  return [{
    area: truthy(area) ? area : "", date: truthy(fm.date) ? str(fm.date) : stem.slice(0, 10),
    duration_min: num(fm.duration_min), title: truthy(fm.title) ? str(fm.title) : stem.slice(11),
    notes: body, source: fm.source ?? null, ext_id: fm.ext_id !== undefined && fm.ext_id !== null ? str(fm.ext_id) : null, data,
  }, problems]
}

function render(log: Item): [Item, string] {
  const owned: Item = Object.fromEntries(RESERVED.map((k) => [k, log[k]]))
  for (const [k, v] of Object.entries(log.data ?? {})) if (!RESERVED.includes(k) && !CORE_KEYS.includes(k)) owned[k] = v
  return [owned, log.notes || ""]
}

/** Where a log goes: an existing one stays in its folder unless its area changed; else where that area's logs are, else
 *  a folder named after the area next to the other areas' folders, else Logs/<Area>/. */
function filename(log: Item, at: { folder: string; old: Item | null }) {
  // (only what a file name or a link can't hold goes: an emoji stays)
  const t = safeName(str(log.title).split(/\s+/).filter(Boolean).join(" ") || areaName(log.area))
  const name = `${log.date} ${t || "Log"}`
  if (at.old && at.old.area === log.area) return joinPath(at.folder, name)
  const own = plugin.vault.home("logs", (l) => l.area === log.area)
  if (own !== null) return joinPath(own, name)
  // (the folder set for logs holds the areas' folders; else where most are: an area's folder, or the Logs folder itself)
  const set = plugin.vault.folderSet("logs"), most = set ?? plugin.vault.home("logs")
  const base = set ?? (most === null ? "Logs" : most.split("/").pop() === "Logs" ? most : dirOf(most))
  return joinPath(joinPath(base, safeName(areaName(log.area))), name)
}

plugin.kind(new Kind({
  type: "log", collection: "logs", folder: "Logs", recursive: true, parse, render, filename,
  prepare(log) {
    if (!truthy(log.area) || !/^\d{4}-\d\d-\d\d$/.test(String(log.date ?? ""))) throw new HTTPError(400, "a log needs an area (slug) and a date (YYYY-MM-DD)")
    log.area = ensureArea(str(log.area).trim())
    log.data ??= {}
    return log
  },
  // data is merged, so fields added later (a climbing grade told to Claude) survive a re-import
  merge: (old, patch) => ({ ...old, ...patch, data: { ...(old.data ?? {}), ...(patch.data ?? {}) } }),
  key: (log) => (truthy(log.ext_id) ? JSON.stringify([log.source ?? null, log.ext_id]) : null),
  // Newest day first; within a day, the file changed last first (the entry logged last).
  order: (logs) => sortBy(sortBy(logs, (l) => [l.modified, l.id], true), (l) => l.date, true),
  /** ```block-log, then the area's own blocks (a workout's exercises). */
  blocks: (fm) => ["log", ...(areas().find((a) => a.slug === fm.area)?.blocks ?? [])],
}))

plugin.state(() => ({ areas: areas(), logs: plugin.vault.items("logs") }))
/** The areas as the app has them (Today's routines take their icon and weekly goal). */
plugin.provide("logs:areas", areas)

/** ?from=YYYY-MM-DD&to=...&area=gym (an area includes its sub-areas)&limit=N; archived logs only with &archived=true */
plugin.route("GET", "logs", (req) => {
  const q = req.query
  let out = plugin.vault.items("logs")
  if (q.archived !== "true") out = out.filter((l) => !isArchived(l))
  if ("area" in q) {
    const kids = new Set([q.area, ...areas().filter((a) => a.parent === q.area).map((a) => a.slug)])
    out = out.filter((l) => kids.has(l.area))
  }
  out = out.filter((l) => (q.from ?? "0000") <= l.date && l.date <= (q.to ?? "9999"))
  return out.slice(0, Number(q.limit ?? 100000))
})

// ---------- operations (core/ops.ts): `vau log`, MCP's write_log, POST /api/ops/log.create ----------

/** JSON written as text (the API's: `vau log '<json>'`): an object or a list, else null. */
function jsonOf(v: unknown): unknown {
  if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return null
  try { const o = JSON.parse(v); return o && typeof o === "object" ? o : null } catch { return null }
}

plugin.op({
  id: "log.create",
  cli: "log",
  mcp: "write_log",
  summary: "Log something the user did (a workout, a night's sleep, a meal, a study session, a work conversation) in Logs/<Area>/.",
  help: `One log file per thing done (Logs/<Area>/<date> <title>.md, or where that area's logs are). It upserts on its
source and id (default: <area>-<date>-<title as a slug>), so logging it again with the same id corrects it, its data
merged. The area's fields (and anything else) go in data, or as parameters of their own (--kcal 650, numbers as
numbers); estimates are fine for a meal (kcal, protein, carbs, fat). The date is the user's local date (default today);
the source, who logged it (you). Areas and their fields: vau docs logs, or .vaultite/plugins/logs/data.json; an area
that isn't there yet is added to them (use the existing one when it's the same thing). The API's JSON (a log, or a list
of them) as the one argument works too.

  vau log "Chicken rice bowl" --area nutrition --meal Lunch --kcal 650 --protein 45
  vau log "Bouldering" --area workouts --duration 120 --kind Climbing --top_grade V3
  vau log '{"area":"study","title":"Read about CRDTs","duration_min":90,"data":{"subject":"CRDTs"}}'`,
  kind: "write",
  params: {
    area: { type: "string", description: "the area's slug: workouts, sleep, nutrition, reading, study, work... (the vault's own)" },
    title: { type: "string", description: "a short title (\"Upper body\", \"Chicken rice bowl\")" },
    date: { type: "string", format: "date", description: "YYYY-MM-DD, the user's local date (default today)" },
    duration_min: { type: "number", description: "how long, in minutes" },
    duration: { type: "number", description: "the same as duration_min (vau's --duration)" },
    data: { type: "object", description: "the area's fields and anything else: {\"meal\": \"Lunch\", \"kcal\": 650, \"protein\": 45}" },
    notes: { type: "string", description: "notes about it (the file's Markdown body)" },
    id: { type: "string", description: "a stable id, to correct it later (default <area>-<date>-<title as a slug>)" },
    extId: { type: "string", description: "the same as id (vau's --ext-id)" },
    source: { type: "string", description: "who logged it; default: the caller (claude, codex, cli...)" },
  },
  args: ["title"],
  rest: "data",
  run: async (p, ctx) => {
    const json = jsonOf(p.title)
    const given: Item[] = json ? (Array.isArray(json) ? json : [json]) as Item[]
      : [{ area: p.area, title: p.title, date: p.date, duration_min: p.duration_min ?? p.duration, data: p.data, notes: p.notes, ext_id: p.id ?? p.extId, source: p.source }]
    const logs = given.map((x) => {
      if (!x || typeof x !== "object" || Array.isArray(x)) throw new OpError("a log is an object: {area, title, date, ...}")
      const title = str(x.title).trim()
      if (!str(x.area).trim()) throw new OpError("area is missing: the area's slug (workouts, sleep, nutrition...)")
      if (!title) throw new OpError("title is missing: a short title")
      const area = ensureArea(str(x.area).trim())
      const date = str(x.date).trim() || today()
      if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new OpError(`date is YYYY-MM-DD (got '${date}')`)
      const id = str(x.ext_id).trim() || `${area}-${date}-${slug(title)}`
      // Corrected by another AI than the one that logged it (no source given): the same log, not a second one.
      const before = str(x.source).trim() ? [] : plugin.vault.items("logs").filter((l) => l.ext_id === id && l.area === area)
      const log: Item = { ...x, area, title, date, source: str(x.source).trim() || (before.length === 1 ? before[0].source : null) || ctx.who.source, ext_id: id }
      for (const k of Object.keys(log)) if (log[k] === undefined || log[k] === null) delete log[k]
      if (log.data && (typeof log.data !== "object" || Array.isArray(log.data) || !Object.keys(log.data).length)) delete log.data
      if (typeof log.notes === "string") log.notes = log.notes.trim()
      return log
    })
    const r = await ctx.api("POST", "logs", logs)
    return { logs: logs.map((l, i) => ({ path: r.ids?.[i] ? `${r.ids[i]}.md` : null, id: l.ext_id, title: l.title, date: l.date })) }
  },
  text: (r) => r.logs.length === 1
    ? `Logged ${r.logs[0].path ?? `${r.logs[0].title} on ${r.logs[0].date}`} (id: ${r.logs[0].id}).`
    : `Logged ${r.logs.length}: ${r.logs.map((l: Item) => l.path ?? l.title).join(", ")}.`,
})

// ---------- blocks as text (GET /api/render) ----------

/** An area's logs (its sub-areas' too), archived ones left out. */
function ofArea(slug: string) {
  const kids = new Set([slug, ...areas().filter((a) => a.parent === slug).map((a) => a.slug)])
  return plugin.vault.items("logs").filter((l) => kids.has(l.area) && !isArchived(l))
}

const list = (v: unknown) => (Array.isArray(v) ? v : str(v).split(",")).map((x) => str(x).trim()).filter(Boolean)
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

plugin.block("log", (ctx) => {
  const l = plugin.vault.items("logs").find((x) => x.id + ".md" === ctx.path)
  if (!l) return ""
  const rows = [l.duration_min ? `Duration: ${fmtMin(l.duration_min)}` : ""]
  for (const [k, v] of Object.entries(l.data ?? {})) {
    if (v !== null && v !== "" && typeof v !== "object") rows.push(`${capitalize(k.replaceAll("_", " "))}: ${str(v)}`)
  }
  return bullets([...rows, ...(l.source ? [`Source: ${l.source}`] : [])], "No fields.")
})

plugin.block("week-goals", (ctx) => {
  const t = ctx.today, o = ctx.options
  let slugs = list(o.areas)
  if (!slugs.length) slugs = areas().filter((a) => a.weekly_goal).map((a) => a.slug)
  const ws = weekStart(t), rows: string[] = []
  for (const slug of slugs) {
    const a = areas().find((x) => x.slug === slug)
    if (!a || a.archived) continue
    const logs = ofArea(slug).filter((l) => ws <= l.date && l.date <= t)
    ctx.source(logs)
    const n = new Set(logs.map((l) => l.date)).size
    const mins = logs.reduce((s, l) => s + (l.duration_min || 0), 0)
    const goal = a.weekly_goal ? `${n} of ${a.weekly_goal}` : `${n} ${n === 1 ? "session" : "sessions"}`
    rows.push(`${a.name}: ${goal}${mins ? ` (${fmtMin(mins)})` : ""}`)
  }
  return section(truthy(o.title) ? str(o.title) : "This week", bullets(rows, "No weekly goals."))
})

plugin.block("area", (ctx) => {
  const o = ctx.options, t = ctx.today
  const slug = truthy(o.area) ? str(o.area) : ""
  if (!slug) return ""
  return areaSummary(slug, t, list(o.meta), undefined, 5, truthy(o.total) ? str(o.total) : null)
})

/** A field's value as text: a number with its unit (minutes as 1 h 30 min), anything else as it is. */
function fieldText(v: unknown, unit?: unknown) {
  if (typeof v !== "number") return v === null || v === undefined || typeof v === "object" ? "" : str(v)
  if (unit === "min") return fmtMin(v)
  return `${(Math.round(v * 10) / 10).toLocaleString("en-US")}${truthy(unit) ? ` ${str(unit)}` : ""}`
}

/** An area's week and its latest sessions, as text. `meta`: fields shown on each (topic); `extra(log)`: more;
 *  `total`: a number field summed over the week (pages). */
export function areaSummary(slug: string, today: string, meta: string | string[] | null = null, extra?: (log: Item) => string,
  n = 5, total: string | null = null) {
  const a = areas().find((x) => x.slug === slug) ?? { name: slug, weekly_goal: null, track_duration: true, fields: [] }
  const fields = new Map<string, Item>(((a.fields ?? []) as Item[]).filter((f) => f && typeof f === "object").map((f) => [str(f.key), f]))
  const metas = meta === null ? [] : Array.isArray(meta) ? meta : [meta]
  const logs = ofArea(slug)
  if (!logs.length) return section(a.name, `_No ${String(a.name).toLowerCase()} logged yet._`)
  const ws = weekStart(today)
  const week = logs.filter((l) => ws <= l.date && l.date <= today)
  const days = new Set(week.map((l) => l.date)).size
  const mins = week.reduce((s, l) => s + (l.duration_min || 0), 0)
  let head = `This week: ${mins && a.track_duration ? fmtMin(mins) + ", " : ""}${days} ${days === 1 ? "day" : "days"}` +
    (a.weekly_goal ? ` of ${a.weekly_goal}` : "") + "."
  if (total) {
    const f = fields.get(total)
    const sum = week.reduce((s, l) => s + (Number((l.data ?? {})[total]) || 0), 0)
    head += ` ${truthy(f?.label) ? str(f!.label) : capitalize(total.replaceAll("_", " "))}: ${fieldText(sum, f?.unit)}.`
  }
  source(week, logs.slice(0, n))
  const rows = logs.slice(0, n).map((l) => {
    const bits = [l.title, l.duration_min ? fmtMin(l.duration_min) : "",
      ...metas.map((k) => fieldText((l.data ?? {})[k] || "", fields.get(k)?.unit)), extra ? extra(l) : ""].filter(Boolean)
    return `${l.date}: ${bits.join(" · ") || "Session"}`
  })
  return section(a.name, head, "Latest:\n" + bullets(rows))
}

plugin.exports.areaSummary = areaSummary // for plugins that require Logs (Health's workouts)
