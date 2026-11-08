// The companion over the screen (web/src/screen.tsx, the page electron/overlay.ts' windows draw), headless with a stand-in
// for its bridge: cursors glide, fade, look as the window's and hand over to it; their words never cover their name
// (plugins/core/companion/boxes.ts), a bubble clicked opens the conversation (#panel); summoned, listening and thinking,
// its words. Reads only web/dist (npm run build first): no app, no window on screen.
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
  window.vaultiteScreen = { on(fn) { window.__scene = fn; return () => {} }, onAt(fn) { window.__at = fn; return () => {} }, holds() {},
    open: call("open"), stop() {},
    panel: { on(fn) { window.__panel = fn; return () => {} }, size: call("size"), send: call("send"), close: call("close"), mic: call("mic"), more: call("more") } }
})
await page.goto("http://screen.test/screen.html")
await page.waitForFunction(() => !!window.__scene)
const scene = (agents, summon = null) => page.evaluate(([agents, summon]) => window.__scene({ width: 1200, height: 800, top: 25, agents, summon, pill: null }), [agents, summon])
const calls = (name) => page.evaluate((name) => window.__calls.filter((c) => c[0] === name), name)
const A = (sx, sy, extra = {}) => ({ name: "Claude", tint: "orange", state: "thinking", sx, sy, ...extra })
const pos = () => page.evaluate(() => { const el = [...document.querySelectorAll('#root > div[style*="translate"]')].find((e) => e.style.transform.startsWith("translate")); const m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform); return m ? [+m[1], +m[2]] : null })
/** Every frame's place for `ms`. */
const sample = (ms) => page.evaluate((ms) => new Promise((done) => {
  const out = [], t0 = performance.now()
  const f = () => { const el = [...document.querySelectorAll('#root > div[style*="translate"]')].find((e) => e.style.transform.startsWith("translate")); const m = el && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform); out.push(m ? [+m[1], +m[2]] : null); if (performance.now() - t0 < ms) requestAnimationFrame(f); else done(out) }
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
await page.evaluate(() => window.__at({ agents: { Claude: [300, 300] }, summon: null }))
const viaAt = await sample(700)
check("a places-only message moves it too", JSON.stringify(viaAt.filter(Boolean).at(-1)) === "[297,298]", viaAt.at(-1))

// a cursor coming from elsewhere starts there
await scene([A(300, 300), { ...A(600, 200), name: "Ada", from: { x: -200, y: 200 } }])
const ada = await page.evaluate(() => { const el = [...document.querySelectorAll('#root > div[style*="translate"]')].filter((e) => e.style.transform.startsWith("translate"))[1]; return el?.style.transform })
check("a cursor new here with `from` starts there and glides in", !!ada && /translate\(-\d/.test(ada), ada)

// gone: it fades, then it's taken away
await scene([])
await page.waitForTimeout(50)
const fading = await page.evaluate(() => document.querySelectorAll("[data-gone]").length)
await page.waitForTimeout(400)
const left = await page.evaluate(() => document.querySelectorAll('#root > div[style*="translate"]').length)
check("a cursor that goes fades out, then is gone", fading === 2 && left === 0, { fading, left })

// as the window draws it: its flag (name, mark), its bubble beside, ringed in its colour
await scene([A(200, 300, { t: Date.now(), say: { id: "s1", text: "The **build** failed on line 12." } }), { ...A(1100, 760), name: "Ada", tint: "blue", state: "listening", t: Date.now() }])
await page.waitForTimeout(400)
const look = await page.evaluate(() => {
  const [c, ada] = [...document.querySelectorAll('#root > div[style*="translate"]')]
  return { flag: c.textContent, dots: !!c.querySelector(".companion-dots"), bob: !!c.querySelector(".companion-bob"), bubble: c.querySelector(".companion-pop")?.textContent,
    wave: !!ada.querySelector(".companion-wave"), low: ada.hasAttribute("data-low"), right: ada.hasAttribute("data-flag-right") }
})
check("a cursor looks as in the window: flag with its name and mark, the arrow bobbing as it thinks, its words plain in a bubble",
  look.flag.startsWith("Claude") && look.dots && look.bob && look.bubble === "The build failed on line 12." && look.wave, look)
check("near the screen's bottom right, its flag goes above its arrow, toward the room", look.low && look.right, look)
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

// into the window: it glides to where the window draws it, fading as it lands
await scene([A(200, 300, { t: Date.now(), leaving: true }), { ...A(900, 760), name: "Ada", tint: "blue", state: "listening" }])
await page.waitForTimeout(30)
const going = await page.evaluate(() => document.querySelector("#root > div[data-leaving]")?.hasAttribute("data-gone"))
check("one going into the window fades on its way", going === true)

// summoned: at the pointer, listening with its words by it, then thinking; its own cursor takes over, no ghost
const S = (state, extra = {}) => ({ name: "Claude", tint: "orange", state, sx: 600, sy: 400, ...extra })
await scene([], S("listening", { words: "what's this button" }))
await page.waitForTimeout(300)
const heard = await page.evaluate(() => { const c = document.querySelector("[data-companion-summoned]"); return c && { state: c.dataset.companionSummoned, wave: !!c.querySelector(".companion-wave"), words: c.querySelector("[data-bubble]")?.textContent } })
check("summoned, listening: its cursor with a wave, its words by it as they come", heard?.state === "listening" && heard.wave && heard.words === "what's this button", heard)
await scene([], S("thinking"))
await page.waitForTimeout(100)
check("let go, it thinks there (dots), the words gone", await page.evaluate(() => { const c = document.querySelector("[data-companion-summoned]"); return c?.dataset.companionSummoned === "thinking" && !!c.querySelector(".companion-dots") && !c.querySelector("[data-bubble]") }))
await scene([A(600, 400, { from: { x: 600, y: 400 } })])
await page.waitForTimeout(30)
const swapped = await page.evaluate(() => ({ cursors: document.querySelectorAll('#root > div[style*="translate"]').length, ghost: document.querySelectorAll("[data-gone]").length }))
check("its own cursor takes over: one, no fading copy behind", swapped.cursors === 1 && swapped.ghost === 0, swapped)
await scene([])
await page.waitForTimeout(400)

// its words never cover its arrow, its name or what it points at, anywhere on screen (the bug: its box over its name)
const long = "Here's what this row is: an invoice from Lighthouse, due Friday. Want me to add a task for it, or draft a reply?"
const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const covered = []
for (const [x, y] of [[400, 40], [400, 500], [400, 790], [1190, 400], [1190, 790], [8, 790], [8, 40]]) {
  await scene([A(x, y, { t: Date.now(), say: { id: `s${x}${y}`, text: long }, target: { x: x - 10, y: y - 10, width: 120, height: 20 } })])
  await page.waitForTimeout(1000)
  const r = await page.evaluate(() => { const c = document.querySelector('#root > div[style*="translate"]'), box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { flag: box(c.querySelector("[data-flag]")), words: box(c.querySelector("[data-bubble]")), arrow: box(c.querySelector("svg")) } })
  const target = { x: x - 10, y: y - 10, width: 120, height: 20 }
  // (a pixel's give: sub-pixel layout)
  if (meets(r.words, r.flag) || meets(r.words, r.arrow) || meets(r.words, target) || r.words.x < -1 || r.words.y < 24 || r.words.x + r.words.width > 1201 || r.words.y + r.words.height > 801) covered.push({ x, y, ...r })
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `bubble-${x}-${y}.png`) })
}
check("its bubble never covers its arrow, its name or what it points at, and stays on screen, in every corner", !covered.length, covered.slice(0, 2))

