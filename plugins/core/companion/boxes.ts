// Where a cursor's words go (its bubble, its caption, its box): never over its arrow, its name or what it points at.
// One rule for the window (Overlay.tsx) and the screen (web/src/screen.tsx, electron/overlay.ts). No Node, no DOM.

export type Box = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }

/** The arrow as drawn: a 20px box, its tip 3, 2 into it. */
export const arrowBox = (tip: Point): Box => ({ x: tip.x - 3, y: tip.y - 2, width: 20, height: 20 })
export const FLAG_H = 20
/** Its name's pill: under the arrow, or over it near the area's foot (`low`); toward the room near its right edge. */
export function flagBox(tip: Point, width: number, area: Box): Box & { low: boolean; right: boolean } {
  const low = tip.y + 44 > area.y + area.height - 8, right = tip.x > area.x + area.width - 140
  return { x: right ? tip.x + 23 - width : tip.x + 10, y: low ? tip.y - 22 : tip.y + 16, width, height: FLAG_H, low, right }
}

const GAP = 4
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
const inside = (b: Box, area: Box) => b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height

/** Where a box of `size` goes for a cursor at `tip`, inside `area`, clear of `clear` (arrow, flag, target): beside the
 *  arrow (rising, then going down), below them all, above them all; with no room clear, where it covers least. */
export function boxAt(tip: Point, size: { width: number; height: number }, area: Box, clear: Box[]): Point & { side: "right" | "left"; up: boolean } {
  const { width: w, height: h } = size
  const top = Math.min(...clear.map((b) => b.y)), bottom = Math.max(...clear.map((b) => b.y + b.height))
  const right = tip.x + 21, left = tip.x - 7 - w
  const tries: (Point & { side: "right" | "left"; up: boolean })[] = [
    { x: right, y: tip.y + 16 - h, side: "right", up: true }, { x: left, y: tip.y + 16 - h, side: "left", up: true },
    { x: right, y: tip.y - 2, side: "right", up: false }, { x: left, y: tip.y - 2, side: "left", up: false },
    { x: tip.x - 3, y: bottom + GAP, side: "right", up: false }, { x: tip.x + 23 - w, y: bottom + GAP, side: "left", up: false },
    { x: tip.x - 3, y: top - GAP - h, side: "right", up: true }, { x: tip.x + 23 - w, y: top - GAP - h, side: "left", up: true },
  ]
  const fit = (p: Point): Point => ({ x: Math.max(area.x, Math.min(area.x + area.width - w, p.x)), y: Math.max(area.y, Math.min(area.y + area.height - h, p.y)) })
  const ok = tries.find((p) => { const b = { ...p, width: w, height: h }; return inside(b, area) && !clear.some((c) => meets(b, c)) })
  if (ok) return ok
  // (no room clear of them all: kept on screen where it covers least, the arrow's tip above all)
  const cost = (p: Point) => clear.reduce((n, c, i) => n + overlap({ ...p, width: w, height: h }, c) * (i === 0 ? 4 : 1), 0)
  const best = tries.map((p) => ({ ...p, ...fit(p) })).reduce((a, b) => (cost(b) < cost(a) ? b : a))
  return { ...best, x: Math.round(best.x), y: Math.round(best.y) }
}
