// Apart from textsize.ts so tools/test_web.ts tests the steps without a browser.
export const STEPS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 170, 200, 250, 300]

export function nextTextSize(now: number, step: -1 | 1, points?: number) {
  if (points) {
    const pt = Math.round(points * now / 100) + step, to = Math.round(pt * 100 / points)
    return pt > 0 && to >= STEPS[0] && to <= STEPS[STEPS.length - 1] ? to : undefined
  }
  return step > 0 ? STEPS.find((s) => s > now) : [...STEPS].reverse().find((s) => s < now)
}
