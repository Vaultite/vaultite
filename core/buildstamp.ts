import { textHash } from "./texthash.ts"

/** The import map's hash is in the name since a changed chunk changes only the map (vite.config.ts chunkImportMap). */
export const buildName = (entry: string, importMap: string | undefined) => (importMap ? `${entry}#${textHash(importMap).split(":").slice(1).join("")}` : entry)

export type Stamp = { commit: string; subject: string; /** When it was committed (ms). */ at: number }

export const STAMP_META = "vaultite-build"
export const stampText = (s: Stamp) => `${s.commit} ${Math.round(s.at / 1000)} ${s.subject}`
export function stampOf(content: string | null | undefined): Stamp | null {
  const m = /^([0-9a-f]{40}) (\d+) ?([^]*)$/.exec(content ?? "")
  return m ? { commit: m[1], at: Number(m[2]) * 1000, subject: m[3] } : null
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", "#39": "'", "#x27": "'" }
export function stampIn(html: string): Stamp | null {
  const m = new RegExp(`<meta name="${STAMP_META}" content="([^"]*)"`).exec(html)
  return m ? stampOf(m[1].replace(/&(amp|quot|lt|gt|#39|#x27);/g, (_, e: string) => ENTITIES[e])) : null
}
