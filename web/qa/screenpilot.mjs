// The summoned companion in its exchange (web/src/core/pilot.ts in web/src/screen.tsx's page, its pen in
// web/src/screendraw/pen.ts and Draw.tsx), headless with a stand-in bridge: it rides beside the pointer on a fast
// spring, flies an arc to what it points at, traces its marks as the ink draws them, goes back once the pointer moves
// on, sleeps when still, and with reduced motion is just there. Its answer's box says how to reply and its field takes
// the keyboard as the box does. Reads only web/dist (npm run build first): no app, no window on screen.
// node web/qa/screenpilot.mjs
import fs from "node:fs"
import path from "node:path"
import { ROOT, qa } from "./lib/qa.mjs"

const { browser, check, watch, done } = await qa(import.meta.url)
const DIST = path.join(ROOT, "web/dist")
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" }

async function open(reduced = false, hash = "") {
  const page = watch(await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: reduced ? "reduce" : "no-preference" }))
  await page.route("http://screen.test/**", (r) => {
    const f = path.join(DIST, new URL(r.request().url()).pathname)
    if (!fs.existsSync(f)) return r.fulfill({ status: 404 })
    r.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] ?? "application/octet-stream" })
  })
  await page.addInitScript(() => {
    window.__frames = 0
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (fn) => { window.__frames++; return raf(fn) }
    window.__calls = []
    const call = (name) => (...a) => window.__calls.push([name, ...a])
    window.vaultiteScreen = { on(fn) { window.__scene = fn; return () => {} }, onAt() { return () => {} }, onPointer(fn) { window.__pointer = fn; return () => {} }, pilot: call("pilot"), grab() {},
      open() {}, stop() {}, draw: { on(fn) { window.__draw = fn; return () => {} }, act() {} },
      panel: { on(fn) { window.__panel = fn; return () => {} }, size() {}, send: call("send"), close() {}, mic() {}, more() {} } }
  })
  await page.goto(`http://screen.test/screen.html${hash}`)
  await page.waitForFunction(() => !!(window.__scene || window.__panel))
  return page
}
const BESIDE = [24, 20]
const summon = (page, extra = {}) => page.evaluate((s) => window.__scene({ width: 1200, height: 800, top: 25, agents: [], summon: { name: "Claude", tint: "orange", state: "watching", sx: 124, sy: 120, follow: true, ...s }, ink: null, pill: null }), extra)
const pointer = (page, x, y) => page.evaluate(([x, y, b]) => window.__pointer([x, y, x + b[0], y + b[1]]), [x, y, BESIDE])
/** Where its arrow's tip is each frame for `ms`, and as a frame later begins, the ink's front (`ink`: a mark's mask). */
const sample = (page, ms, ink = false) => page.evaluate(([ms, ink]) => new Promise((done) => {
  const out = [], t0 = performance.now()
  const f = () => {
    const el = document.querySelector("[data-companion-summoned]"), m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform)
    const row = m ? { x: +m[1] + 3, y: +m[2] + 2, hidden: el.style.visibility === "hidden" } : null
    if (row && ink) {
      // (the ring's reveal: its mask's line, how much of it is drawn)
      const mask = document.querySelector("mask path.sd-pen")
      if (mask) {
        const off = parseFloat(getComputedStyle(mask).strokeDashoffset), len = mask.getTotalLength(), p = mask.getPointAtLength(Math.max(0, Math.min(1, 1 - off)) * len)
        Object.assign(row, { drawn: 1 - off, fx: p.x, fy: p.y })
      }
    }
    out.push(row)
    if (performance.now() - t0 < ms) next(); else done(out)
  }
  // (read once every frame's callbacks have run, the cursor's among them: what that frame shows)
  const next = () => requestAnimationFrame(() => setTimeout(f, 0))
  next()
}), [ms, ink])

