// A phone's split tab swiped between its panes (core/phoneTabs.ts swipePanes) with real touches at 390px: a slow drag
// follows the finger with the next pane beside it, a flick goes, a short drag springs back, vertical scrolls and the
// ends aren't taken, a page caught mid-flight stays under the finger. Prints frame timings. Then WebKit (iOS's engine)
// with synthetic touches: the same moves, no real scrolling. WRITES Qa swipe/: throwaway.
//   node web/qa/paneswipe.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait, webkitLaunch } from "./lib/qa.mjs"
const { args: [B, OUT = "/var/tmp/paneswipe-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = (method, p, body) => fetch(`${B}api/${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
const long = (name) => `# ${name}\n\n${Array.from({ length: 60 }, (_, i) => `${name} paragraph ${i + 1}: words enough to wrap across the phone's width, twice at least.`).join("\n\n")}\n`
const NAMES = ["Swipe one", "Swipe two", "Swipe three"]
for (const n of [...NAMES, "Tab before", "Tab after"]) await api("POST", "file", { path: `Qa swipe/${n}.md`, text: long(n) })
const F = (n) => `file:Qa swipe/${n}.md`
// A tab either side of the split, for the bar's swipe between tabs.
const split = { tabs: [{ id: "t0", focus: "p0", root: { id: "p0", to: F("Tab before") } },
  { id: "tq", focus: "pa", root: { id: "sq", dir: "row", sizes: [1 / 3, 1 / 3, 1 / 3], kids: NAMES.map((n, i) => ({ id: `p${"abc"[i]}`, to: F(n) })) } },
  { id: "t1", focus: "p1", root: { id: "p1", to: F("Tab after") } }], active: "tq" }

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await ctx.addInitScript((tabs) => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); localStorage.setItem("vaultite.tabs", tabs); sessionStorage.setItem("qa", "1") } }, JSON.stringify(split))
const P = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const cdp = await ctx.newCDPSession(P)
await cdp.send("Performance.enable")

/** The pane on screen (its dot in the header), and the main page's sideways offset. */
const at = () => P.evaluate(() => [...document.querySelectorAll("[data-pane-dots] button")].findIndex((b) => b.getAttribute("aria-current")))
const shift = () => P.evaluate(() => { const m = document.querySelector("#main-scroll > main"); return m ? Math.round(new DOMMatrix(getComputedStyle(m).transform).m41) : null })
/** Where the shown page's title is, and the next pane's (drawn beside, when it is). */
const lefts = () => P.evaluate(() => {
  const x = (el) => (el ? Math.round(el.getBoundingClientRect().left) : null)
  return { shown: x(document.querySelector("#main-scroll article.file-view:not([data-kept] *) [data-title-row]")), beside: [...document.querySelectorAll("[data-beside] [data-title-row]")].map(x) }
})
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] })
/** A finger from (x, y) along `path` ([dx, dy, ms] steps from the start), lifted at the end unless `lift` is false. */
async function finger(x, y, path, lift = true) {
  await touch("touchStart", x, y)
  let dx = 0, dy = 0
  for (const [px, py, ms] of path) { dx = px; dy = py; await wait(ms); await touch("touchMove", x + px, y + py) }
  if (lift) await touch("touchEnd", x + dx, y + dy)
}
/** A straight move by (dx, dy) over `ms`, in 16 ms steps. */
const line = (dx, dy, ms, from = [0, 0]) => { const n = Math.max(1, Math.round(ms / 16)); return Array.from({ length: n }, (_, i) => [from[0] + (dx * (i + 1)) / n, from[1] + (dy * (i + 1)) / n, 16]) }

