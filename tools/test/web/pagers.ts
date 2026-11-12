import { check, section } from "../lib.ts"
import { type Any, web } from "./lib.ts"

await section("pagers", async () => {
  const { band, fling, stopFor, within }: Any = await web("core/pager.ts")
  const { spring }: Any = await web("core/motion.ts")
  const w = 410
  check("pagers: past an end the give grows less and less, never a page", band(100, w) < 60 && band(400, w) - band(300, w) < band(100, w) && band(5000, w) < w && band(-100, w) === -band(100, w), [band(100, w), band(400, w), band(5000, w)])
  check("pagers: between the ends the track is the finger's", within(-200, -w, w, w) === -200 && within(-500, -w, 0, w) > -w - 60 && within(30, -w, 0, w) < 30, [within(-500, -w, 0, w), within(30, -w, 0, w)])
  check("pagers: a let-go's speed is over its last 100 ms; none once the finger stopped", Math.abs(fling([[0, 0], [100, 50], [150, 100], [180, 130]], 185) - 1) < 1e-9 && fling([[0, 0], [16, 20]], 120) === 0, [fling([[0, 0], [100, 50], [150, 100], [180, 130]], 185), fling([[0, 0], [16, 20]], 120)])
  const stops = [-w, 0, w]
  check("pagers: slow, the page most on screen; a flick goes on its way however short", stopFor(stops, -150, 0) === 0 && stopFor(stops, -230, 0) === -w && stopFor(stops, -20, -0.5) === -w && stopFor(stops, -300, 0.5) === 0 && stopFor([0, w], -40, -2) === 0,
    [stopFor(stops, -150, 0), stopFor(stops, -230, 0), stopFor(stops, -20, -0.5), stopFor(stops, -300, 0.5), stopFor([0, w], -40, -2)])
  const rest = spring(0.34, 1), fast = spring(0.34, 1, 10)
  check("pagers: a spring started at a flick's speed is further along early, and still lands without overshooting", fast.at(0.05) > rest.at(0.05) && Array.from({ length: 60 }, (_, i) => fast.at(i / 100)).every((x) => x <= 1.0001), [rest.at(0.05), fast.at(0.05)])
})