const page = await open()
await summon(page)
await pointer(page, 100, 100)
await page.waitForTimeout(100)
const start = (await sample(page, 20)).filter(Boolean).at(-1)
check("summoned in an exchange, it rides beside the pointer (right of and below its arrow)", start?.x === 124 && start?.y === 120, start)

await pointer(page, 700, 400)
const ride = (await sample(page, 500)).filter(Boolean), d0 = Math.hypot(700 + 24 - 124, 400 + 20 - 120)
const at150 = ride.find((_, i) => i >= 9), xs = ride.map((p) => p.x)
check("the pointer jumps: it follows, most of the way in a sixth of a second, never past, and settles there",
  ride.length > 20 && Math.hypot(at150.x - 724, at150.y - 420) < d0 * 0.2 && Math.max(...xs) <= 724.01 && ride.at(-1).x === 724 && ride.at(-1).y === 420, { at150, end: ride.at(-1), n: ride.length })
// (a hand's move: the pointer along a line, a sample a frame, as the overlay's feed sends it)
const glide = page.evaluate(() => new Promise((done) => {
  const out = []; let i = 0
  const f = () => {
    if (i <= 40) window.__pointer([700 - i * 12, 400 + i * 4, 724 - i * 12, 420 + i * 4])
    const el = document.querySelector("[data-companion-summoned]"), m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform)
    out.push({ x: +m[1] + 3, y: +m[2] + 2, px: 724 - Math.min(40, i) * 12 })
    if (++i < 70) requestAnimationFrame(f); else done(out)
  }
  requestAnimationFrame(f)
}))
const moved = await glide, steps = moved.slice(1).map((p, i) => Math.hypot(p.x - moved[i].x, p.y - moved[i].y)), lag = Math.max(...moved.slice(5, 40).map((p) => Math.abs(p.x - p.px)))
check("a hand's move: it rides along smoothly, close behind, in even steps (no jumps)", Math.max(...steps) < 25 && lag < 60 && moved.at(-1).x === 244, { steps: Math.max(...steps), lag, end: moved.at(-1) })
await pointer(page, 700, 400)
await page.waitForTimeout(500)
const f0 = await page.evaluate(() => window.__frames)
await page.waitForTimeout(400)
check("still, it asks for no frames (cheap when idle)", (await page.evaluate(() => window.__frames)) === f0)

// pointing: an arc to the element, then back once the pointer moves on
await summon(page, { aim: { id: "a1", x: 300, y: 650 } })
const fly = (await sample(page, 1100)).filter(Boolean)
const mid = fly[Math.floor(fly.length * 0.4)], straight = (p) => Math.abs((650 - 420) * p.x - (300 - 724) * p.y + 300 * 420 - 650 * 724) / Math.hypot(650 - 420, 300 - 724)
check("it points: flies on an arc (off the straight way) and lands exactly on what it points at", straight(mid) > 15 && fly.at(-1).x === 300 && fly.at(-1).y === 650, { mid: [mid, straight(mid)], end: fly.at(-1) })
check("…and tells the overlay where it went (its box goes with it)", await page.evaluate(() => window.__calls.some((c) => c[0] === "pilot" && c[1]?.[0] === 300 && c[1]?.[1] === 650)))
await pointer(page, 720, 410)
await page.waitForTimeout(1000)
check("a small move of the pointer leaves it pointing", JSON.stringify((await sample(page, 20)).filter(Boolean).at(-1)).includes('"x":300,"y":650'))
await pointer(page, 900, 300)
const home = (await sample(page, 1200)).filter(Boolean)
check("moving on, it flies back beside the pointer", home.at(-1).x === 924 && home.at(-1).y === 320, home.at(-1))

// a drawing: it flies to the ring as its ink begins, then draws it, the tip at the ink's front
await page.evaluate(() => window.__draw({ id: "d1", agent: "Claude", tint: "orange", t: Date.now(), caption: "This one.", marks: [{ type: "ring", at: { x: 400, y: 300, w: 160, h: 40 } }],
  here: { width: innerWidth, height: innerHeight, origin: { x: 0, y: 0 }, home: true, top: 25 } }))
