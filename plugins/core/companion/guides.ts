// Guides: the user's notes on an app or a site (type: guide, in Guides/), loaded with a summoned ask there. No Node.
import type { Moment } from "./plugin.ts"
import { hostOf, siteIn } from "./places.ts"

export type Guide = { id: string; title: string; app: string[]; site: string[]; body: string }

const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean)
/** A guide's file: its app bundle ids and sites (a list, or one), its body the guide. */
export function parseGuide(fm: Record<string, unknown>, body: string, stem: string): [Record<string, unknown>, string[]] {
  const app = list(fm.app), site = list(fm.site).map((s) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  return [{ title: typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : stem, app, site, body },
    app.length || site.length ? [] : ["a guide names its app (a bundle id: com.figma.Desktop) or its site (figma.com)"]]
}

/** A line that is only an address (a browser's address bar, as Accessibility reads it): its host. */
const ADDRESS = /^\s*(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?\s*$/i
/** The sites a moment is on: its page's address, else the addresses its window shows (a browser's bar). */
export function sitesOf(m: Pick<Moment, "url" | "screen">) {
  const hosts = m.url ? [hostOf(m.url)] : []
  for (const l of (m.screen ?? "").split("\n").slice(0, 60)) { const x = ADDRESS.exec(l); if (x) hosts.push(x[1].toLowerCase()) }
  return [...new Set(hosts.filter(Boolean))]
}

/** The guide for where moment `m` was asked: its site's first (a browser's own guide is less to the point), else its app's. */
export function guideFor(guides: readonly Guide[], m: Pick<Moment, "app" | "url" | "screen">): Guide | null {
  const hosts = sitesOf(m)
  return guides.find((g) => hosts.some((h) => siteIn(h, g.site))) ?? (m.app ? guides.find((g) => g.app.some((a) => a.toLowerCase() === m.app!.toLowerCase())) : null) ?? null
}

const MAX = 1500
/** A guide as an ask carries it: its lines, indented under the moment, cut past MAX characters. */
export function guideLines(g: Guide) {
  const file = /\.md$/i.test(g.id) ? g.id : `${g.id}.md`
  const body = g.body.trim(), cut = body.length > MAX ? `${body.slice(0, MAX).replace(/\s+\S*$/, "")} … (the rest: vau read ${JSON.stringify(file)})` : body
  return [`  their guide to it (${file}):`, ...cut.split("\n").map((l) => `    ${l}`)]
}
