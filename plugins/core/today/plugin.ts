// Today: routines (Routines/) and daily notes (Daily/, or where Obsidian's daily-notes.json says), `done:` listing
// routines ticked by hand. Routines tied to data tick themselves in the app, so nothing is written for those.
import fs from "node:fs"
import { addDays, bullets, formatDate, HTTPError, OpError, parseDate, Plugin, section, today, weekStart } from "../../../core/plugins.ts"
import { isArchived, type Item, joinPath, Kind, num, readText, sortBy, splitTags, stemOf, str, truthy, writeNew } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const BED = /^bed before (\d\d:\d\d)$/

function parseRoutine(fm: Item, body: string, stem: string): [Item, string[]] {
  const problems: string[] = []
  let days = "0123456"
  if (truthy(fm.days)) {
    const picked = splitTags(fm.days).map((d) => d.slice(0, 3).toLowerCase())
    const bad = picked.filter((d) => !DAYS.includes(d))
    if (bad.length) problems.push(`days must be weekday names (mon, tue...), not [${bad.map((d) => `'${d}'`).join(", ")}]`)
    days = DAYS.filter((d) => picked.includes(d)).map((d) => String(DAYS.indexOf(d))).join("") || days
  }
  let auto = truthy(fm.auto) ? str(fm.auto) : ""
  const bed = BED.exec(auto)
  if (auto === "log") auto = "logs"
  else if (bed) auto = "bed<" + bed[1]
  else if (auto) {
    problems.push("auto must be `log` or `bed before HH:MM`")
    auto = ""
  }
  return [{
    name: truthy(fm.name) ? str(fm.name) : stem, area: truthy(fm.area) ? fm.area : null, icon: truthy(fm.icon) ? str(fm.icon) : "", days, auto,
    sort: num(fm.sort) || 0, notes: body,
  }, problems]
}

function renderRoutine(r: Item): [Item, string] {
  const days = r.days || "0123456"
  const auto = r.auto || ""
  return [{
    area: r.area, icon: r.icon || null, days: days === "0123456" ? null : [...days].map((d) => DAYS[Number(d)]),
    auto: auto === "logs" ? "log" : auto.startsWith("bed<") ? `bed before ${auto.slice(4)}` : null,
    sort: r.sort,
  }, r.notes || ""]
}

plugin.kind(new Kind({
  type: "routine", collection: "routines", folder: "Routines", titleKey: "name", parse: parseRoutine, render: renderRoutine,
  key: (r) => str(r.name).toLowerCase(), order: (rs) => sortBy(rs, (r) => [r.sort, r.name]),
}))

// ---------- daily notes: named by a date format (YYYY-MM-DD), in their folder, made from a template

const ISO = /^\d{4}-\d\d-\d\d$/
/** The settings (Obsidian's daily-notes.json under them: plugin.seeded) and the folder set (Vault.folderSet), read
 *  again when settings change; `named` remembers which paths are daily notes by their name. */
let daily: { version: number; format: string; template: string; folder: string | null; named: Map<string, boolean> } | null = null
function dailySpec() {
  if (daily?.version !== plugin.vault.settingsVersion) {
    const s = plugin.seeded(), text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
    daily = { version: plugin.vault.settingsVersion, format: text(s.format) || "YYYY-MM-DD",
      template: text(s.template).replace(/^\/+/, "").replace(/\.md$/i, ""), folder: plugin.vault.folderSet("days"), named: new Map() }
  }
  return daily
}
/** A YYYY-MM-DD as a local date at noon (so formats never see another day). */
const dayOf = (date: string) => new Date(`${date}T12:00:00`)
/** The date a daily note's name (its path in the folder, without .md) writes in the format, or null. */
function dateIn(name: string, format: string) {
  const d = parseDate(name, format)
  return d ? formatDate(d, "YYYY-MM-DD") : null
}
/** A daily note's name for a date: its path in the daily notes' folder, without .md (the format may make folders). */
const dailyName = (date: string) => formatDate(dayOf(date), dailySpec().format)

