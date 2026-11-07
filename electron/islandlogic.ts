// Where the island goes (island.ts): beside the notch, right of another app's island there (Vorssaint's, any notch
// app's), else at the top centre of the menu bar. Plain functions, screen points with a top-left origin.

export type Rect = { x: number; y: number; width: number; height: number }
/** The island's place: its bar's left edge (`attached`: flush with the notch, its black running on from it) or centre
 *  (`centre`: no notch), at the display's top, as tall as its menu bar; `hidden`: another island is open there. */
export type Spot = { x: number; y: number; bar: number; align: "left" | "centre"; attached: boolean; hidden?: boolean
  /** How wide it may rest there (points; roomAt), its faces fewer to fit. */
  room?: number }
export type OtherWindow = { frame?: Rect | null; layer?: number; vaultite?: boolean; seen?: boolean; bundle?: string }

/** Space between our island and another's. */
export const GAP = 6
/** How far our black runs in under the notch, so it joins it with no seam at its rounded corner. */
export const TUCK = 14
/** How far its window reaches back left of it: a card below the bar may hang back under the notch. */
export const REACH = 330
const MENU_BAR = 24

/** Other apps' islands on display `d`: windows above the menu bar's level at its top, over the notch (or the centre);
 *  never a status item, a menu, or a bar across the top (the menu bar's, a menu bar manager's). */
export function islandsOn(d: { bounds: Rect }, notch: Rect | null, ws: OtherWindow[]) {
  const mid = notch ?? { x: d.bounds.x + d.bounds.width / 2 - 1, y: d.bounds.y, width: 2, height: MENU_BAR }
  return ws.flatMap((w) => {
    const f = w.frame
    if (!f || w.vaultite || w.seen === false || (w.layer ?? 0) <= 24 || f.width < 20 || f.width > d.bounds.width * 0.6 || f.height < 10) return []
    const top = f.y <= d.bounds.y + 2, over = f.x < mid.x + mid.width && f.x + f.width > mid.x
    return top && over ? [f] : []
  })
}

/** Where the island goes on display `d` (its `workArea` says the menu bar's height), with `notch` (null: none) and other
 *  apps' islands `others` there. */
export function islandSpot(d: { bounds: Rect; workArea?: Rect }, notch: Rect | null, others: Rect[]): Spot {
  const bar = Math.round(notch?.height || (d.workArea && d.workArea.y > d.bounds.y ? d.workArea.y - d.bounds.y : MENU_BAR))
  const y = d.bounds.y
  // (another island opened down over the screen, a panel: it has them now, ours steps aside)
  const hidden = others.some((f) => f.height > bar + 6)
  const right = Math.max(...others.map((f) => f.x + f.width), -Infinity)
  if (notch) {
    const edge = notch.x + notch.width
    return right > edge + 2 ? { x: Math.round(right + GAP), y, bar, align: "left", attached: false, ...(hidden ? { hidden } : {}) }
      : { x: Math.round(edge), y, bar, align: "left", attached: true, ...(hidden ? { hidden } : {}) }
  }
  if (others.length) return { x: Math.round(right + GAP), y, bar, align: "left", attached: false, ...(hidden ? { hidden } : {}) }
  return { x: Math.round(d.bounds.x + d.bounds.width / 2), y, bar, align: "centre", attached: false }
}

/** How wide the island may rest at `spot` before the menu bar's first status item right of it (its window's level is the
 *  status bar's, 25), so its faces never cover one; a knock's line or the list may, a moment. */
export function roomAt(spot: Spot, d: { bounds: Rect }, ws: OtherWindow[]) {
  if (spot.align === "centre") return Infinity
  const items = ws.flatMap((w) => {
    const f = w.frame
    return f && !w.vaultite && w.layer === 25 && f.y <= d.bounds.y + 2 && f.height <= spot.bar + 4 && f.x >= spot.x ? [f.x] : []
  })
  return items.length ? Math.max(0, Math.min(...items) - spot.x - GAP) : Infinity
}

/** The island's window for `spot`, `w` by `h`: reaching back left of its place (and the tuck when attached), centred on it
 *  with no notch. Kept on its display. */
export function windowAt(spot: Spot, d: { bounds: Rect }, w: number, h: number): Rect {
  const want = spot.align === "centre" ? spot.x - w / 2 : spot.x - REACH - (spot.attached ? TUCK : 0)
  const x = Math.round(Math.min(Math.max(want, d.bounds.x), d.bounds.x + d.bounds.width - w))
  return { x, y: spot.y, width: w, height: h }
}
