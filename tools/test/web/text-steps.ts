import { check } from "../lib.ts"
import { web } from "./lib.ts"

// ---------- Zoom steps: a text size in percent or, a terminal's, a point at a time (web/src/core/textsteps.ts) ----------
const { nextTextSize, STEPS }: { nextTextSize(now: number, step: -1 | 1, points?: number): number | undefined; STEPS: number[] } = await web("core/textsteps.ts")
check("zoom: a note's text steps through STEPS, 10% near 100%", nextTextSize(100, 1) === 110 && nextTextSize(100, -1) === 90 && nextTextSize(150, 1) === 170)
check("zoom: no step past either end", nextTextSize(STEPS[STEPS.length - 1], 1) === undefined && nextTextSize(STEPS[0], -1) === undefined)
// (kept in whole percent: each one has to round back to the point it stands for)
const pts: number[] = []
for (let at: number | undefined = 100; at !== undefined && pts.length < 40; at = nextTextSize(at, 1, 13)) pts.push(Math.round(13 * at / 100))
check("zoom: a terminal's text a point at a time, 13 pt to 39 pt", pts.join() === Array.from({ length: 27 }, (_, i) => 13 + i).join(), pts)
const down: number[] = []
for (let at: number | undefined = 100; at !== undefined && down.length < 20; at = nextTextSize(at, -1, 13)) down.push(Math.round(13 * at / 100))
check("zoom: and down to 7 pt, the smallest STEPS allows", down.join() === "13,12,11,10,9,8,7", down)
check("zoom: from a size set in percent (110%: 14 pt), the next point", Math.round(13 * nextTextSize(110, 1, 13)! / 100) === 15)
