// The commit a web build was made from, in its index.html (vite.config.ts writes it): the page reads its own, the
// server the one it serves (core/webbuild.ts). No Node: the web imports it.
import { textHash } from "./texthash.ts"

/** A build's name: its entry script's, and its import map's hash, since a chunk changing changes only the map (vite.config.ts
 *  chunkImportMap: each file imports the others by a name that stays). The page names its own the same way (builds.ts). */
export const buildName = (entry: string, importMap: string | undefined) => (importMap ? `${entry}#${textHash(importMap).split(":").slice(1).join("")}` : entry)

export type Stamp = { commit: string; subject: string; /** When it was committed (ms). */ at: number }

/** The <meta name> it's in; its content is "<sha> <unix seconds> <subject>". */
export const STAMP_META = "vaultite-build"
export const stampText = (s: Stamp) => `${s.commit} ${Math.round(s.at / 1000)} ${s.subject}`
export function stampOf(content: string | null | undefined): Stamp | null {
  const m = /^([0-9a-f]{40}) (\d+) ?([^]*)$/.exec(content ?? "")
  return m ? { commit: m[1], at: Number(m[2]) * 1000, subject: m[3] } : null
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">", "#39": "'", "#x27": "'" }
/** An index.html's stamp, as its text says it (escaped as an attribute). */
export function stampIn(html: string): Stamp | null {
  const m = new RegExp(`<meta name="${STAMP_META}" content="([^"]*)"`).exec(html)
  return m ? stampOf(m[1].replace(/&(amp|quot|lt|gt|#39|#x27);/g, (_, e: string) => ENTITIES[e])) : null
}