plugin.kind(new Kind({
  type: "day", collection: "days", folder: "Daily", label: "Daily notes",
  // (a note without a type is one by its name, in the folder set for them: as in Obsidian)
  owns: (rel) => {
    const { folder, format, named } = dailySpec()
    if (folder === null || !rel.endsWith(".md") || (folder && !rel.startsWith(`${folder}/`))) return false
    let hit = named.get(rel)
    if (hit === undefined) named.set(rel, hit = dateIn(rel.slice(folder ? folder.length + 1 : 0, -3), format) !== null)
    return hit
  },
  parse: (fm, body, stem) => {
    const format = dailySpec().format, last = format.slice(format.lastIndexOf("/") + 1)
    const date = dateIn(stem, last) ?? (ISO.test(stem) ? stem : null)
    return [{ date: date ?? stem, done: splitTags(fm.done), body }, date ? [] : [`a daily note's name is its date, written ${last}`]]
  },
  render: (d) => [{ done: d.done || [] }, d.body || ""],
  filename: (d, at) => (at.old ? joinPath(at.folder, stemOf(at.old.id)) : joinPath(plugin.vault.home("days") ?? "Daily", dailyName(str(d.date)))),
  key: (d) => d.date ?? null,
}))

/** A date's daily note, made where they go (from their template, with `type: day` unless their folder finds them) when
 *  there's none yet. Its path, and whether it was made. */
async function dailyNote(date: string): Promise<{ path: string; made: boolean }> {
  const d = plugin.vault.get("days", date)
  if (d) return { path: `${d.id}.md`, made: false }
  const { template, folder } = dailySpec()
  const name = dailyName(date), rel = `${joinPath(plugin.vault.home("days") ?? "Daily", name)}.md`
  const own = folder === null ? "---\ntype: day\n---\n" : ""
  let text = own ? `${own}\n` : ""
  if (template) {
    const t = plugin.vault.entries.has(`${template}.md`) ? readText(plugin.vault.abs(`${template}.md`)) : null
    if (t === null) throw new OpError(`the daily notes' template ${template}.md isn't there: set another in Today's settings`)
    const fill = plugin.peer("templates")?.exports.fill as ((text: string, title: string, into?: string, now?: Date) => string) | undefined
    text = fill ? fill(t, name.split("/").pop()!, own, dayOf(date)) : t
  }
  const made = writeNew(plugin.vault.abs(rel), text)
  await plugin.vault.sync()
  return { path: rel, made }
}

plugin.state(() => {
  const routines = plugin.vault.items("routines")
  const ids = new Map(routines.map((r) => [r.name.toLowerCase(), r.id]))
  const checks = plugin.vault.items("days").flatMap((d) =>
    (d.done as string[]).filter((n) => ids.has(n.toLowerCase())).map((n) => ({ routine: ids.get(n.toLowerCase()), date: d.date })))
  return { routines, checks }
})

/** {"routine": "Stretch" (name or id), "date": "2026-09-29", "done": true}: ticks it in that day's note. */
plugin.route("POST", "checks", async (req) => {
  const r = plugin.vault.get("routines", req.body.routine)
  const date = str(req.body.date)
  if (!r || !/^\d{4}-\d\d-\d\d$/.test(date)) throw new HTTPError(400, "need a routine (its name) and a date (YYYY-MM-DD)")
  // (a new day's note is made first: from its template, where daily notes go)
  if (req.body.done && !plugin.vault.get("days", date)) await dailyNote(date)
  const day = plugin.vault.get("days", date) ?? { date, done: [], body: "" }
  const done = (day.done as string[]).filter((n) => n.toLowerCase() !== r.name.toLowerCase())
  if (req.body.done) done.push(r.name)
  if (!done.length && !day.body && day.id) {
    // Nothing left in the note: remove it rather than keep an empty file.
    const rel = day.id + ".md"
    const entry = plugin.vault.entries.get(rel)
    if (entry && Object.keys(entry.fm).every((k) => k === "type" || k === "done")) {
      fs.rmSync(plugin.vault.abs(rel))
      await plugin.vault.sync()
      refreshWidgets()
      return { ok: true }
    }
  }
  await plugin.vault.save("days", { ...day, done }, day.id)
  refreshWidgets()
  return { ok: true }
})

