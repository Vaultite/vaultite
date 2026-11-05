// The companion's cursor over the screen (web/src/screen.tsx, the page electron/overlay.ts' windows draw), headless with a
// stand-in for its bridge: cursors glide, fade, look as the window's and hand over to it; their bubbles stay on screen, a
// click opens the conversation (#panel), the dock. Reads only web/dist (npm run build first): no app, no window on screen.
// node web/qa/screencursor.mjs
import fs from "node:fs"
import path from "node:path"
import { ROOT, qa } from "./lib/qa.mjs"

const { browser, check, watch, done } = await qa(import.meta.url)
const DIST = path.join(ROOT, "web/dist")
const page = watch(await browser.newPage({ viewport: { width: 1200, height: 800 } }))
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" }
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
  window.vaultiteScreen = { on(fn) { window.__scene = fn; return () => {} }, onAt(fn) { window.__at = fn; return () => {} }, grab() {}, drop(...a) { window.__dropped = a },
    open: call("open"), home: call("home"), menu: call("menu"), stop() {},
    panel: { on(fn) { window.__panel = fn; return () => {} }, size: call("size"), send: call("send"), close: call("close"), mic: call("mic"), more: call("more") } }
})
await page.goto("http://screen.test/screen.html")
await page.waitForFunction(() => !!window.__scene)
const scene = (agents, idle = null) => page.evaluate(([agents, idle]) => window.__scene({ width: 1200, height: 800, top: 25, agents, idle, pill: null }), [agents, idle])
const calls = (name) => page.evaluate((name) => window.__calls.filter((c) => c[0] === name), name)
const A = (sx, sy, extra = {}) => ({ name: "Claude", tint: "orange", state: "thinking", sx, sy, ...extra })
const pos = () => page.evaluate(() => { const el = [...document.querySelectorAll("#root > div")].find((e) => e.style.transform.startsWith("translate")); const m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform); return m ? [+m[1], +m[2]] : null })
/** Every frame's place for `ms`. */
const sample = (ms) => page.evaluate((ms) => new Promise((done) => {
  const out = [], t0 = performance.now()
  const f = () => { const el = [...document.querySelectorAll("#root > div")].find((e) => e.style.transform.startsWith("translate")); const m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform); out.push(m ? [+m[1], +m[2]] : null); if (performance.now() - t0 < ms) requestAnimationFrame(f); else done(out) }
  requestAnimationFrame(f)
}), ms)

await scene([A(100, 100)])
await page.waitForTimeout(100)
check("a new cursor appears where it is (tip at the point)", JSON.stringify(await pos()) === "[97,98]", await pos())
await scene([A(700, 400)])
const run = await sample(700)
const xs = run.filter(Boolean).map((p) => p[0])
const steps = xs.slice(1).map((x, i) => x - xs[i])
check("it glides there over many frames, never back, never past", xs.length > 20 && steps.every((d) => d >= -0.01) && Math.max(...xs) <= 697.01 && new Set(xs).size > 15, { n: xs.length, xs: xs.slice(0, 30) })
check("it settles exactly there", JSON.stringify(run.at(-1)) === "[697,398]", run.at(-1))
const before = await page.evaluate(() => window.__frames)
await page.waitForTimeout(400)
const after = await page.evaluate(() => window.__frames)
check("still, it asks for no frames (the loop sleeps)", after - before === 0, { before, after })

// mid-flight, a new target: no jump, its speed kept
await scene([A(100, 100)])
const half = await sample(120)
await scene([A(100, 700)])
const bent = await sample(900)
const path2 = [...half, ...bent].filter(Boolean)
const jumps = path2.slice(1).map((p, i) => Math.hypot(p[0] - path2[i][0], p[1] - path2[i][1]))
check("a new target mid-flight bends the path: no jump between frames", Math.max(...jumps) < 90 && JSON.stringify(path2.at(-1)) === "[97,698]", { max: Math.max(...jumps), end: path2.at(-1) })
const hx = half.filter(Boolean).map((p) => p[0]), bx = bent.filter(Boolean).map((p) => p[0])
check("…and keeps going the way it went a little (its speed carries)", bx.length > 2 && bx[1] < hx.at(-1), { last: hx.at(-1), next: bx.slice(0, 4) })

// only places: the positions channel
await page.evaluate(() => window.__at({ agents: { Claude: [300, 300] }, idle: null }))
const viaAt = await sample(700)
check("a places-only message moves it too", JSON.stringify(viaAt.filter(Boolean).at(-1)) === "[297,298]", viaAt.at(-1))

