import type { Screen } from "./screen.ts"

/** How a link was pressed: a click's keys and button (a tap has none). */
export type Press = Pick<MouseEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "button">
/** `target`: what its menu is for. */
export type LinkAction = { open: (e: Press) => void; target?: { url: string } | { wiki: string } }
/** Columns and rows count from 1, as xterm.js has them; y is a row of history and screen. `declared`: its program
 *  wrote it as a link (OSC 8). */
export type Link = LinkAction & {
  text: string
  range: { start: { x: number; y: number }; end: { x: number; y: number } }
  declared?: boolean
}
export type LinkProvider = { provideLinks: (y: number, done: (links: Link[] | undefined) => void) => void }

/** Web addresses, as xterm.js's web links addon found them. */
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g

export function webLinks(s: Screen, y: number, action: (uri: string) => LinkAction | null): Link[] {
  let first = y
  for (let i = 0; i < 20 && first > 0; i++) { const prev = s.line(first - 1); if (!prev?.wrap) break; first-- }
  const parts: { y: number; text: string; at: number[] }[] = []
  for (let r = first, i = 0; i < 40; r++, i++) {
    const l = s.line(r)
    if (!l) break
    parts.push({ y: r, text: l.text, at: l.at })
    if (!l.wrap) break
  }
  const text = parts.map((p) => p.text).join(""), out: Link[] = []
  const cell = (i: number) => {
    for (const p of parts) { if (i < p.text.length) return { x: p.at[i] + 1, y: p.y + 1 }; i -= p.text.length }
    return null
  }
  for (const m of text.matchAll(URL_RE)) {
    const a = cell(m.index), b = cell(m.index + m[0].length - 1)
    if (!a || !b || a.y > y + 1 || b.y < y + 1) continue
    const act = action(m[0])
    if (act) out.push({ ...act, text: m[0], range: { start: a, end: b } })
  }
  return out
}

export function osc8At(s: Screen, row: { flags: Uint16Array }, x: number, vy: number, LINK: number): { uri: string; x1: number; x2: number } | null {
  if (!(row.flags[x] & LINK)) return null
  const uri = s.hyperlink(x, vy)
  if (!uri) return null
  let x1 = x, x2 = x
  while (x1 > 0 && row.flags[x1 - 1] & LINK && s.hyperlink(x1 - 1, vy) === uri) x1--
  while (x2 < row.flags.length - 1 && row.flags[x2 + 1] & LINK && s.hyperlink(x2 + 1, vy) === uri) x2++
  return { uri, x1, x2 }
}