/** The phone's routines widget shows it now (the inbox's widget push), not at its next refresh. */
const refreshWidgets = () => { try { plugin.service("widgets:refresh")?.() } catch { /* no push here */ } }

// ---------- operations (core/ops.ts): `vau today`, ticking a routine

/** The Today page, wherever the user keeps it. */
function todayPage() {
  const es = [...plugin.vault.entries.values()].filter((e) => stemOf(e.rel) === "Today")
  return es.find((e) => e.fm.type === "dashboard") ?? es[0]
}

plugin.op({
  id: "today.render",
  cli: "today",
  mcp: "today",
  summary: "What's on today: the Today page as text, its routines, agenda and goals filled in (like render Today).",
  help: "The Today dashboard, wherever the user keeps it, as the user sees it now.\n\n  vau today",
  kind: "read",
  run: async (_p, ctx) => {
    const page = todayPage()
    if (!page) throw new OpError("there's no Today page in this vault (its dashboard was deleted or renamed)", 404)
    return { path: page.rel, text: String(await ctx.api("GET", `render?path=${encodeURIComponent(page.rel)}`)) }
  },
  text: (r) => r.text.trimEnd(),
})

plugin.op({
  id: "today.daily",
  cli: "daily",
  summary: "A day's daily note (today's by default): its path, made when there's none yet, where daily notes go and from their template.",
  help: `Daily notes are named by their date in a format (YYYY-MM-DD), in their folder, made from a template: Today's
settings (Obsidian's .obsidian/daily-notes.json when they're unset). A note named that way in that folder is one, with
or without \`type: day\`.

  vau daily
  vau daily --date 2026-09-29`,
  kind: "write",
  params: { date: { type: "string", format: "date", description: "YYYY-MM-DD, the user's local date (default today)" } },
  run: async ({ date }) => dailyNote(date || today()),
  text: (r) => `${r.made ? "Made" : "There's"} ${r.path}.`,
})

plugin.op({
  id: "routine.check",
  cli: "routine check",
  mcp: "check_routine",
  summary: "Tick a routine as done for a day (or untick it), in that day's daily note.",
  help: `Routines tied to data tick themselves (a log in their area that day, in bed before a time): tick only the others.
The routine by its name (any case); the day's note (Daily/<date>.md) gets it in its \`done\` list.

  vau routine check Stretch
  vau routine check "Journal" --date 2026-09-29
  vau routine check Stretch --done false`,
  kind: "write",
  params: {
    routine: { type: "string", required: true, description: "the routine's name (Routines/<Name>.md)" },
    date: { type: "string", format: "date", description: "YYYY-MM-DD, the user's local date (default today)" },
    done: { type: "boolean", default: true, description: "false unticks it" },
  },
  args: ["routine"],
  action: { on: ["routine"], param: "routine", from: "name", label: "Tick for today", icon: "circle-check" },
  run: async ({ routine, date, done }, ctx) => {
    const r = plugin.vault.get("routines", routine)
    if (!r) throw new OpError(`no routine '${routine}': ${plugin.vault.items("routines").map((x) => x.name).join(", ") || "there are none yet"}`)
    const day = date || today()
    await ctx.api("POST", "checks", { routine: r.name, date: day, done })
    return { routine: r.name, date: day, done }
  },
  text: (r) => `${r.done ? "Ticked" : "Unticked"} ${r.routine} for ${r.date}.`,
})

