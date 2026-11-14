import { z } from "zod"
import { HTTPError, type Plugin } from "../../../core/plugins.ts"
import { formatSources, linksOf, noteAnswer, rowOf, searchRows, shownEntries } from "./answers.ts"
import { lookup } from "./library.ts"
import type { References } from "./refs.ts"
import { statusOf } from "./status.ts"
import { styleChoices } from "./styles.ts"
import { cayw } from "./zotero/bbt.ts"
import { LOCAL_URL } from "./zotero/source.ts"

const Cite = z.object({ path: z.string().catch(""), sources: z.array(z.string()).max(2000).catch([]) })

export function referencesRoutes(plugin: Plugin, refs: References) {
  plugin.route("GET", "references/search", (req) => ({ results: searchRows(refs, req.query.q ?? "", req.query.path ?? "", Math.min(100, Number(req.query.limit) || 30)) }))

  plugin.route("GET", "references/note", async (req) => {
    const path = String(req.query.path ?? "")
    if (refs.host.textOf(path) === null) throw new HTTPError(404, `no note ${path}`)
    return noteAnswer(refs.library(path), await refs.formatNote(path))
  })

  plugin.route("POST", "references/cite", async (req) => {
    const b = Cite.parse(req.body ?? {})
    return formatSources(refs, b.path, b.sources)
  })

  plugin.route("GET", "references/entry", async (req) => {
    const key = String(req.query.key ?? ""), path = String(req.query.path ?? "")
    const lib = refs.library(path)
    const e = lookup(lib, key)
    if (!e) return { key, found: false }
    const { shown } = await shownEntries(refs, [key], path)
    return { found: true, ...rowOf(lib, e), html: shown[0]?.html ?? "", links: linksOf(e), abstract: e.item.abstract ?? "" }
  })

  plugin.route("GET", "references/styles", () => ({ choices: styleChoices(refs.host) }))
  plugin.route("GET", "references/status", () => statusOf(refs))
  plugin.route("POST", "references/refresh", async () => {
    await refs.host.zotero.refresh(refs.zoteroOptions(), true)
    return statusOf(refs)
  }, { lock: false })

  plugin.route("GET", "references/cayw", async (req) => {
    await plugin.ownerOnly(req, "Zotero's picker")
    try { return { citation: await cayw(LOCAL_URL()) } } catch { throw new HTTPError(503, "Zotero's picker isn't there: it needs Zotero running with Better BibTeX on this computer") }
  }, { lock: false, sync: false })
}