// a cursor coming from elsewhere starts there
await scene([A(300, 300), { ...A(600, 200), name: "Ada", from: { x: -200, y: 200 } }])
const ada = await page.evaluate(() => { const el = [...document.querySelectorAll("#root > div")].filter((e) => e.style.transform.startsWith("translate"))[1]; return el?.style.transform })
check("a cursor new here with `from` starts there and glides in", !!ada && /translate\(-\d/.test(ada), ada)

// gone: it fades, then it's taken away
await scene([])
await page.waitForTimeout(50)
const fading = await page.evaluate(() => document.querySelectorAll("[data-gone]").length)
await page.waitForTimeout(400)
const left = await page.evaluate(() => document.querySelectorAll("#root > div").length)
check("a cursor that goes fades out, then is gone", fading === 2 && left === 0, { fading, left })

// as the window draws it: its flag (name, mark), its bubble beside, ringed in its colour
await scene([A(200, 300, { t: Date.now(), say: { id: "s1", text: "The **build** failed on line 12." } }), { ...A(900, 760), name: "Ada", tint: "blue", state: "listening", t: Date.now() }])
await page.waitForTimeout(400)
const look = await page.evaluate(() => {
  const [c, ada] = [...document.querySelectorAll("#root > div")]
  return { flag: c.textContent, dots: !!c.querySelector(".companion-dots"), bob: !!c.querySelector(".companion-bob"), bubble: c.querySelector(".companion-pop")?.textContent,
    wave: !!ada.querySelector(".companion-wave"), low: ada.hasAttribute("data-low"), right: ada.hasAttribute("data-right") }
})
check("a cursor looks as in the window: flag with its name and mark, the arrow bobbing as it thinks, its words plain in a bubble",
  look.flag.startsWith("Claude") && look.dots && look.bob && look.bubble === "The build failed on line 12." && look.wave, look)
check("near the screen's bottom right, its flag goes above and what opens, to its left", look.low && look.right, look)
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

// into the window: it glides to where the window draws it, fading as it lands
await scene([A(200, 300, { t: Date.now(), leaving: true }), { ...A(900, 760), name: "Ada", tint: "blue", state: "listening" }])
await page.waitForTimeout(30)
const going = await page.evaluate(() => document.querySelector("#root > div[data-leaving]")?.hasAttribute("data-gone"))
check("one going into the window fades on its way", going === true)

// the cursor becoming the companion waiting (its place went into the window while they're elsewhere): one, no ghost
await scene([{ ...A(900, 760), name: "Ada", tint: "blue", state: "listening" }], { name: "Claude", tint: "orange", sx: 1178, sy: 266, docked: true, from: { x: 200, y: 300 } })
await page.waitForTimeout(30)
const swapped = await page.evaluate(() => ({ cursors: [...document.querySelectorAll("#root > div")].length, ghost: document.querySelectorAll("[data-gone]").length }))
check("a cursor that becomes the waiting one leaves no fading copy behind", swapped.cursors === 2 && swapped.ghost === 0, swapped)
await scene([])
await page.waitForTimeout(400)

// the waiting cursor trailing the pointer: samples become a smooth path
await scene([], { name: "Claude", tint: "orange", sx: 100, sy: 100, docked: false })
await page.waitForTimeout(100)
const trail = page.evaluate(() => new Promise((done) => {
  const out = []; let i = 0
  const tick = setInterval(() => { i++; window.__at({ agents: {}, idle: [100 + i * 10, 100] }); if (i >= 20) clearInterval(tick) }, 33)
  const f = () => { const el = document.querySelector("#root > div"); const m = /translate\(([-\d.]+)px/.exec(el?.style.transform ?? ""); if (m) out.push(+m[1]); if (out.length < 60) requestAnimationFrame(f); else done(out) }
  requestAnimationFrame(f)
}))
const tr = await trail
const distinct = new Set(tr.map((x) => x.toFixed(1))).size
check("trailing at 30 Hz, it still moves every frame", distinct > 40, { distinct, tr: tr.slice(0, 20) })
await scene([])
await page.waitForTimeout(400)

// its bubble always on screen: at the top (a tab bar under the menu bar), it opens below its flag
const long = "Here's what this row is: an invoice from Lighthouse, due Friday. Want me to add a task for it, or draft a reply?"
await scene([A(400, 40, { t: Date.now(), say: { id: "s2", text: long } })])
await page.waitForTimeout(400)
const high = await page.evaluate(() => { const c = document.querySelector("#root > div"), b = c.querySelector("[data-bubble-text]").parentElement.getBoundingClientRect(); return { high: c.hasAttribute("data-high"), top: b.top, bottom: b.bottom } })
check("near the screen's top, its bubble opens below it, under the menu bar", high.high && high.top > 60, high)
if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "bubble-top.png") })
await scene([A(400, 500, { t: Date.now(), say: { id: "s2", text: long } })])
await page.waitForTimeout(800)
const mid = await page.evaluate(() => { const c = document.querySelector("#root > div"), b = c.querySelector("[data-bubble-text]").parentElement.getBoundingClientRect(); return { high: c.hasAttribute("data-high"), bottom: b.bottom } })
check("with room, it opens above it, as in the window", !mid.high && mid.bottom < 520, mid)