plugin.op({
  id: "routine.list",
  cli: "routine list",
  mcp: "routines",
  summary: "The routines and which are done, a day and its week (Monday first): the iPhone's routines widget reads it.",
  help: `page: the Today page (the widget opens it). Each: on (it applies that weekday), done (that day), week (done each day of the week), target (a week's goal),
icon (its own or its area's: a Lucide name or an emoji), ticked (by hand that day), auto (it ticks itself from the
data too).

  vau routine list
  vau routine list --date 2026-09-29`,
  kind: "read",
  params: { date: { type: "string", format: "date", description: "YYYY-MM-DD, the user's local date (default today)" } },
  run: async ({ date }) => {
    const day = date || today()
    const weekday = String((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7)
    const start = weekStart(day)
    const week = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(start, k))
    const ticked = new Map(plugin.vault.items("days").map((d) => [d.date, new Set((d.done as string[]).map((n) => n.toLowerCase()))]))
    const logs = plugin.vault.has("logs") ? plugin.vault.items("logs") : []
    const areas = new Map(((plugin.service("logs:areas")?.() ?? []) as Item[]).map((a) => [a.slug, a]))
    const routines = plugin.vault.items("routines").filter((r) => !isArchived(r)).map((r) => ({
      name: r.name, area: r.area ?? null, icon: r.icon || str(areas.get(r.area)?.icon ?? ""), auto: !!r.auto,
      on: r.days.includes(weekday), done: doneOn(r, day, ticked, logs), ticked: !!ticked.get(day)?.has(r.name.toLowerCase()),
      week: week.map((d) => d <= day && doneOn(r, d, ticked, logs)), days: r.days,
      target: r.auto === "logs" && areas.get(r.area)?.weekly_goal ? Number(areas.get(r.area)!.weekly_goal) : 7,
    }))
    return { date: day, week_start: start, page: todayPage()?.rel ?? null, routines }
  },
  text: (r) => bullets(r.routines.filter((x: Item) => x.on).map((x: Item) => `[${x.done ? "x" : " "}] ${x.name} (${x.week.filter(Boolean).length} of ${x.target} this week)${x.auto ? ", ticks itself" : ""}`), "No routines that day."),
})

// ---------- blocks as text (GET /api/render) ----------

/** Ticked by hand (that day's note), or by the data: a log in its area that day, or in bed before HH:MM. */
function doneOn(r: Item, date: string, ticked: Map<string, Set<string>>, logs: Item[]) {
  if (ticked.get(date)?.has(r.name.toLowerCase())) return true
  if (r.auto === "logs") return logs.some((l) => l.area === r.area && l.date === date)
  if (r.auto.startsWith("bed<")) {
    const night = logs.find((l) => l.area === r.area && l.date === addDays(date, 1))
    const bed = str(night?.data?.bed || "")
    return !!bed && "12:00" <= bed && bed < r.auto.slice(4)
  }
  return false
}

plugin.block("routines", (ctx) => {
  const t = ctx.today
  const days = plugin.vault.items("days")
  const ticked = new Map(days.map((d) => [d.date, new Set((d.done as string[]).map((n) => n.toLowerCase()))]))
  const logs = plugin.vault.has("logs") ? plugin.vault.items("logs") : []
  const goals = new Map(((plugin.peer("logs")?.settings().areas || []) as Item[]).map((a) => [a.slug, a.weekly_goal]))
  const week = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(weekStart(t), k)).filter((d) => d <= t)
  // (this week's daily notes, today's first: what's ticked)
  ctx.source(sortBy(days.filter((d) => week.includes(d.date)), (d) => d.date, true))
  const rows: string[] = []
  for (const r of plugin.vault.items("routines")) {
    if (isArchived(r)) continue
    ctx.source(r)
    const n = week.filter((d) => doneOn(r, d, ticked, logs)).length
    const target = r.auto === "logs" && goals.get(r.area) ? goals.get(r.area) : 7
    rows.push(`[${doneOn(r, t, ticked, logs) ? "x" : " "}] ${r.name} (${n} of ${target} this week)`)
  }
  return section("Routines", "Today, and this week so far:", bullets(rows, "No routines."))
})
