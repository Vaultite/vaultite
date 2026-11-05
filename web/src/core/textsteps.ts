// Text sizes' steps (core/textsize.ts), apart so they're tested without a browser (tools/test_web.ts).

/** The sizes, in percent: 10% apart near 100%, wider further out. */
export const STEPS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 170, 200, 250, 300]

/** The step after `now` (percent) one way: a point for a kind in `points` (kept in percent, which rounds back to it),
 *  else STEPS' next; undefined at the end. */
export function nextTextSize(now: number, step: -1 | 1, points?: number) {
  if (points) {
    const pt = Math.round(points * now / 100) + step, to = Math.round(pt * 100 / points)
    return pt > 0 && to >= STEPS[0] && to <= STEPS[STEPS.length - 1] ? to : undefined
  }
  return step > 0 ? STEPS.find((s) => s > now) : [...STEPS].reverse().find((s) => s < now)
}
