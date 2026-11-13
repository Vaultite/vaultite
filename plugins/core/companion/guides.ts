import { z } from "zod"
import type { Moment } from "./types.ts"
import type { Frontmatter } from "./tour.ts"
import { hostOf, siteIn } from "../../../core/desktop/places.ts"

export type Guide = { id: string; title: string; app: string[]; site: string[]; body: string }

const Words = z.union([z.array(z.unknown()).transform((a) => a.map(String)), z.string().transform((s) => s.split(","))]).catch([])
  .transform((a) => a.map((x) => x.trim()).filter(Boolean))
const Front = z.object({ title: z.string().trim().catch(""), app: Words, site: Words })
export function parseGuide(frontmatter: Frontmatter, body: string, stem: string): [Omit<Guide, "id">, string[]] {
  const fm = Front.parse(frontmatter), app = fm.app, site = fm.site.map((s) => s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  return [{ title: fm.title || stem, app, site, body },
    app.length || site.length ? [] : ["a guide names its app (a bundle id: com.figma.Desktop) or its site (figma.com)"]]
}

const ADDRESS = /^\s*(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?\s*$/i
export function sitesOf(m: Pick<Moment, "url" | "screen">) {
  const hosts = m.url ? [hostOf(m.url)] : []
  for (const l of (m.screen ?? "").split("\n").slice(0, 60)) { const x = ADDRESS.exec(l); if (x) hosts.push(x[1].toLowerCase()) }
  return [...new Set(hosts.filter(Boolean))]
}

export function guideFor(guides: readonly Guide[], m: Pick<Moment, "app" | "url" | "screen">): Guide | null {
  const hosts = sitesOf(m)
  return guides.find((g) => hosts.some((h) => siteIn(h, g.site))) ?? (m.app ? guides.find((g) => g.app.some((a) => a.toLowerCase() === m.app!.toLowerCase())) : null) ?? null
}

const MAX = 1500
export function guideLines(g: Guide) {
  const file = /\.md$/i.test(g.id) ? g.id : `${g.id}.md`
  const body = g.body.trim(), cut = body.length > MAX ? `${body.slice(0, MAX).replace(/\s+\S*$/, "")} … (the rest: vau read ${JSON.stringify(file)})` : body
  return [`  their guide to it (${file}):`, ...cut.split("\n").map((l) => `    ${l}`)]
}
