// Phones' browser-like motion (core/motion.ts): the tab list zooming out of the page as it opens (its button, or the bar
// dragged up), a page pulled down for its actions, the list zooming into a card picked and on Done, a new tab out of its
// +, Back and Forward sliding (Forward lit only after Back), and the edge swipes never going back or forward (they're
// the drawers'). Each runs to its end, leaves nothing behind (no data-motion, no transform, no copy of the list) and
// lands where it should. Frames mid-way go to the out dir.
// Opens files and tabs only (the workspace's tabs, device-local): run it against a throwaway server.
//   node web/qa/tabmotion.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"
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
  const animate = Element.prototype.animate
  Element.prototype.animate = function (frames, o) {
    const a = animate.call(this, frames, o)
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

// The page pulled down from its top: New note, Refresh, Close tab, picked by going sideways.
const t0 = await title(), c0 = await count()
const pulled = await drag(195, 300, 195, 470, () => P.evaluate(() => [...document.querySelectorAll("[data-pull][data-on]")].map((e) => e.dataset.pull)))
await wait(400)
check("pull down: Refresh picked in the middle, the tab stays", pulled.join() === "refresh" && (await title()) === t0 && (await count()) === c0, { pulled, t: await title() })
check("pull down: the page back in place", !(await P.evaluate(() => document.querySelector("#main-scroll > main")?.style.transform)) && !(await P.locator("[data-pull-actions]").count()))
const right = await drag(195, 300, 300, 470, () => P.evaluate(() => [...document.querySelectorAll("[data-pull][data-on]")].map((e) => e.dataset.pull)))
await wait(600)
check("pull down and right: Close tab", right.join() === "close" && (await count()) === c0 - 1, { right, n: await count() })

// A new tab from the bar's +.
await P.click("[data-bar=new]")
await wait(120); await shot({ path: `${OUT}new-mid.png` })
s = await settled()
check("new tab: zoomed", (await zoomed())?.ok === true && (await zoomed()).kind === "new", await zoomed())
check("new tab: nothing left behind", clean(s), s)
check("new tab: blank", (await P.evaluate(() => location.hash)) === "#new", await P.evaluate(() => location.hash))

await done()
