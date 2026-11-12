// What the companion showed on the user's screen lately (its cursor's points, its marks) and where each landed, in
// screen points: told with its next asks, so it answers "you drew there" from what they saw. Plain functions.

export type ShownAt = { x: number; y: number; w?: number; h?: number }
/** One thing it showed: `what` in a few words ("your cursor pointed", "a ring"), `at` where it landed on the screen,
 *  else `on`, the place in words (a note's line, a pane). */
export type Shown = { t: number; what: string; at?: ShownAt; on?: string }

/** How many are kept, and for how long. */
export const SHOWN_KEEP = { most: 8, ms: 10 * 60_000 }

/** `list` with `add` kept, the oldest and the stale left out. */
export function keepShown(list: Shown[], add: Shown[], now = Date.now()): Shown[] {
  return [...list, ...add].filter((s) => now - s.t <= SHOWN_KEEP.ms).slice(-SHOWN_KEEP.most)
}

const ago = (now: number, t: number) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago` }

/** The lines its next ask carries, in the ask's own points (`origin`: where its picture's top left is on the screen, so
 *  a point reads as the picture's pixel, as its other points do); "" when it showed nothing lately. */
export function shownText(list: Shown[], now: number, origin: { x: number; y: number } = { x: 0, y: 0 }): string {
  const live = list.filter((s) => now - s.t <= SHOWN_KEEP.ms)
  if (!live.length) return ""
  const where = (s: Shown) => {
    if (!s.at) return s.on ? ` at ${s.on}` : ""
    const x = Math.round(s.at.x - origin.x), y = Math.round(s.at.y - origin.y)
    return ` at ${x},${y}${s.at.w || s.at.h ? ` ${Math.round(s.at.w ?? 0)}×${Math.round(s.at.h ?? 0)}` : ""}`
  }
  return [`What you showed on their screen lately, where it landed (what they saw of you: asked what you drew or pointed at, answer from this, never that you showed nothing):`,
    ...live.map((s) => `  ${ago(now, s.t)}: ${s.what}${where(s)}`)].join("\n")
}
