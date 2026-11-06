// Links on a terminal's rows: web addresses (a line wrapped over rows read whole), a program's OSC 8 links, and other
// plugins' providers in xterm.js's shape (`registerLinkProvider`: Terminal.tsx's vault files).
import type { Screen } from "./screen.ts"

/** Columns and rows count from 1, as xterm.js has them; y is a row of history and screen. */
export type Link = {
  text: string
  range: { start: { x: number; y: number }; end: { x: number; y: number } }
  activate: (e: MouseEvent, text: string) => void
  hover?: (e: MouseEvent, text: string) => void
  leave?: (e: MouseEvent, text: string) => void
}
export type LinkProvider = { provideLinks: (y: number, done: (links: Link[] | undefined) => void) => void }

/** Web addresses, as xterm.js's web links addon found them. */
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g

/** The web addresses on the line holding row `y` (of history and screen, from 0), as links on that row. */
export function webLinks(s: Screen, y: number, open: (e: MouseEvent, uri: string) => void): Link[] {
  // The whole line: rows before it that wrap into it, and rows after while it wraps on.
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
  /** A character's place (index in the joined line) as a 1-based cell. */
  const cell = (i: number) => {
    for (const p of parts) { if (i < p.text.length) return { x: p.at[i] + 1, y: p.y + 1 }; i -= p.text.length }
    return null
  }
  for (const m of text.matchAll(URL_RE)) {
    const a = cell(m.index), b = cell(m.index + m[0].length - 1)
    if (!a || !b || a.y > y + 1 || b.y < y + 1) continue
    const uri = m[0]
    out.push({ text: uri, range: { start: a, end: b }, activate: (e) => open(e, uri) })
  }
  return out
}

/** The OSC 8 link under a viewport cell: its URI and the run of cells on the row that carry it. */
export function osc8At(s: Screen, row: { flags: Uint16Array }, x: number, vy: number, LINK: number): { uri: string; x1: number; x2: number } | null {
  if (!(row.flags[x] & LINK)) return null
  const uri = s.hyperlink(x, vy)
  if (!uri) return null
  let x1 = x, x2 = x
  while (x1 > 0 && row.flags[x1 - 1] & LINK && s.hyperlink(x1 - 1, vy) === uri) x1--
  while (x2 < row.flags.length - 1 && row.flags[x2 + 1] & LINK && s.hyperlink(x2 + 1, vy) === uri) x2++
  return { uri, x1, x2 }
}
