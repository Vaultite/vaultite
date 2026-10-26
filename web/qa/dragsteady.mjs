// Dragging moves only what's dragged, with scrollbars that take room (Linux's, Windows', a Mac's set to Always; headless
// Chrome hides them, this run shows them): no scrollbar comes or goes during a drag (core/drag.ts, core/slide.ts), so
// Pinned's tiles keep their columns when a file dragged in overflows their panel (plugins/core/pages), the tab strip's
// own scrollbar stays hidden with more tabs than fit (components/Tabs.tsx), and a move that changes no drop redraws
// nothing (useDrag's picks, useDropHit); a sheet's scrollbar takes its padding (components/DetailSheet.tsx). WRITES pins
// and Pinned's Show as: throwaway server only.
//   node web/qa/dragsteady.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/dragsteady-shots/"], browser, check, watch, done } = await qa(import.meta.url, { chrome: { ignoreDefaultArgs: ["--hide-scrollbars"] } })
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)

// Each frame of a drag: every scroller's scrollbar room (its width or height), and the components React drew.
const WATCH = () => {
  const W = window.__drag = { changes: [], moves: 0, rendered: 0 }
  const COMP = new Set([0, 1, 11, 14, 15])
  const walk = (f) => {
    for (let c = f.child; c; c = c.sibling) {
      const a = c.alternate
      if (!a) continue
      if (COMP.has(c.tag) && (c.flags & 1)) W.rendered++
      if (c.child !== a.child) walk(c)
    }
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(), inject() { return 1 }, checkDCE() {},
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { try { const cur = root.current; if (cur.alternate && cur.child !== cur.alternate.child) walk(cur) } catch {} },
  }
  addEventListener("pointermove", () => { if (document.documentElement.hasAttribute("data-dragging")) W.moves++ }, true)
  const name = (e) => `${e.tagName.toLowerCase()}${Object.keys(e.dataset).slice(0, 2).map((k) => `[data-${k}]`).join("")}`
  let seen = new Map()
  const tick = () => {
    if (document.documentElement.hasAttribute("data-dragging")) {
      const now = new Map()
      for (const e of document.querySelectorAll("*")) {
        if (e.offsetWidth === e.clientWidth && e.offsetHeight === e.clientHeight && !seen.has(e)) continue
        const s = getComputedStyle(e)
        if (!/auto|scroll/.test(s.overflowX + s.overflowY)) continue
        const room = `${e.offsetWidth - e.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth)},${e.offsetHeight - e.clientHeight - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth)}`
        const was = seen.get(e)
        if (was !== undefined && was !== room) W.changes.push(`${name(e)} ${was} -> ${room}`)
        now.set(e, room)
      }
      seen = now
    } else seen = new Map()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
const reset = () => page.evaluate(() => Object.assign(window.__drag, { changes: [], moves: 0, rendered: 0 }))
const read = () => page.evaluate(() => window.__drag)
/** Press at `from`, move to each point in turn (`steps` moves each), then Escape: nothing dropped. */
async function drag(from, points, steps = 12) {
  await page.mouse.move(...from); await page.mouse.down()
  let at = from
  for (const p of points) {
    for (let i = 1; i <= steps; i++) { await page.mouse.move(at[0] + (p[0] - at[0]) * i / steps, at[1] + (p[1] - at[1]) * i / steps); await wait(16) }
    at = p
  }
}
/** A note's row in the file tree that a press lands on (the tree follows the open note: its first may be scrolled off). */
const treeRow = () => page.evaluate(() => {
  for (const r of document.querySelectorAll("[data-tree-path$='.md']")) {
    const b = r.getBoundingClientRect()
    if (document.elementFromPoint(b.x + 40, b.y + b.height / 2)?.closest("[data-tree-path]") === r) return b.toJSON()
  }
})
const letGo = async () => { await page.keyboard.press("Escape"); await page.mouse.up(); await wait(250) }

const PINS = ["Start here.md", "Notes/How this vault works.md", "Notes/Lisbon trip.md", "Projects/Lighthouse.md", "Dashboards/People.md", "Dashboards/Design.md", "Dashboards/Queue.md", "ME.md"]
const pinnedBefore = (await api("GET", "config/pages")).pinned
const showBefore = (await api("GET", "config/plugin/pages")).show ?? null
await api("PATCH", "config/pages", { pinned: PINS })
await api("PATCH", "config/plugin/pages", { show: "tiles" })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
await ctx.addInitScript(WATCH)
// (a sidebar just wide enough for four tiles a row: a scrollbar's room would leave three)
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); localStorage.setItem("vaultite.prefs", JSON.stringify({ sidebarWidth: 214 })); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
try {
  await page.goto(`${B}#new`)
  await page.waitForSelector("[data-pin-tiles] [data-pin]", { timeout: 15000 })
  await until(async () => (await page.locator("[data-pin-tiles] [data-pin]").count()) === PINS.length, 5000)
  await wait(800)

  // Pinned squeezed (a full sidebar gives it no more room than its tiles): a file from the tree dragged in makes its gap
  // a third row, and the panel scrolls.
  const tiles = () => page.evaluate(() => {
    const nav = document.querySelector("[data-pin-tiles]"), box = nav.closest("[data-panel-scroll]"), grid = nav.firstElementChild
    return { cols: getComputedStyle(grid).gridTemplateColumns.split(" ").length, over: box.scrollHeight > box.clientHeight,
      xs: [...grid.querySelectorAll(":scope > [data-pin], :scope > [data-slide]")].map((t) => Math.round(t.getBoundingClientRect().left * 10) / 10) }
  })
  await page.evaluate(() => { const box = document.querySelector("[data-pin-tiles]").closest("[data-panel-scroll]"); box.style.maxHeight = `${box.clientHeight}px` })
  const rest = await tiles()
  check("Pinned: four tiles a row at rest", rest.cols === 4, rest)
  const row = await treeRow()
  const sixth = await page.locator("[data-pin-tiles] [data-pin]").nth(5).boundingBox()
  await reset()
  await drag([row.x + 40, row.y + row.height / 2], [[sixth.x + sixth.width * 0.3, sixth.y + sixth.height / 2]], 20)
  await wait(400)
  const mid = await tiles(), during = await read()
  await page.screenshot({ path: `${OUT}pinned.png`, clip: { x: 0, y: 0, width: 260, height: 300 } })
  await letGo()
  check("Pinned: a file dragged in makes a gap among the tiles, overflowing the panel", mid.over && mid.xs.length === PINS.length + 1, mid)
  check("Pinned: its tiles keep their four columns (no scrollbar's room taken mid-drag)", mid.cols === 4 && mid.xs.every((x) => rest.xs.some((r) => Math.abs(r - x) < 0.6)), { rest: rest.xs, mid: mid.xs })
  check("Pinned: no scrollbar came or went while dragging", !during.changes.length, during.changes)

  // More tabs than fit: the strip scrolls sideways with its scrollbar hidden, and stays so while a file is dragged along it.
  for (let i = 2; i <= 31; i++) {
    await page.click("[data-tab-bar] button[aria-label='New tab']")
    await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, `Daily/2026-10-${String(i).padStart(2, "0")}.md`)
    await wait(120)
  }
  await until(async () => (await page.locator("[data-tab-bar] [data-tab-id]").count()) >= 25, 8000)
  const strip = () => page.evaluate(() => { const r = document.querySelector("[data-tab-bar] [data-select-list]"); return { over: r.scrollWidth > r.clientWidth, bar: r.offsetHeight - r.clientHeight, width: getComputedStyle(r).scrollbarWidth } })
  const s0 = await strip()
  check("tab strip: more tabs than fit scroll with no scrollbar", s0.over && s0.bar === 0 && s0.width === "none", s0)
  const bar = await page.locator("[data-tab-bar]").first().boundingBox()
  const file = await treeRow()
  await reset()
  await drag([file.x + 40, file.y + file.height / 2], [[bar.x + 120, bar.y + 20], [bar.x + bar.width - 60, bar.y + 20], [bar.x + bar.width / 2, bar.y + 300]], 15)
  const s1 = await strip(), along = await read()
  await page.screenshot({ path: `${OUT}strip.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
  // A move that changes no drop (the pointer within a pane's middle) redraws nothing.
  await reset()
  for (let i = 1; i <= 20; i++) { await page.mouse.move(bar.x + bar.width / 2 + i * 3, bar.y + 300 + i * 2); await wait(16) }
  const still = await read()
  await letGo()
  check("tab strip: still no scrollbar while a file is dragged along it", s1.bar === 0, s1)
  check("tabs and panes: no scrollbar came or went while dragging", !along.changes.length, along.changes)
  check("a move that changes no drop redraws (almost) nothing", still.moves >= 15 && still.rendered / still.moves < 2, still)
  check("the drag ended with Escape", !(await page.evaluate(() => document.documentElement.hasAttribute("data-dragging"))))

  // A sheet that scrolls (Customize sidebars, whose lists grow under a drag) keeps its content as wide as without a
  // scrollbar: lined up with its X, the scrollbar in its padding.
  await page.evaluate(() => { location.hash = `${location.hash.replace(/^#/, "")}/sidebars` })
  await page.waitForSelector("[data-customize-sidebars] [data-row]", { timeout: 10000 }); await wait(500)
  const sheet = await page.evaluate(() => {
    const c = document.querySelector("[data-customize-sidebars]"), x = document.querySelector("dialog[open] button[aria-label=Close] svg")
    let sc = c; while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
    return { content: Math.round(c.getBoundingClientRect().right), x: Math.round(x.getBoundingClientRect().right), bar: sc.offsetWidth - sc.clientWidth }
  })
  check("a sheet's content lines up with its X, its scrollbar in the padding", sheet.bar > 0 && Math.abs(sheet.content - sheet.x) <= 1, sheet)
} finally {
  await api("PATCH", "config/pages", { pinned: pinnedBefore })
  await api("PATCH", "config/plugin/pages", { show: showBefore })
}
await done()
