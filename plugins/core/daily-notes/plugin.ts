// Daily notes, as Obsidian's: a note per day named by a date format (YYYY-MM-DD), in their folder (Daily/, or where
// Obsidian's daily-notes.json says), made from a template. Other plugins may keep keys of their own in them.
import { formatDate, OpError, parseDate, Plugin, section, today } from "../../../core/plugins.ts"
import { type Entry, extract, fetchFromICloud, joinPath, Kind, readText, setPropertyText, stemOf, str, writeNew } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const ISO = /^\d{4}-\d\d-\d\d$/
/** The settings (Obsidian's daily-notes.json under them: plugin.seeded) and the folder set (Vault.folderSet), read
 *  again when settings change; `named` remembers which paths are daily notes by their name. */
let spec: { version: number; format: string; template: string; folder: string | null; named: Map<string, boolean> } | null = null
function dailySpec() {
  if (spec?.version !== plugin.vault.settingsVersion) {
    const s = plugin.seeded(), text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
    spec = { version: plugin.vault.settingsVersion, format: text(s.format) || "YYYY-MM-DD",
      template: text(s.template).replace(/^\/+/, "").replace(/\.md$/i, ""), folder: plugin.vault.folderSet("days"), named: new Map() }
  }
  return spec
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
  parse: (_fm, body, stem) => {
    const format = dailySpec().format, last = format.slice(format.lastIndexOf("/") + 1)
    const date = dateIn(stem, last) ?? (ISO.test(stem) ? stem : null)
    return [{ date: date ?? stem, body }, date ? [] : [`a daily note's name is its date, written ${last}`]]
  },
  // (owns no keys: what other plugins keep in a day's note stays as it is)
  render: (d) => [{}, d.body || ""],
  filename: (d, at) => (at.old ? joinPath(at.folder, stemOf(at.old.id)) : joinPath(plugin.vault.home("days") ?? "Daily", dailyName(str(d.date)))),
  key: (d) => d.date ?? null,
}))

// The day notes' text isn't app data: /api/state sends none of them.
plugin.state(() => ({}))

/** A date's daily note's path, made or not. */
function dayPath(date: string) {
  const d = plugin.vault.get("days", date)
  return d ? `${d.id}.md` : `${joinPath(plugin.vault.home("days") ?? "Daily", dailyName(date))}.md`
}

/** A date's daily note, made where they go (from their template, with `type: day` unless their folder finds them) when
 *  there's none yet. Its path, and whether it was made. */
async function dailyNote(date: string): Promise<{ path: string; made: boolean }> {
  const rel = dayPath(date)
  if (plugin.vault.get("days", date)) { await mergeCopies(rel); return { path: rel, made: false } }
  const { template, folder } = dailySpec()
  const name = dailyName(date)
  const own = folder === null ? "---\ntype: day\n---\n" : ""
  let text = own ? `${own}\n` : ""
  if (template) {
    const t = plugin.vault.entries.has(`${template}.md`) ? readText(plugin.vault.abs(`${template}.md`)) : null
    if (t === null) throw new OpError(`the daily notes' template ${template}.md isn't there: set another in Daily notes' settings`)
    const fill = plugin.peer("templates")?.exports.fill as ((text: string, title: string, into?: string, now?: Date) => string) | undefined
    text = fill ? fill(t, name.split("/").pop()!, own, dayOf(date)) : t
  }
  const made = writeNew(plugin.vault.abs(rel), text)
  await plugin.vault.sync()
  if (!made && !plugin.vault.get("days", date)) {
    // Another file there: a second one would be iCloud's "2026-10-08 2" when it's this note still on its way.
    if (plugin.vault.entries.has(rel)) throw new OpError(`${rel} is there but isn't a daily note (its type: ${plugin.vault.entries.get(rel)!.fm.type})`, 409)
    fetchFromICloud(plugin.vault.abs(rel), { errno: 11 })
    throw new OpError(`${rel} is still coming from iCloud: try again in a moment`, 503)
  }
  return { path: rel, made }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** iCloud's copies of a day's note two Macs made at once ("2026-10-08 2.md" beside it): merged into it and archived
 *  when nothing would be lost (no text of their own, properties that agree or are lists), else left for the user. */
async function mergeCopies(rel: string) {
  const v = plugin.vault, stem = rel.slice(0, -3)
  for (let n = 1; n < 10; n++) {
    const copy = v.entries.get(`${stem} ${n}.md`), e = v.entries.get(rel)
    if (!copy || !e || (copy.kind ? copy.kind.collection !== "days" : !!copy.fm.type)) continue
    const text = readText(v.abs(rel)), next = merged(text, e, copy)
    if (next === null) continue
    if (next !== text) await plugin.host.api("PUT", "file", { path: rel, text: next, base: text })
    await plugin.runOp("archive.add", { path: copy.rel })
  }
}
/** The note's text with a copy's properties added in, or null when the copy holds what the note doesn't. */
function merged(text: string, e: Entry, copy: Entry): string | null {
  const body = copy.body.trim()
  if (body && !e.body.includes(body)) return null
  let out: string | null = text
  for (const [k, val] of Object.entries(copy.fm)) {
    const cur = e.fm[k]
    if (same(cur, val) || k === "archived") continue
    const next = cur === undefined || cur === null || cur === "" ? val
      : Array.isArray(cur) && Array.isArray(val) ? [...cur, ...val.filter((x) => !cur.some((y) => same(x, y)))] : undefined
    if (next === undefined || (out = setPropertyText(out, k, next)) === null) return null
  }
  return out
}

// For plugins that require this one (to write in a day's note).
plugin.exports = { note: dailyNote, path: dayPath }

plugin.op({
  id: "daily-note.open",
  cli: "daily",
  summary: "A day's daily note (today's by default): its path, made when there's none yet, where daily notes go and from their template.",
  help: `Daily notes are named by their date in a format (YYYY-MM-DD), in their folder, made from a template: Daily notes'
settings (Obsidian's .obsidian/daily-notes.json when they're unset). A note named that way in that folder is one, with
or without \`type: day\`.

  vau daily
  vau daily --date 2026-09-29`,
  kind: "write",
  params: { date: { type: "string", format: "date", description: "YYYY-MM-DD, the user's local date (default today)" } },
  run: async ({ date }) => dailyNote(date || today()),
  text: (r) => `${r.made ? "Made" : "There's"} ${r.path}.`,
})

/** A day's note as the `day` block finds it: its path, and whether it's there. Never makes one. */
plugin.route("GET", "daily-notes/day", (req) => {
  const date = ISO.test(req.query.date ?? "") ? req.query.date : today()
  return { date, path: dayPath(date), exists: !!plugin.vault.get("days", date) }
})

/** "Plan" or "## Plan": the heading a `day` block shows. */
const headingOf = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^#+\s*/, "") : "")

plugin.block("day", (ctx) => {
  const date = typeof ctx.options.date === "string" && ISO.test(ctx.options.date) ? ctx.options.date : ctx.today
  const heading = headingOf(ctx.options.section), d = plugin.vault.get("days", date)
  const title = `${heading || "Daily note"} · ${date}`
  if (!d) return section(title, `_No daily note for ${date} yet (\`vau daily --date ${date}\` makes it)._`)
  const rel = `${d.id}.md`
  ctx.source(rel)
  const part = extract(str(d.body), heading)
  if (part === null) return section(`${title} (${rel})`, `_No heading ${heading} in it._`)
  // (a section's own heading is the title already)
  const lines = (heading ? part.split("\n").slice(1).join("\n") : part).trim()
  return section(`${title} (${rel})`, lines || "_Empty._")
})
