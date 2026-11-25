import { check, section } from "../lib.ts"
import { type Any, web } from "./lib.ts"

await section("panzoom", async () => {
  const { fitScale, zoomedAbout }: Any = await web("core/panzoom.ts")
  const tall = { w: 2400, h: 3000 }, box = { w: 1000, h: 600 }, at = { x: 300, y: 200 }
  check("panzoom: all of it fits with its room round it, never larger than itself", fitScale(tall, box) === 0.2 && Math.abs(fitScale(tall, box, 12) - 576 / 3000) < 1e-9 && fitScale({ w: 24, h: 24 }, box) === 1)
  check("panzoom: a vector grows to its box; a box not laid out yet is no zero scale", fitScale({ w: 24, h: 24 }, box, 0, true) === 25 && fitScale(tall, { w: 0, h: 0 }, 12) > 0)
  const from = { k: 0.5, x: -100, y: -40 }, to = zoomedAbout(from, 2, at), under = (v: Any) => [(at.x - v.x) / v.k, (at.y - v.y) / v.k]
  check("panzoom: what's under the pointer stays under it", under(from).every((n: number, i: number) => Math.abs(n - under(to)[i]) < 1e-9), [under(from), under(to)])
})

await section("panzoom, held", async () => {
  const { held }: Any = await web("core/panzoom.ts"), tall = { w: 2400, h: 3000 }, box = { w: 1000, h: 600 }
  const far = held({ k: 1, x: 500, y: -9000 }, tall, box), small = held({ k: 0.2, x: 7, y: 7 }, tall, box)
  check("panzoom: panned no further than its edges, centred along a side it doesn't fill", far.x === 0 && far.y === box.h - tall.h && small.x === 260 && small.y === 0, [far, small])
  const clear = held({ k: 1, x: 500, y: -9000 }, tall, box, 28)
  check("panzoom: its edges pan clear of the box's foot by its room", clear.x === 28 && clear.y === box.h - tall.h - 28, clear)
})

await section("panzoom, steps", async () => {
  const { closerScale, steppedScale, wheelScale }: Any = await web("core/panzoom.ts")
  check("panzoom: a click goes to its own size, or twice as large when that's hardly closer", closerScale(0.2) === 1 && closerScale(0.9) === 1.8 && closerScale(1) === 2)
  check("panzoom: on a sharp screen a click goes to its pixels the screen's", closerScale(0.15, 0.5) === 0.5 && closerScale(0.4, 0.5) === 0.8)
  check("panzoom: a step stops at 100% on its way past, and goes on from it", steppedScale(0.9, 1) === 1 && steppedScale(1, 1) === 1.25 && steppedScale(1.1, -1) === 1 && steppedScale(1, -1) === 0.8)
  check("panzoom: a mouse's notch and a trackpad's pinch step alike, out with a wheel down", wheelScale(120) > 0.7 && wheelScale(120) < 0.9 && wheelScale(-8) > 1 && wheelScale(-8) < 1.15)
})