// its bubble clicked opens its conversation at once, by its tip; the cursor itself takes no click (nothing to drag)
await scene([A(400, 500, { t: Date.now(), say: { id: "s2", text: long } })])
await page.waitForTimeout(500)
await page.mouse.click(400, 500)
await page.waitForTimeout(400)
check("its cursor clicked: nothing (it isn't a button)", !(await calls("open")).length, await calls("open"))
const bub = await page.evaluate(() => { const r = document.querySelector("[data-bubble-text]").getBoundingClientRect(); return [r.x + 20, r.y + 8] })
await page.mouse.click(bub[0], bub[1])
await page.waitForTimeout(50)
const opened = await calls("open")
check("its bubble clicked opens the conversation at once, by its tip", opened.length === 1 && opened[0][1] === "Claude" && opened[0][2] === 400 && opened[0][3] === 500, opened)
await scene([])

// driving another app: its caption by its name, and a pause said as one (electron/takeover.ts' takeoverCaption)
await scene([A(300, 300, { state: "writing", doing: "Clicking Files" })])
await page.waitForTimeout(80)
const doing = () => page.evaluate(() => [...document.querySelectorAll("[data-companion-doing]")].map((e) => [e.dataset.companionDoing, e.textContent, getComputedStyle(e.closest("[data-flag]")).opacity]))
check("driving, its flag says what it does", JSON.stringify(await doing()) === '[["doing","Clicking Files","1"]]', await doing())
await scene([A(300, 300, { state: "writing", doing: "Paused, you're using the mouse", paused: true })])
await page.waitForTimeout(80)
check("their hands on the mouse, it says it's paused", JSON.stringify((await doing()).map((d) => d.slice(0, 2))) === `[["paused","Paused, you're using the mouse"]]`, await doing())
await scene([], { name: "Claude", tint: "orange", state: "thinking", sx: 400, sy: 300, follow: false, doing: "Typing the title" })
await page.waitForTimeout(80)
check("summoned, its caption shows too, no dots with it", JSON.stringify((await doing()).map((d) => d.slice(0, 2))) === '[["doing","Typing the title"]]' &&
  !(await page.evaluate(() => !!document.querySelector("[data-companion-summoned] .companion-dots"))), await doing())
if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, "doing.png") })
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
  window.vaultiteScreen = { on: () => () => {}, onAt: () => () => {}, holds() {}, panel: { on(fn) { window.__panel = fn; return () => {} }, size: call("size"), send: call("send"), close: call("close"), mic: call("mic"), more: call("more") } }
})
await panel.goto("http://screen.test/screen.html#panel")
await panel.waitForFunction(() => !!window.__panel)
const data = { name: "Claude", tint: "orange", items: [{ id: "a1", kind: "ask", text: "what's this row?", t: Date.now() - 60_000 }, { id: "s1", kind: "say", text: "An **invoice** from Lighthouse, due Friday.", t: Date.now() - 50_000 }] }
await panel.evaluate((d) => window.__panel(d), data)
await panel.waitForSelector("[data-companion-popover]")
const p = await panel.evaluate(() => ({ name: document.querySelector("[data-companion-name]")?.textContent, asked: document.querySelector("[data-asked]")?.textContent, said: document.querySelector("[data-said] .note-prose")?.innerHTML,
  focused: document.activeElement?.tagName, placeholder: document.activeElement?.getAttribute("placeholder") }))
check("its conversation shows its name alone, what was asked, its words as Markdown, the box focused", p.name === "Claude" && p.asked === "what's this row?" && /<strong>invoice<\/strong>/.test(p.said ?? "") && p.focused === "INPUT" && p.placeholder === "Ask Claude", p)
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
