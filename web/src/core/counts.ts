import { withoutBlocks } from "../../../core/sections.ts"

export type Counts = { words: number; chars: number; lines: number; cells: number }

const cells = (t: string) => { try { const c = JSON.parse(t).cells; return Array.isArray(c) ? c.length : 0 } catch { return 0 } }
const words = (t: string) => t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0

export function countText(body: string, code: boolean, nb: boolean): Counts {
  const t = code ? body : withoutBlocks(body)
  return { words: code ? 0 : words(t), chars: t.replace(/^\n+|\n+$/g, "").length, lines: body.replace(/\n$/, "").split("\n").length, cells: nb ? cells(body) : 0 }
}
