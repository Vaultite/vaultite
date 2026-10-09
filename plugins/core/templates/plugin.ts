// Templates' server side: which folder it is, so the vault never reads the notes there as people or logs
// (`templates:folder`), and the hook other plugins expand templates through (`template:expand`); the app does the rest.
import { formatDate, Plugin } from "../../../core/plugins.ts"
import { fillVars, FORMATS, mergeFm } from "./fill.ts"

export const plugin = new Plugin(import.meta.url)

/** The templates folder, without slashes at either end (Obsidian's templates.json's when unset: plugin.seeded). */
export function folder() {
  const f = plugin.seeded().folder
  return typeof f === "string" && f.trim() ? f.trim().replace(/^\/+|\/+$/g, "") : "Templates"
}

/** A format setting, or its default. */
const format = (key: string, d: string) => { const f = plugin.seeded()[key]; return typeof f === "string" && f.trim() ? f : d }

plugin.route("GET", "templates", () => ({ folder: folder(), dateFormat: format("dateFormat", "YYYY-MM-DD"), timeFormat: format("timeFormat", "HH:mm") }))

/** Its folder's notes are patterns: the vault never reads them as items (a `type: person` template isn't a person). */
plugin.provide("templates:folder", folder)

/** Other plugins expand a template further (Templater's `<% %>`): the service `template:expand` gets {text, template,
 *  path, mode: "new" | "insert"} and the request, and answers {text, path?, notice?} (path: where the note goes now),
 *  or null when the user cancelled. Without one the text is as it was. */
plugin.route("POST", "templates/expand", (req) => {
  const fn = plugin.service("template:expand")
  return fn ? fn(req.body, req) : { text: req.body.text }
}, { lock: false })

const FM = /^---\n[\s\S]*?\n---[ \t]*\n?/
/** A template's text as a note's, as the app makes it (fill.ts), its frontmatter merged into `into`'s (a new file's
 *  own keys win): for plugins that make notes on the server. `now`: what {{date}} is (a daily note's day). */
plugin.exports.fill = (text: string, title: string, into = "", now = new Date()) => {
  const t = fillVars(text, title, formatDate, now, { date: format("dateFormat", FORMATS.date), time: format("timeFormat", FORMATS.time) })
  const fm = FM.exec(t)?.[0] ?? "", own = FM.exec(into)?.[0] ?? ""
  return (fm ? mergeFm(own, fm) : own) + t.slice(fm.length).replace(/^\n+/, "")
}