/** Frame timings while `fn` runs: rAF gaps, long tasks, and layouts and style recalcs (CDP's counts). */
async function frames(label, fn) {
  await P.evaluate(() => {
    const w = window
    w.__gaps = []; w.__long = []; w.__on = true
    let last = performance.now()
    const tick = (t) => { w.__gaps.push(t - last); last = t; if (w.__on) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    try { w.__obs = new PerformanceObserver((l) => w.__long.push(...l.getEntries().map((e) => e.duration))); w.__obs.observe({ type: "longtask" }) } catch { /* none */ }
  })
  const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
  await fn()
  const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
  const r = await P.evaluate(() => { const w = window; w.__on = false; w.__obs?.disconnect(); return { gaps: w.__gaps.slice(1), long: w.__long } })
  const g = r.gaps.sort((a, b) => a - b), q = (p) => Math.round(g[Math.min(g.length - 1, Math.floor(g.length * p))] ?? 0)
  const out = { frames: g.length, p50: q(0.5), p95: q(0.95), max: Math.round(g.at(-1) ?? 0), longTasks: r.long.length, longMs: Math.round(r.long.reduce((a, b) => a + b, 0)),
    layouts: m1.LayoutCount - m0.LayoutCount, styles: m1.RecalcStyleCount - m0.RecalcStyleCount, layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000), scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000) }
  console.log(`     frames ${label}: ${JSON.stringify(out)}`)
  return out
}

