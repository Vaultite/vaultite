// Phones' browser-like motion (core/motion.ts): each zoom, pull and slide runs to its end, leaves nothing behind and
// lands where it should, paused mid-way too. Sets appearance.json's pullActions (then unsets it): throwaway server.
//   node web/qa/tabmotion.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/tabmotion-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
// Frames mid-way only when asked (QA_FRAMES=1): a screenshot during a transition can hold up headless Chrome's next
// frame past the transition's 4s limit, which then fails it.
const FRAMES = !!process.env.QA_FRAMES
const shot = (o) => (FRAMES ? P.screenshot(o) : null)

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await ctx.addInitScript(() => {
  if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") }
  // Every transition's outcome: finished, or why it was skipped.
  window.__vt = []
  const start = document.startViewTransition?.bind(document)
  if (start) document.startViewTransition = (cb) => {
    const rec = { kind: document.documentElement.dataset.motion, ok: null }
    // What the tab list's bar holds as the new picture is taken (its +, the Inbox): drawn with the rest, not after.
    const t = start(async () => { await cb(); rec.bar = document.getElementById("sheet-bar")?.children.length ?? 0 })
    window.__vt.push(rec)
    t.ready.catch((e) => { rec.err = String(e) })
    t.finished.then(() => { rec.ok = !rec.err }, (e) => { rec.err = String(e); rec.ok = false })
    return t
  }
  // The tab zooms (Web Animations): what each moved (the card's picture flying, or the new page), and whether it ran to
  // its end.
  window.__zooms = []
  // While __hold is set, animations start paused (in __held), to be stepped through.
  window.__held = []
  const animate = Element.prototype.animate
  Element.prototype.animate = function (frames, o) {
    const a = animate.call(this, frames, o)
    if (window.__hold) { a.pause(); window.__held.push(a) }
    const kind = this.matches("[data-tab-hero]") ? "hero" : this.matches("#main-scroll > main") ? "new" : null
    if (kind && JSON.stringify(frames).includes("transform")) {
      const rec = { kind, ok: null }
      window.__zooms.push(rec)
      a.finished.then(() => { rec.ok = true }, () => { rec.ok = "cut" })
    }
    return a
  }
})
const P = watch(await ctx.newPage(), { console: true, ignore: null })

