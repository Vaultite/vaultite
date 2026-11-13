import { formatDate, Plugin } from "../../../core/plugins.ts"
import { fillVars, FORMATS, fromTemplate } from "./fill.ts"

export const plugin = new Plugin(import.meta.url)

export function folder() {
  const f = plugin.seeded().folder
  return typeof f === "string" && f.trim() ? f.trim().replace(/^\/+|\/+$/g, "") : "Templates"
}

const format = (key: string, d: string) => { const f = plugin.seeded()[key]; return typeof f === "string" && f.trim() ? f : d }

plugin.route("GET", "templates", () => ({ folder: folder(), dateFormat: format("dateFormat", "YYYY-MM-DD"), timeFormat: format("timeFormat", "HH:mm") }))

/** Its folder's notes are patterns: the vault never reads them as items (a `type: person` template isn't a person). */
plugin.provide("templates:folder", folder)

/** Service `template:expand` gets {text, template, path, mode} and the request; answers {text, path?, notice?}, null if cancelled. */
plugin.route("POST", "templates/expand", (req) => {
  const fn = plugin.service("template:expand")
  return fn ? fn(req.body, req) : { text: req.body.text }
}, { lock: false })

/** A template's text as a new note's, its frontmatter merged into `into`'s (whose keys win); `now` is {{date}}. */
plugin.exports.fill = (text: string, title: string, into = "", now = new Date()) =>
  fromTemplate(fillVars(text, title, formatDate, now, { date: format("dateFormat", FORMATS.date), time: format("timeFormat", FORMATS.time) }), into)
