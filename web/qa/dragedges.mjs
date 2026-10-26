// Drags at their edges (core/drag.ts' edgeScroller and pastEnd, components/Resizer.tsx): Escape, gaps, scrolling
// panels, the wheel mid-drag. WRITES pins and Pinned's Show as: throwaway server.
//   node web/qa/dragedges.mjs <base url>
import { apiAt, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url, { chrome: { ignoreDefaultArgs: ["--hide-scrollbars"] } })
const api = apiAt(B)
const glide = async (page, [x0, y0], [x1, y1], steps = 12) => { for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await wait(16) } }
const letGo = async (page) => { await page.keyboard.press("Escape"); await page.mouse.up(); await wait(250) }

const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const pinnedBefore = (await api("GET", "config/pages")).pinned
const showBefore = (await api("GET", "config/plugin/pages")).show ?? null
try {
  // A canvas card moved, then Escape: back where it was, and letting go after moves nothing.
  await page.goto(`${B}#file/${encodeURIComponent("Projects/Lighthouse/Launch plan.canvas")}`)
  await page.waitForSelector("[data-canvas-node]", { timeout: 15000 })
  await wait(1000)
  const card = page.locator("[data-canvas-node]").first()
  const at = () => card.boundingBox().then((b) => [Math.round(b.x), Math.round(b.y)])
  const c0 = await at(), cb = await card.boundingBox()
  await page.mouse.move(cb.x + 10, cb.y + 10); await page.mouse.down()
  await glide(page, [cb.x + 10, cb.y + 10], [cb.x + 130, cb.y + 70])
  const c1 = await at()
  await page.keyboard.press("Escape"); await wait(100)
  const c2 = await at()
  await glide(page, [cb.x + 130, cb.y + 70], [cb.x + 170, cb.y + 90], 4)
  await page.mouse.up(); await wait(300)
  const c3 = await at()
  check("canvas: a card follows the pointer", c1[0] - c0[0] > 60, { c0, c1 })
  check("canvas: Escape puts it back, and the release after moves nothing", c2.join() === c0.join() && c3.join() === c0.join(), { c0, c2, c3 })

  // The sidebar's width dragged, then Escape: back to its width.
  const aside = () => page.evaluate(() => Math.round(document.querySelector("aside").getBoundingClientRect().width))
  const w0 = await aside()
  const edge = await page.locator("[role=separator][aria-label='Resize the sidebar']").boundingBox()
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 300); await page.mouse.down()
  await glide(page, [edge.x + edge.width / 2, edge.y + 300], [edge.x + 90, edge.y + 300], 6)
  const w1 = await aside()
  // (it glides back: measured once there)
  await page.keyboard.press("Escape"); await wait(400)
  const w2 = await aside()
  await page.mouse.up(); await wait(300)
  check("sidebar: Escape mid-resize puts its width back", w1 > w0 + 40 && w2 === w0 && (await aside()) === w0, { w0, w1, w2 })

  // The status bar: an item dragged along it, the items past where the kinds meet stay put (the line keeps its room).
  await page.goto(`${B}#file/${encodeURIComponent("Notes/Lisbon trip.md")}`)
  await page.waitForSelector("[data-status-items] > [data-status-key]", { timeout: 15000, state: "attached" })
  await wait(1500)
  const lastX = () => page.evaluate(() => { const els = [...document.querySelectorAll("[data-status-items] > [data-status-key]")].filter((e) => e.offsetWidth); return Math.round(els.at(-1).getBoundingClientRect().right) })
  const hasSep = await page.locator("[data-status-items] > [data-status-sep]").count()
  const s0 = await lastX(), first = await page.locator("[data-status-items] > [data-status-key]:visible").first().boundingBox()
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down()
  await glide(page, [first.x + first.width / 2, first.y + first.height / 2], [first.x + first.width / 2 + 60, first.y + first.height / 2])
  await wait(300)
  const s1 = await lastX(), faded = await page.evaluate(() => [...document.querySelectorAll("[data-status-items] > [data-status-sep]")].some((e) => e.style.opacity === "0"))
  await letGo(page)
  check("status bar: an item dragged along leaves the last one where it was", !hasSep || (Math.abs(s1 - s0) <= 1 && !faded), { hasSep, s0, s1, faded })

  // A dashboard being edited: a card held over the gap between two cells still has a place (the line drawn there).
  await page.goto(`${B}#file/${encodeURIComponent("Dashboards/People.md")}`)
  await page.waitForSelector("[data-pane] .cm-content, [data-pane] article", { timeout: 15000 })
  await wait(1500)
  await page.locator("[data-pane] .cm-content, [data-pane] article").first().click().catch(() => {})
  await page.keyboard.press("ControlOrMeta+e"); await wait(1200)
  const cells = await page.evaluate(() => [...document.querySelectorAll("[data-dashboard-grid] [data-cell]")].map((c) => { const r = c.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom } }))
  // (two side by side other than the first card's own, which is the one dragged: beside it is where it is already)
  const pair = cells.findLastIndex((c, i) => i > 1 && Math.abs(c.t - cells[i - 1].t) < 2 && c.l - cells[i - 1].r > 4)
  if (pair > 1) {
    await page.locator("[data-dashboard-grid] [data-card]").first().hover(); await wait(300)
    const grip = await page.locator("[data-dashboard-grid] .cm-card-grip").first().boundingBox()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down()
    const gapX = (cells[pair - 1].r + cells[pair].l) / 2, gapY = cells[pair].t + 40
    await glide(page, [grip.x + grip.width / 2, grip.y + grip.height / 2], [gapX, gapY], 16)
    await wait(200)
    const line = await page.locator("[data-dashboard-grid] [data-cell] > span[aria-hidden].bg-primary").count()
    await letGo(page)
    check("dashboard: a card held over the gap between cells has a place there", line === 1, { line, gapX })
  } else check("dashboard: two cells side by side to drag between", false, cells)

  // Pinned as tiles, in a panel too short for them; and a file held at the Files panel's top.
  await api("PATCH", "config/pages", { pinned: ["Start here.md", "Notes/How this vault works.md", "Notes/Lisbon trip.md", "Projects/Lighthouse.md", "Dashboards/People.md", "Dashboards/Design.md", "Dashboards/Queue.md", "ME.md", "Projects/Garden planner.md"] })
  await api("PATCH", "config/plugin/pages", { show: "tiles" })
  await page.goto(`${B}#new`)
  await page.waitForSelector("[data-pin-tiles] [data-pin]", { timeout: 15000 })
  await until(async () => (await page.locator("[data-pin-tiles] [data-pin]").count()) === 9, 5000)
  await wait(600)
  const pinBox = () => page.evaluate(() => { const b = document.querySelector("[data-pin-tiles]").closest("[data-panel-scroll]"); const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: Math.round(r.height), scroll: b.scrollTop } })
  const p0 = await pinBox()
  const files = await page.locator("[data-panel='files:files']").boundingBox()
  const row = await page.locator("[data-tree-path$='.md']").first().boundingBox()
  await page.mouse.move(row.x + 40, row.y + row.height / 2); await page.mouse.down()
  await glide(page, [row.x + 40, row.y + row.height / 2], [row.x + 40, files.y + 4])
  await wait(400)
  const p1 = await pinBox(), taken = await page.evaluate(() => !!document.querySelector("[data-pin-tiles] [data-drop-preview]") || document.querySelector("[data-pin-tiles] > div")?.hasAttribute("data-drop-preview"))
  await letGo(page)
  check("a file held at the top of the Files panel isn't dropped on Pinned above it", !taken && p1.h === p0.h, { p0, p1, taken })

  await page.evaluate(() => { const b = document.querySelector("[data-pin-tiles]").closest("[data-panel-scroll]"); b.style.maxHeight = "96px" })
  await wait(200)
  const sq = await pinBox(), tile = await page.locator("[data-pin-tiles] [data-pin]").first().boundingBox()
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2); await page.mouse.down()
  await glide(page, [tile.x + tile.width / 2, tile.y + tile.height / 2], [tile.x + tile.width / 2, sq.bottom - 6])
  await wait(700)
  const sq1 = await pinBox()
  await letGo(page)
  check("Pinned: a tile held near the bottom of a short panel scrolls it", sq1.scroll > sq.scroll, { sq, sq1 })
  // Pinned's menu moves a tile, as a drag would (from the keyboard too).
  await page.locator("[data-pin-tiles] [data-pin]").first().click({ button: "right" }); await wait(200)
  const moveRight = page.locator("[role=menu]").getByRole("menuitem", { name: "Move right", exact: true })
  if (await moveRight.count()) { await moveRight.click(); await wait(600) } else await page.keyboard.press("Escape")
  const order = await page.locator("[data-pin-tiles] [data-pin]").evaluateAll((ts) => ts.slice(0, 2).map((t) => t.dataset.pin))
  check("Pinned: Move right in a tile's menu swaps it with the next", order.join() === "Notes/How this vault works.md,Start here.md", order)

  // A wheel under a still pointer mid-drag: the drop goes where the pointer is now, not where it was. A Dashboards
  // file held over Daily's files (Daily lit), then the tree scrolled down under it.
  await page.goto(`${B}#new`)
  await page.waitForSelector("[data-tree-path='Daily']", { timeout: 15000 }); await wait(600)
  for (const f of ["Daily", "Dashboards"]) if (!(await page.locator(`[data-tree-path^='${f}/']`).count())) { await page.locator(`[data-tree-path='${f}']`).first().click(); await wait(400) }
  const spots = await page.evaluate(() => {
    const sc = document.querySelector("[data-panel='files:files'] [data-panel-scroll]"), box = sc.getBoundingClientRect()
    const dash = document.querySelector("[data-tree-path='Dashboards']")
    sc.scrollTop += dash.getBoundingClientRect().top - (box.top + box.height * 0.6)
    const at = (r) => ({ x: r.left + 60, y: r.top + r.height / 2 })
    const from = [...document.querySelectorAll("[data-tree-path^='Dashboards/']")].map((e) => e.getBoundingClientRect()).find((r) => r.top > dash.getBoundingClientRect().bottom - 1 && r.bottom < box.bottom - 30)
    const to = [...document.querySelectorAll("[data-tree-path^='Daily/']")].map((e) => e.getBoundingClientRect()).find((r) => r.top > box.top + box.height * 0.3)
    return from && to && { from: at(from), to: at(to) }
  })
  await wait(300)
  await page.mouse.move(spots.from.x, spots.from.y); await page.mouse.down()
  await glide(page, [spots.from.x, spots.from.y], [spots.to.x, spots.to.y])
  await wait(200)
  const lit = () => page.evaluate(() => document.querySelector("li.drop-target [data-tree-path]")?.dataset.treePath ?? null)
  const before = await lit()
  await page.mouse.wheel(0, 3000); await wait(400)
  const after = await lit(), under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-tree-path]")?.dataset.treePath ?? null, [spots.to.x, spots.to.y])
  await letGo(page)
  check("a wheel mid-drag: the folder under the still pointer takes the drop", before === "Daily" && !under?.startsWith("Daily/") && after !== "Daily", { before, under, after })

  // A tab moved from the keyboard (the palette here; ⌃⇧PgUp and PgDn in the desktop app), as a drag along the bar would.
  for (const p of ["ME.md", "Start here.md"]) {
    await page.click("[data-tab-bar] button[aria-label='New tab']"); await wait(120)
    await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, p); await wait(400)
  }
  const tabOrder = () => page.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((e) => e.textContent.trim()))
  const t0 = await tabOrder()
  await palette(page, "Move tab left", 500)
  const t1 = await tabOrder()
  check("Move tab left: the tab on screen goes one place left", t0.length >= 2 && t1.at(-2) === t0.at(-1) && t1.at(-1) === t0.at(-2), { t0, t1 })
} finally {
  await api("PATCH", "config/pages", { pinned: pinnedBefore })
  await api("PATCH", "config/plugin/pages", { show: showBefore })
}
await done()
