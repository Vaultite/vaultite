// The status bar's counts of a file's text: here for the bar (a short file) and its worker (a big one: counts.worker.ts).
import { withoutBlocks } from "../../../core/sections.ts"

export type Counts = { words: number; chars: number; lines: number; cells: number }

/** A notebook's cells (0 while its JSON doesn't parse). */
const cells = (t: string) => { try { const c = JSON.parse(t).cells; return Array.isArray(c) ? c.length : 0 } catch { return 0 } }
const words = (t: string) => t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0

/** A note's counts are of its text without its blocks (```block-person```: views, not words), so a dashboard doesn't
 *  count its fences; code's are of all of it. */
export function countText(body: string, code: boolean, nb: boolean): Counts {
  const t = code ? body : withoutBlocks(body)
  return { words: code ? 0 : words(t), chars: t.replace(/^\n+|\n+$/g, "").length, lines: body.replace(/\n$/, "").split("\n").length, cells: nb ? cells(body) : 0 }
}
