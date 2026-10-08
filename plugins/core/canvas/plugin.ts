// Canvas's server side: `text:canvas`, `links:canvas` (the graph's lines), its settings, and link card previews fetched
// through fetchPublic, so a refused address answers like a page that's down and the route can't probe the network.
import { fetchPublic, HTTPError, pageText, Plugin, publicUrl } from "../../../core/plugins.ts"
import { canvasLinks, canvasMarkdown } from "./codec.ts"
import { type LinkPreview, parsePreview } from "./preview.ts"

export const plugin = new Plugin(import.meta.url)

plugin.provide("text:canvas", (text: string) => canvasMarkdown(text))
plugin.provide("links:canvas", (text: string) => canvasLinks(text))

const SETTINGS = new Set(["snapToGrid", "snapToObjects"])
plugin.route("GET", "canvas/settings", () => plugin.settings())
plugin.route("PUT", "canvas/settings", (req) => {
  const cur = plugin.readSettings() ?? {}
  const next = { ...cur }
  for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
    if (!SETTINGS.has(k)) throw new HTTPError(400, `no setting '${k}'`)
    if (v === null) delete next[k]
    else if (typeof v !== "boolean") throw new HTTPError(400, `'${k}' is true or false`)
    else next[k] = v
  }
  if (JSON.stringify(next) !== JSON.stringify(cur)) plugin.saveSettings(next)
  return next
})

const TIMEOUT = 5000
const MAX_HTML = 1024 * 1024 // YouTube's og: tags come after 700 KB of scripts

async function preview(u: URL): Promise<LinkPreview> {
  try {
    const page = await fetchPublic(u, { max: MAX_HTML, timeout: TIMEOUT })
    return page.status >= 200 && page.status < 300 && page.body.length ? { url: u.href, ...parsePreview(pageText(page.type, page.body), page.url) } : { url: u.href }
  } catch {
    return { url: u.href }
  }
}

// The latest answers by address, in the order they were last asked for (the oldest first).
const kept = new Map<string, { at: number; ttl: number; answer: Promise<LinkPreview> }>()
const KEEP = 500
const READ_TTL = 86_400_000, FAILED_TTL = 600_000

plugin.route("GET", "canvas/link", async (req) => {
  const raw = String(req.query.url ?? "").trim()
  if (!raw || raw.length > 2048) throw new HTTPError(400, "url: a web address, up to 2048 characters")
  let u: URL
  try { u = new URL(raw) } catch { throw new HTTPError(400, `not a web address: ${raw}`) }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HTTPError(400, "only http and https addresses have a preview")
  const ok = publicUrl(raw)
  if (typeof ok === "string") return { url: raw } // a local address: the same answer as a page that's down
  let entry = kept.get(ok.href)
  kept.delete(ok.href)
  if (!entry || Date.now() - entry.at >= entry.ttl) {
    const made = { at: Date.now(), ttl: FAILED_TTL, answer: preview(ok) }
    made.answer.then((a) => { if (a.title || a.description || a.image) made.ttl = READ_TTL })
    entry = made
  }
  kept.set(ok.href, entry)
  while (kept.size > KEEP) kept.delete(kept.keys().next().value!)
  return { ...(await entry.answer), url: raw }
})