try {
  await P.goto(`${B}#file/${encodeURIComponent(`Qa swipe/${NAMES[0]}.md`)}`)
  await P.waitForSelector("[data-pane-dots]", { timeout: 30000 })
  await until(() => P.locator("#main-scroll article.file-view:not([data-kept] *)").count(), 10000)
  await wait(800)
  check("a split tab of three: three dots, the first shown", (await P.locator("[data-pane-dots] button").count()) === 3 && (await at()) === 0, await at())
  const Y = 500, X = 200

  // ---------- a slow drag: the page and the next one follow the finger ----------
  const slow = await frames("slow drag", async () => {
    await finger(X, Y, line(-150, 4, 600), false)
    await wait(50)
  })
  const mid = await shift(), l = await lefts()
  check("slow drag: the page follows the finger (within the slop)", mid !== null && mid <= -138 && mid >= -152, mid)
  check("slow drag: the next pane shows beside it, coming in", l.beside.some((x) => x !== null && x > 390 - 150 && x < 390), l)
  await P.screenshot({ path: `${OUT}slow-mid.png` })
  check("slow drag: no layout per frame (one as it starts, drawing what's beside)", slow.layouts <= 6, slow)
  // The header follows: the next pane's name comes in, its dot darkens, as far as the page has come (150 of 410px).
  const head = await P.evaluate(() => {
    const op = (sel) => { const el = document.querySelector(sel); return el ? Math.round(Number(getComputedStyle(el).opacity) * 100) / 100 : null }
    const dot = (i) => getComputedStyle(document.querySelectorAll("[data-pane-dots] button span")[i]).backgroundColor
    return { now: op("[data-phone-title]"), next: op("[data-phone-title-beside='1']"), name: document.querySelector("[data-phone-title-beside='1']")?.textContent, d0: dot(0), d1: dot(1), d2: dot(2) }
  })
  check("slow drag: the header's name crossfades to the next pane's as far as it's come", head.name === "Swipe two" && head.next > 0.25 && head.next < 0.5 && Math.abs(head.now + head.next - 1) < 0.05, head)
  check("...and the next dot darkens on its way (between the others)", head.d1 !== head.d0 && head.d1 !== head.d2, head)
  // Back a little, held, and let go short of halfway: it springs back.
  await finger(X - 150, Y, line(80, 0, 200), false)
  await touch("touchEnd", X - 70, Y); await wait(700)
  check("short of halfway, held: springs back, the same pane", (await shift()) === 0 && (await at()) === 0, [await shift(), await at()])

  // Slow, past halfway, still at the end: it goes on to the next.
  await frames("slow drag past half and settle", async () => {
    await finger(X + 150, Y, [...line(-260, 0, 700), [-260, 0, 120]])
    await wait(700)
  })
  check("slow, past halfway: the next pane", (await at()) === 1 && (await shift()) === 0, [await at(), await shift()])
  check("...its page is the one on screen", (await lefts()).shown !== null && Math.abs((await lefts()).shown - 16) < 30, await lefts())

  // ---------- a flick: short and fast goes ----------
  const flick = await frames("flick and settle", async () => {
    await finger(X, Y, line(-70, 0, 64))
    await wait(700)
  })
  check("a flick (70px in 64ms) goes to the next pane", (await at()) === 2 && (await shift()) === 0, [await at(), await shift()])
  check("flick: no long tasks while it settles", flick.longTasks === 0, flick)

  // ---------- the end: it gives a little, springs back ----------
  await finger(X, Y, line(-200, 0, 400), false)
  const band = await shift()
  check("past the last pane: it gives, less than the finger", band !== null && band < -10 && band > -110, band)
  await touch("touchEnd", X - 200, Y); await wait(700)
  check("...and springs back, still the last", (await shift()) === 0 && (await at()) === 2, [await shift(), await at()])

  // ---------- vertical scrolls stay the page's ----------
  const y0 = await P.evaluate(() => scrollY)
  await finger(X, 600, line(8, -300, 300))
  await wait(400)
  check("a vertical drag scrolls the page, no sideways move", (await P.evaluate(() => scrollY)) > y0 + 100 && (await shift()) === 0 && (await at()) === 2, [y0, await P.evaluate(() => scrollY), await shift()])
  // Mostly down with some sideways (a thumb's arc): still a scroll.
  const y1 = await P.evaluate(() => scrollY)
  await finger(X, 600, line(60, -240, 300))
  await wait(400)
  check("a diagonal, mostly vertical drag: a scroll, not a swipe", (await shift()) === 0 && (await at()) === 2 && (await P.evaluate(() => scrollY)) !== y1, [await shift(), await at()])

  // ---------- back, the other way: the pane before keeps its place ----------
  await finger(60, Y, line(200, 0, 100))
  await wait(700)
  check("swiped right: the pane before", (await at()) === 1, await at())

  // ---------- the pane coming in shows where it was left, and lands there without a jump ----------
  await finger(X, Y, line(-250, 0, 400), false)
  await wait(100)
  const seen = await P.evaluate(() => {
    const el = [...document.querySelectorAll("[data-beside] p, [data-beside] .cm-line")].find((e) => e.textContent.includes("Swipe three paragraph") && e.getBoundingClientRect().top > 150)
    return el && { text: el.textContent.slice(0, 40), top: Math.round(el.getBoundingClientRect().top) }
  })
  await touch("touchEnd", X - 250, Y); await wait(700)
  const landed = await P.evaluate((t) => {
    const el = [...document.querySelectorAll("#main-scroll article.file-view:not([data-kept] *) p, #main-scroll article.file-view:not([data-kept] *) .cm-line")].find((e) => e.textContent.startsWith(t))
    return el && Math.round(el.getBoundingClientRect().top)
  }, seen?.text)
  check("the pane coming in is at the place it was left (scrolled down)", !!seen && !seen.text.includes("paragraph 1:"), seen)
  check("...and lands there: no jump up or down", !!seen && landed !== null && Math.abs(landed - seen.top) <= 2, [seen, landed])
  await finger(60, Y, line(200, 0, 100)); await wait(700)

  // ---------- caught mid-flight: it stays under the finger ----------
  await finger(X, Y, line(-90, 0, 48))
  await wait(60)
  const flying = await shift()
  await touch("touchStart", X, Y)
  await wait(32)
  const caught = await shift()
  check("caught while settling: held where it was (no jump)", flying !== null && flying < -40 && caught !== null && Math.abs(caught - flying) < 60, [flying, caught])
  await finger(X, Y, line(160, 0, 300).map(([x, y, ms]) => [x, y, ms]), false).catch(() => {})
  await touch("touchEnd", X + 160, Y); await wait(700)
  check("...and dragged back, it's the pane it came from", (await at()) === 1 && (await shift()) === 0, [await at(), await shift()])

  // ---------- a tap still taps ----------
  await P.touchscreen.tap(X, Y); await wait(300)
  check("a tap after swipes: nothing moves", (await shift()) === 0 && (await at()) === 1, [await shift(), await at()])
  check("at rest the header shows only the name on screen", !(await P.locator("[data-phone-title-beside]").count()) && (await P.evaluate(() => getComputedStyle(document.querySelector("[data-phone-title]")).opacity)) === "1")

  // ---------- the bottom bar swiped sideways: the tabs either side, as Safari's ----------
  const bar = await P.locator("[data-phone-bar]").boundingBox(), BY = bar.y + 22
  const title = () => P.locator("[data-phone-title]").innerText()
  await finger(X, BY, line(-160, 0, 500), false)
  const barMid = { shift: await shift(), beside: await P.evaluate(() => [...document.querySelectorAll("[data-beside] [data-title-row]")].map((e) => e.textContent.trim())), name: await P.locator("[data-phone-title-beside='1']").textContent().catch(() => null) }
  check("bar swiped left: the page follows, the next tab's page beside it, its name coming in", barMid.shift <= -140 && barMid.beside.some((t) => t.includes("Tab after")) && barMid.name === "Tab after", barMid)
  check("...the split's dots fade out", Number(await P.evaluate(() => getComputedStyle(document.querySelector("[data-pane-dots]")).opacity)) < 0.8)
  await P.screenshot({ path: `${OUT}bar-mid.png` })
  await touch("touchEnd", X - 160, BY); await wait(700)
  check("...let go short of halfway: back, the same tab", (await shift()) === 0 && (await title()) === "Swipe two", [await shift(), await title()])
  await finger(X, BY, line(-70, 0, 64)); await wait(800)
  check("bar flicked left: the next tab", (await shift()) === 0 && (await title()) === "Tab after", [await shift(), await title()])
  check("...nothing in the bar was tapped (no tab list, no menu)", !(await P.locator("dialog[open], #bar-menu").count()))
  await finger(X, BY, line(-200, 0, 300), false)
  const barBand = await shift()
  check("bar: past the last tab it gives", barBand < -10 && barBand > -110, barBand)
  await touch("touchEnd", X - 200, BY); await wait(700)
  await finger(X, BY, line(260, 0, 300)); await wait(800)
  check("bar swiped right: the tab before, the split, on the pane it showed", (await title()) === "Swipe two" && (await at()) === 1, [await title(), await at()])
  await finger(X, BY, line(80, 0, 64)); await wait(800)
  check("...and again: the first tab", (await title()) === "Tab before", await title())
  // Up is still the tab list's (core/pageLift.ts).
  await finger(X, BY, line(0, -200, 300)); await wait(900)
  check("bar dragged up still opens the tab list", (await P.locator("dialog[open] [data-tab-row]").count()) > 0)
  check("no sideways scroll", await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
} catch (e) {
  check(String(e?.stack ?? e), false)
}

// ---------- WebKit: touches made in the page (it has no CDP), the same moves ----------
let wk
try {
  wk = await webkitLaunch()
  const wctx = await wk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true })
  await wctx.addInitScript((tabs) => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); localStorage.setItem("vaultite.tabs", tabs); sessionStorage.setItem("qa", "1") } }, JSON.stringify(split))
  const W = watch(await wctx.newPage(), { label: "webkit", console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await W.goto(`${B}#file/${encodeURIComponent(`Qa swipe/${NAMES[0]}.md`)}`)
  await W.waitForSelector("[data-pane-dots]", { timeout: 30000 })
  await until(() => W.locator("#main-scroll article.file-view:not([data-kept] *)").count(), 10000)
  await wait(800)
  const wAt = () => W.evaluate(() => [...document.querySelectorAll("[data-pane-dots] button")].findIndex((b) => b.getAttribute("aria-current")))
  const wShift = () => W.evaluate(() => Math.round(new DOMMatrix(getComputedStyle(document.querySelector("#main-scroll > main")).transform).m41))
  /** A finger in the page: down at (x, y), moved along `path` (as line() makes), lifted unless `lift` is false. */
  await W.evaluate(() => {
    window.__fire = (target, type, cx, cy) => {
      const t = { identifier: 7, target, clientX: cx, clientY: cy }, e = new Event(type, { bubbles: true, cancelable: true })
      const on = type === "touchend" ? [] : [t]
      Object.defineProperties(e, { touches: { value: on }, targetTouches: { value: on }, changedTouches: { value: [t] } })
      target.dispatchEvent(e)
    }
  })
  const wLift = (x) => W.evaluate((x) => window.__fire(document.querySelector("#main-scroll > main article"), "touchend", x, 500), x)
  const wFinger = (x, y, path, lift = true) => W.evaluate(async ([x, y, path, lift]) => {
    const target = document.elementFromPoint(x, y)
    const fire = (type, cx, cy) => window.__fire(target, type, cx, cy)
    fire("touchstart", x, y)
    let cx = x, cy = y
    for (const [dx, dy, ms] of path) { await new Promise((r) => setTimeout(r, ms)); cx = x + dx; cy = y + dy; fire("touchmove", cx, cy) }
    if (lift) fire("touchend", cx, cy)
  }, [x, y, path, lift])
  await wFinger(200, 500, line(-150, 0, 500), false)
  const wl = await W.evaluate(() => [...document.querySelectorAll("[data-beside] [data-title-row]")].map((e) => Math.round(e.getBoundingClientRect().left)))
  check("webkit: a slow drag carries the page, the next pane beside it", Math.abs((await wShift()) + 150) <= 3 && wl.some((x) => x > 240 && x < 390), [await wShift(), wl])
  await W.screenshot({ path: `${OUT}webkit-mid.png` })
  await wLift(50)
  await wait(700)
  check("webkit: let go short of halfway, held: springs back", (await wShift()) === 0 && (await wAt()) === 0, [await wShift(), await wAt()])
  await wFinger(200, 500, line(-70, 0, 64)); await wait(700)
  check("webkit: a flick goes to the next pane", (await wAt()) === 1 && (await wShift()) === 0, [await wAt(), await wShift()])
  await wFinger(200, 500, line(-90, 0, 48)); await wait(80)
  const wFlying = await wShift()
  await wFinger(200, 500, [[0, 0, 16]], false)
  const wCaught = await wShift()
  check("webkit: caught while settling, held where it was", wFlying < -40 && Math.abs(wCaught - wFlying) < 60, [wFlying, wCaught])
  await wLift(200)
  await wait(800)
  check("webkit: ...let go there, it lands on a pane", (await wShift()) === 0 && (await wAt()) >= 1, [await wShift(), await wAt()])
  if ((await wAt()) === 1) { await wFinger(200, 500, line(-70, 0, 64)); await wait(700) }
  await wFinger(200, 500, line(-200, 0, 300), false)
  const wBand = await wShift()
  check("webkit: past the last pane it gives, less than the finger", wBand < -10 && wBand > -110, wBand)
  await wLift(0)
  await wait(700)
  check("webkit: ...and springs back", (await wShift()) === 0 && (await wAt()) === 2, [await wShift(), await wAt()])
  const wb = await W.locator("[data-phone-bar]").boundingBox()
  await wFinger(200, wb.y + 22, line(-70, 0, 64)); await wait(800)
  check("webkit: the bar flicked left shows the next tab", (await W.locator("[data-phone-title]").innerText()) === "Tab after" && (await wShift()) === 0, [await W.locator("[data-phone-title]").innerText(), await wShift()])
} catch (e) {
  check(`webkit: ${e?.stack ?? e}`, false)
} finally {
  await wk?.close()
  await browser.close()
  await api("DELETE", "file?path=Qa%20swipe").catch(() => {})
}
await done()