const files = await fetch(`${B}api/state`).then((r) => r.json()).then((s) => s.files.files.filter((f) => f.path.startsWith("Notes/") && f.path.endsWith(".md")).map((f) => f.path))
const [a, b] = files
await P.goto(`${B}#file/${encodeURIComponent(a)}`)
await P.waitForSelector("[data-phone-bar]")
await wait(800)
// A second tab: a blank one, then the file opened in it.
await P.click("[data-bar=new]")
await wait(800)
await P.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(b)}`)
await wait(800)
const last = () => P.evaluate(() => window.__vt.at(-1))
const zoomed = () => P.evaluate(() => window.__zooms.at(-1))
const zooms = () => P.evaluate(() => window.__zooms.length)
// Until every transition started has ended (finished or failed; 5s at most), then a moment for the page.
const settled = async () => {
  await wait(150)
  for (let i = 0; i < 50 && await P.evaluate(() => [...window.__vt, ...window.__zooms].some((r) => r.ok === null)); i++) await wait(100)
  await wait(400)
  return P.evaluate(() => ({ motion: document.documentElement.dataset.motion ?? null, zoom: "tabZoom" in document.documentElement.dataset,
    vars: document.documentElement.style.cssText, running: document.getAnimations().filter((a) => a.playState === "running").length,
    moved: [...document.querySelectorAll("#main-scroll > main, [data-phone-header], [data-tabs-pager]")].some((e) => e.style.transform || e.getAnimations().length),
    copies: document.querySelectorAll("body > div.pointer-events-none.fixed dialog, [data-tab-hero]").length }))
}
const clean = (s) => !s.motion && !s.zoom && !/--m(to|from)/.test(s.vars) && !s.moved && !s.copies
const title = () => P.evaluate(() => document.querySelector("[data-phone-title]")?.textContent ?? "")
const stem = (p) => p.split("/").pop().replace(/\.md$/, "")

// The zooms stepped through: at each point the picture fills its box's width from its top, unstretched (the page's
// shape), and the box is inside the list; at the start the box is the page, at the end the card's.
const stepped = (dir) => P.evaluate(async (dir) => {
  const out = []
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height } }
  const page = (() => { const t = document.querySelector("[data-phone-header]").offsetHeight; return { l: 0, t, w: innerWidth, h: innerHeight - document.querySelector("[data-phone-bar]").offsetHeight - t } })()
  for (const f of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    for (const a of window.__held) { const t = a.effect.getComputedTiming(); a.currentTime = f * (t.delay + t.duration) }
    const win = document.querySelector("[data-tab-hero] [data-hero-window]"), pic = win?.querySelector("img, span")
    const list = document.querySelector("dialog[open] .overflow-y-auto")
    if (!win || !pic || !list) { out.push({ f, missing: true }); continue }
    const w = box(win), p = box(pic), l = box(list)
    const near = (a, b, d = 1.5) => Math.abs(a - b) <= d
    out.push({ f, w, p, ok: near(p.l, w.l) && near(p.t, w.t) && near(p.w, w.w) && Math.abs(p.h / p.w - page.h / page.w) < 0.02
      && w.l >= l.l - 1 && w.t >= l.t - 1 && w.l + w.w <= l.l + l.w + 1 && w.t + w.h <= l.t + l.h + 1
      && (f !== (dir === "out" ? 0 : 1) || (near(w.l, page.l, 2) && near(w.t, page.t, 2) && near(w.w, page.w, 2) && near(w.h, page.h, 2))) })
  }
  // (what starts later, the page drawn under a card growing, runs as usual)
  window.__hold = false
  for (const a of window.__held) a.finish()
  window.__held = []
  return out
}, dir)
await P.evaluate(() => { window.__hold = true })
await P.click("[data-tabs-button]")
await P.waitForSelector("[data-tab-hero]")
let frames = await stepped("out")
check("tab list opening, stepped: the picture stays in its card, unstretched, inside the list", frames.every((x) => x.ok), frames.filter((x) => !x.ok))
await wait(600)
await P.evaluate(() => { window.__hold = true })
await P.click("[data-sheet-done]")
await P.waitForSelector("[data-tab-hero]")
frames = await stepped("in")
check("Done, stepped: the picture stays in its card, unstretched, inside the list", frames.every((x) => x.ok), frames.filter((x) => !x.ok))
await wait(800)

// Done tapped while the list is still opening: the page turns around from where it had got to, not from its card.
const win = () => P.evaluate(() => { const r = document.querySelector("[data-tab-hero] [data-hero-window]")?.getBoundingClientRect(); return r && [r.left, r.top, r.width, r.height] })
await P.evaluate(() => { window.__hold = true })
await P.click("[data-tabs-button]")
await P.waitForSelector("[data-tab-hero]")
await P.evaluate(() => { for (const a of window.__held) { const t = a.effect.getComputedTiming(); a.currentTime = 0.4 * (t.delay + t.duration) } window.__held = [] })
const caughtAt = await win()
await P.click("[data-sheet-done]")
await P.waitForSelector("[data-tab-hero]")
const backFrom = await win()
await P.evaluate(() => { window.__hold = false; for (const a of window.__held) a.finish(); window.__held = [] })
check("Done mid-opening: the page turns around where it was", !!caughtAt && !!backFrom && caughtAt.every((v, i) => Math.abs(v - backFrom[i]) < 2) && caughtAt[2] < 380, { caughtAt, backFrom })
const mid = await settled()
check("Done mid-opening: list closed, nothing left behind", !(await P.isVisible("[data-tab-card]")) && clean(mid), mid)

// Tabs: open the list.
await P.click("[data-tabs-button]")
await wait(150); await shot({ path: `${OUT}open-mid.png` })
let s = await settled()
check("tab list: zoomed", (await zoomed())?.ok === true && (await zoomed()).kind === "hero", await zoomed())
check("tab list: open", await P.isVisible("[data-tab-card]"), null)
check("tab list: card pictures are the page's shape", await P.evaluate(() => {
  const s = document.querySelector("[data-tab-pic]").getBoundingClientRect(), h = document.querySelector("[data-phone-header]").offsetHeight, b = document.querySelector("[data-phone-bar]").offsetHeight
  return Math.abs(s.width / s.height - innerWidth / (innerHeight - h - b)) < 0.02
}), null)
check("tab list: nothing left behind", clean(s), s)
await P.screenshot({ path: `${OUT}open-end.png` })

// Pick the other card.
const other = await P.evaluate(() => { const r = [...document.querySelectorAll("[data-tab-row]")].find((r) => !r.querySelector("[aria-current]")); return r?.dataset.tabRow })
await P.click(`[data-tab-row="${other}"] button[aria-label]:not([aria-label^=Close])`)
await wait(150); await shot({ path: `${OUT}pick-mid.png` })
s = await settled()
check("pick: zoomed", (await zoomed())?.ok === true && (await zoomed()).kind === "hero", await zoomed())
check("pick: list closed", !(await P.isVisible("[data-tab-card]")), null)
check("pick: the other tab shows", (await title()) === stem(a), await title())
check("pick: nothing left behind", clean(s), s)

// Done zooms into the tab on screen.
await P.click("[data-tabs-button]"); await settled()
const z0 = await zooms()
await P.click("[data-sheet-done]")
s = await settled()
check("done: zoomed", (await zooms()) === z0 + 1 && (await zoomed())?.ok === true, await zoomed())
check("done: nothing left behind", clean(s), s)
check("done: list closed, same tab", !(await P.isVisible("[data-tab-card]")) && (await title()) === stem(a), await title())

// Back and Forward.
check("forward off before going back", await P.isDisabled("[data-bar=forward]"), null)
await P.click("[data-bar=back]")
await wait(120); await shot({ path: `${OUT}back-mid.png` })
s = await settled()
check("back: transition ran", (await last())?.ok === true && (await last()).kind === "back", await last())
check("back: the tab before", (await title()) === stem(b), await title())
check("forward lit after back", await P.isEnabled("[data-bar=forward]"), null)
await P.click("[data-bar=forward]")
s = await settled()
check("forward: transition ran", (await last())?.ok === true && (await last()).kind === "forward", await last())
check("forward: the tab after", (await title()) === stem(a), await title())
check("forward: nothing left behind", clean(s), s)

// Edge swipes are the drawers': a swipe from the left edge opens the sidebar and stays on the tab, with Back available.
// A finger (the drawer's edge takes the pointer only once it's moved sideways, so a mouse would have left the strip).
const cdp = await P.context().newCDPSession(P)
const swipe = async (x0, x1) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: 400 }] })
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: 402 }] }); await wait(16) }
  await P.screenshot({ path: `${OUT}swipe-${x0}-${x1}.png` })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
const before = (await P.evaluate(() => window.__vt.length))
await swipe(6, 260)
s = await settled()
check("left edge swipe: the drawer, not back", (await title()) === stem(a) && (await P.evaluate(() => window.__vt.length)) === before
  && (await P.locator("[data-phone-drawer=left][aria-hidden=false]").count()) === 1, { t: await title(), s })
await P.keyboard.press("Escape"); await wait(400)

// A finger's drag: from (x0, y0) to (x1, y1) in steps, let go at the end.
const drag = async (x0, y0, x1, y1, mid) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] })
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y: y0 + ((y1 - y0) * i) / 12 }] }); await wait(20) }
  await wait(200)
  const seen = await mid?.()
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  return seen
}
const H = 844, count = () => P.locator("[data-tabs-button]").innerText().then((t) => Number(t.trim()))

// The bar dragged up: the page shrinks after the finger, then into its card in the tab list.
const z1 = await zooms()
const lifted = await drag(195, H - 25, 195, H - 280, () => P.evaluate(() => document.querySelector("#main-scroll > main")?.style.transform ?? ""))
s = await settled()
check("bar dragged up: the page follows the finger", lifted.includes("scale"), lifted)
check("bar dragged up: the tab list zooms open", (await zooms()) === z1 + 1 && (await zoomed()).ok === true && await P.isVisible("[data-tab-card]"), await zoomed())
check("bar dragged up: nothing left behind", clean(s) && !(await P.evaluate(() => "pageLift" in document.documentElement.dataset)), s)
await P.click("[data-sheet-done]"); s = await settled()
const n = await zooms()
await drag(195, H - 25, 195, H - 55)
s = await settled()
check("bar dragged a little: springs back, no tab list", (await zooms()) === n && !(await P.isVisible("[data-tab-card]")) && clean(s), s)

// The page pulled down from its top: New note, Open a file, Close tab (the default pullActions), picked by going sideways.
const t0 = await title(), c0 = await count()
const pulled = await drag(195, 300, 195, 470, () => P.evaluate(() => [...document.querySelectorAll("[data-pull][data-on]")].map((e) => e.dataset.pull)))
await wait(400)
check("pull down: Open a file picked in the middle opens the quick switcher, the tab stays", pulled.join() === "switcher:open" && (await P.locator("[role=dialog][aria-label=\"Search\"]").count()) > 0 && (await title()) === t0 && (await count()) === c0, { pulled, t: await title() })
await P.keyboard.press("Escape"); await wait(300)
check("pull down: the page back in place", !(await P.evaluate(() => document.querySelector("#main-scroll > main")?.style.transform)) && !(await P.locator("[data-pull-actions]").count()))
const right = await drag(195, 300, 300, 470, () => P.evaluate(() => [...document.querySelectorAll("[data-pull][data-on]")].map((e) => e.dataset.pull)))
await wait(600)
check("pull down and right: Close tab", right.join() === "tab:close" && (await count()) === c0 - 1, { right, n: await count() })
// Its commands are appearance.json's pullActions: the app follows a change at once.
const api = apiAt(B)
await api("PATCH", "config/appearance", { pullActions: ["palette:open", "file:new", "tab:close"] })
await wait(1200)
const offered = await drag(195, 300, 90, 470, () => P.evaluate(() => [...document.querySelectorAll("[data-pull]")].map((e) => `${e.dataset.pull}${e.dataset.on ? "*" : ""}`)))
await wait(400)
check("pull down and left: the commands pullActions names, its left one run", offered.join() === "palette:open*,file:new,tab:close" && (await P.locator("[role=dialog][aria-label=\"Command palette\"]").count()) > 0, offered)
await P.keyboard.press("Escape"); await wait(300)
await api("PATCH", "config/appearance", { pullActions: null })

// A new tab from the bar's +.
await P.click("[data-bar=new]")
await wait(120); await shot({ path: `${OUT}new-mid.png` })
s = await settled()
check("new tab: zoomed", (await zoomed())?.ok === true && (await zoomed()).kind === "new", await zoomed())
check("new tab: nothing left behind", clean(s), s)
check("new tab: blank", (await P.evaluate(() => location.hash)) === "#new", await P.evaluate(() => location.hash))

// A card closed right after the list opens (nothing drawn since): the others glide on from where they were.
await P.click("[data-tabs-button]"); await settled()
const glide = await P.evaluate(() => new Promise((done) => {
  const grid = document.querySelector("[data-tabs-grid]"), o = grid.getBoundingClientRect()
  const at = () => new Map([...grid.querySelectorAll("[data-tab-row]")].map((r) => { const b = r.querySelector("[data-tab-card]").getBoundingClientRect(); return [r.dataset.tabRow, [b.left - o.left, b.top - o.top]] }))
  const was = at(), gone = [...grid.querySelectorAll("[data-tab-row]")].find((r) => !r.querySelector("[aria-current]"))
  new MutationObserver((_, mo) => {
    if (gone.isConnected) return
    mo.disconnect()
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = 0 }
    const now = at()
    done({ moved: [...now].filter(([id, [x, y]]) => Math.hypot(x - was.get(id)[0], y - was.get(id)[1]) > 2).map(([id]) => id), n: now.size })
  }).observe(grid, { childList: true, subtree: true })
  gone.querySelector("button[aria-label^=Close]").click()
}))
check("a card closed: the others start their glide where they were", glide.n >= 1 && !glide.moved.length, glide)
await P.evaluate(() => { for (const a of document.getAnimations()) a.finish() })
await P.click("[data-sheet-done]"); await settled()

await done()