const pen = (await sample(page, 1600, true)).filter(Boolean)
const drawing = pen.filter((p) => p.drawn > 0.08 && p.drawn < 0.92), off = drawing.map((p) => Math.hypot(p.x - p.fx, p.y - p.fy))
const before = pen.filter((p) => !p.drawn), between = before.find((p) => p.x < 900 && p.x > 440)
check("drawing, it first flies to where the ring starts, before the ink does", !!between && before.length > 8, { between, n: before.length })
check("…then traces it as its pen: the tip at the ink's front, frame after frame", drawing.length > 12 && Math.max(...off) < 6, { n: drawing.length, worst: Math.max(...off), sample: drawing.slice(0, 3) })
const end = pen.at(-1)
await page.waitForTimeout(300)
const still = (await sample(page, 20)).filter(Boolean).at(-1)
check("done, it stays by what it drew", still.x === end.x && still.y === end.y && Math.hypot(end.x - end.fx, end.y - end.fy) < 2, { end, still })
await page.evaluate(() => window.__draw(null))
const gone = (await sample(page, 1000)).filter(Boolean)
check("the drawing gone, it flies back beside the pointer", gone.at(-1).x === 924 && gone.at(-1).y === 320, gone.at(-1))

// another display's part: off this one, this window doesn't draw it
await pointer(page, 1500, 300)
const away = (await sample(page, 800)).filter(Boolean).at(-1)
check("past this display's edge (the pointer on another one), this window hides it", away.hidden === true, away)
await pointer(page, 900, 300)
await page.waitForTimeout(600)

// the Talk key held again: back beside the pointer at once
await summon(page, { aim: { id: "a2", x: 200, y: 200 } })
await page.waitForTimeout(250)
await summon(page, { state: "listening", aim: { id: "a2", x: 200, y: 200 } })
const held = (await sample(page, 1000)).filter(Boolean).at(-1)
check("held again mid-pointing, it comes back to listen beside the pointer", held.x === 924 && held.y === 320, held)

// reduced motion: no flights, no pen; each place at once
const calm = await open(true)
await summon(calm)
await pointer(calm, 100, 100)
await calm.waitForTimeout(50)
await pointer(calm, 600, 500)
await calm.waitForTimeout(40)
const c1 = (await sample(calm, 20)).filter(Boolean).at(-1)
await summon(calm, { aim: { id: "r1", x: 300, y: 300 } })
await calm.waitForTimeout(40)
const c2 = (await sample(calm, 20)).filter(Boolean).at(-1)
check("reduced motion: it's beside the pointer and at what it points at at once", c1.x === 624 && c1.y === 520 && c2.x === 300 && c2.y === 300, { c1, c2 })

// its answer's box: how to reply, and its field takes the keyboard as the box does
const box = await open(false, "#panel")
await box.evaluate(() => window.__panel({ name: "Claude", tint: "orange", how: "Claude Code", items: [{ id: "s1", kind: "say", text: "The Send button.", t: Date.now() }], hint: "Reply, or tap ⌃⌥ to type, hold to talk" }))
await box.waitForSelector("[data-companion-popover] input")
await box.evaluate(() => { document.activeElement?.blur(); dispatchEvent(new Event("focus")) })
const field = await box.evaluate(() => ({ hint: document.querySelector("[data-companion-popover] input").placeholder, focused: document.activeElement?.tagName }))
check("the answer's box shows its reply field, saying how to reply without the mouse; given the keyboard, it's in the field", field.hint === "Reply, or tap ⌃⌥ to type, hold to talk" && field.focused === "INPUT", field)
await box.keyboard.type("and this one?")
await box.keyboard.press("Enter")
check("typed there, Enter sends the reply", await box.evaluate(() => window.__calls.some((c) => c[0] === "send" && c[1] === "and this one?")))
await done()