// a click opens its conversation (once a second click isn't coming); two call it back; its bubble clicked opens it too
await page.mouse.click(400, 500)
check("one click: nothing at once (a second may come)", !(await calls("open")).length)
await page.waitForTimeout(400)
const opened = await calls("open")
check("then its conversation opens, by its tip", opened.length === 1 && opened[0][1] === "Claude" && opened[0][2] === 400 && opened[0][3] === 500, opened)
await page.mouse.click(400, 500)
await page.mouse.click(400, 500)
await page.waitForTimeout(400)
check("two clicks call it back, opening nothing", (await calls("home")).length === 1 && (await calls("open")).length === 1, await page.evaluate(() => window.__calls))
const bub = await page.evaluate(() => { const r = document.querySelector("[data-bubble-text]").getBoundingClientRect(); return [r.x + 20, r.y + 8] })
await page.mouse.click(bub[0], bub[1])
await page.waitForTimeout(50)
check("its bubble clicked opens the conversation at once", (await calls("open")).length === 2)
await scene([])
await page.waitForTimeout(400)

// docked: where the user left it, its name on hover, a click opens it at once, unread words pulse
await scene([], { name: "Claude", tint: "orange", sx: 1186, sy: 300, docked: true, side: "right", unread: true })
await page.waitForTimeout(300)
check("docked with words unseen, its dot pulses", await page.evaluate(() => !!document.querySelector("[data-companion-dock] .companion-unread")))
await page.mouse.move(1186, 300)
await page.waitForTimeout(250)
const flag = await page.evaluate(() => { const f = [...document.querySelectorAll("[data-companion-dock] span")].find((e) => e.textContent.startsWith("Claude")); const r = f?.getBoundingClientRect(); return r && { text: f.textContent, right: r.right } })
check("hovered, its name shows, toward the room", flag?.text === "Claudenew" && flag.right < 1180, flag)
if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "dock-hover.png") })
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(30)
check("clicked, its conversation opens at once", (await calls("open")).length === 3)
await scene([])

// the conversation (#panel): the window's own look, a box that takes the keyboard, words said into it
const panel = watch(await browser.newPage({ viewport: { width: 400, height: 600 } }))
await panel.route("http://screen.test/**", (r) => {
  const f = path.join(DIST, new URL(r.request().url()).pathname)
  if (!fs.existsSync(f)) return r.fulfill({ status: 404 })
  r.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] ?? "application/octet-stream" })
})
await panel.addInitScript(() => {
  window.__calls = []
  const call = (name) => (...a) => window.__calls.push([name, ...a])
  window.vaultiteScreen = { on: () => () => {}, onAt: () => () => {}, grab() {}, panel: { on(fn) { window.__panel = fn; return () => {} }, size: call("size"), send: call("send"), close: call("close"), mic: call("mic"), more: call("more") } }
})
await panel.goto("http://screen.test/screen.html#panel")
await panel.waitForFunction(() => !!window.__panel)
const data = { name: "Claude", tint: "orange", how: "Claude Code · Opus · high", items: [{ id: "a1", kind: "ask", text: "what's this row?", t: Date.now() - 60_000 }, { id: "s1", kind: "say", text: "An **invoice** from Lighthouse, due Friday.", t: Date.now() - 50_000 }] }
await panel.evaluate((d) => window.__panel(d), data)
await panel.waitForSelector("[data-companion-popover]")
const p = await panel.evaluate(() => ({ how: document.querySelector("[data-companion-how]")?.textContent, asked: document.querySelector("[data-asked]")?.textContent, said: document.querySelector("[data-said] .note-prose")?.innerHTML,
  focused: document.activeElement?.tagName, placeholder: document.activeElement?.getAttribute("placeholder") }))
check("its conversation shows what it runs, what was asked, its words as Markdown, the box focused", p.how === "Claude Code · Opus · high" && p.asked === "what's this row?" && /<strong>invoice<\/strong>/.test(p.said ?? "") && p.focused === "INPUT" && p.placeholder === "Ask Claude", p)
const sizes = await panel.evaluate(() => window.__calls.filter((c) => c[0] === "size").map((c) => c[1]))
check("it tells its height, for its window to fit it", sizes.length > 0 && sizes.at(-1) > 120 && sizes.at(-1) < 400, sizes)
if (process.env.SHOTS) await panel.screenshot({ path: path.join(process.env.SHOTS, "panel.png") })
await panel.evaluate((d) => window.__panel({ ...d, words: { text: "and the one below", listening: true } }), data)
await panel.waitForTimeout(50)
check("words being said show in the box as they come", await panel.evaluate(() => document.querySelector("input").value) === "and the one below")
if (process.env.SHOTS) await panel.screenshot({ path: path.join(process.env.SHOTS, "panel-listening.png") })
await panel.evaluate((d) => window.__panel({ ...d, words: { text: "and the one below?", listening: false, done: true, id: 1 } }), data)
await panel.evaluate((d) => window.__panel({ ...d, words: { text: "and the one below?", listening: false, done: true, id: 1 } }), data)
await panel.waitForTimeout(50)
check("said, they stay in the box once", await panel.evaluate(() => document.querySelector("input").value) === "and the one below?")
await panel.keyboard.press("Enter")
check("Enter sends it", JSON.stringify(await panel.evaluate(() => window.__calls.filter((c) => c[0] === "send"))) === '[["send","and the one below?"]]')
await panel.keyboard.press("Escape")
check("Esc closes it", await panel.evaluate(() => window.__calls.some((c) => c[0] === "close")))
await done()
