// The search tab's options, kept in the vault (the search itself is the core's: core/files.ts,
// core/searchquery.ts).
import { HTTPError, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

const SORTS = ["relevance", "name", "name-desc", "modified", "modified-old", "created", "created-old"]
const VALID: Record<string, (v: unknown) => boolean> = {
  matchCase: (v) => typeof v === "boolean",
  collapse: (v) => typeof v === "boolean",
  explain: (v) => typeof v === "boolean",
  sort: (v) => typeof v === "string" && SORTS.includes(v),
  context: (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5,
}

plugin.route("GET", "search/settings", () => plugin.settings())
plugin.route("PUT", "search/settings", (req) => {
  const cur = plugin.readSettings() ?? {}
  const next = { ...cur }
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (!(k in VALID)) throw new HTTPError(400, `no setting '${k}'`)
    if (v === null) { delete next[k]; continue }
    if (!VALID[k](v)) throw new HTTPError(400, `'${k}' can't be ${JSON.stringify(v)}`)
    next[k] = v
  }
  if (JSON.stringify(next) !== JSON.stringify(cur)) plugin.saveSettings(next)
  return next
})
