// Daily notes, as Obsidian's: a note per day named by a date format (YYYY-MM-DD), in their folder (Daily/, or where
// Obsidian's daily-notes.json says), made from a template. Other plugins may keep keys of their own in them.
import { formatDate, OpError, parseDate, Plugin, today } from "../../../core/plugins.ts"
import { joinPath, Kind, readText, stemOf, str, writeNew } from "../../../core/vault.ts"

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
  if (plugin.vault.get("days", date)) return { path: rel, made: false }
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
  return { path: rel, made }
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
