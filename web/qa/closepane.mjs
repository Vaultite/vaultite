// Close pane (core/workspace.ts closePane) of a split tab with the tab bar and pane titles off, and Reopen closed tab
// bringing it back where it sat; each pane's X and handle at its view's bar's end (components/Tabs.tsx PaneControls),
// fading bars and cards too, and the sidebar's split row (plugins/core/tabs): a cell's X, menu and swap. WRITES the
// vault's appearance.json (put back): throwaway server only.
//   node web/qa/closepane.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/closepane-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const [a, b, c] = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 3).map((f) => `Notes/${f}`)
const look = path.join(VAULT, ".vaultite", "appearance.json")
const was = existsSync(look) ? readFileSync(look, "utf8") : null
const lookAs = (o) => writeFileSync(look, JSON.stringify({ ...JSON.parse(was ?? "{}"), ...o }) + "\n")
lookAs({ tabBar: false, paneTitles: false })

try {
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
  await page.goto(`${B}/#new`)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs"))
  await page.reload()
  await page.waitForSelector("[data-pane-bar]", { state: "attached", timeout: 30000 })
  const hash = (f) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)
  /** The tab on screen's panes: each one's file, its box, and whether it's focused; and the window's tabs. */
  const panes = () => page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem("vaultite.tabs")), t = w.tabs.find((x) => x.id === w.active)
    const leaves = (n) => (n.kids ? n.kids.flatMap(leaves) : [n])
    return leaves(t.root).map((p) => {
      const r = document.querySelector(`section[data-pane-frame="${p.id}"]:not([data-away])`)?.getBoundingClientRect()
      return { to: p.to.replace(/^file:/, ""), box: r && [r.x, r.y, r.width, r.height].map(Math.round).join(","), focus: t.focus === p.id }
    })
  })
  const tabs = () => page.evaluate(() => { const w = JSON.parse(localStorage.getItem("vaultite.tabs")); return w.tabs.map((t) => (t.pinned ? "*" : "") + (t.id === w.active ? ">" : "")) })
  const files = async () => (await panes()).map((p) => p.to)
  const menuItem = async (label) => {
    const it = page.locator("[role=menuitem]", { hasText: label }).first()
    if (!(await it.count())) { await page.keyboard.press("Escape"); return false }
    await it.click(); await wait(300); return true
  }

  // A split tab: a on top, b below it.
  await hash(a); await until(async () => (await panes())[0]?.to === a)
  await command(page, "Close all other tabs")
  await command(page, "Split down"); await hash(b); await until(async () => (await panes())[1]?.to === b)
  const before = await panes()
  check("one tab, split: a above b, b focused", same(before.map((p) => p.to), [a, b]) && before[1].focus, before)

  // A pinned tab beside it: Close current tab moves on and leaves it open, as Arc's.
  await command(page, "Open new tab"); await hash(c); await until(async () => same(await files(), [c]))
  await command(page, "Pin tab")
  await command(page, "Close current tab")
  check("Close current tab on a pinned tab moves on, as Arc's", await until(async () => same(await files(), [a, b])), await panes())
  check("…and leaves it open, pinned", same(await tabs(), [">", "*"]), await tabs())

  // The lower pane's file bar (its title row: its strip has none), its X on hover.
  const strip = page.locator("[data-pane-area] > section[data-pane-frame]:not([data-away]):not([data-top]) [data-pane-bar][data-bare]")
  const lowBar = page.locator("[data-pane-area] > section[data-pane-frame]:not([data-away]):not([data-top]) [data-view-bar]").first()
  const x = page.locator("[data-pane-area] > section[data-pane-frame]:not([data-away]):not([data-top]) [data-view-bar] [data-pane-close]")
  check("a merged strip draws no buttons of its own", (await strip.locator("[data-pane-close], [data-pane-handle]").count()) === 0)
  await lowBar.hover()
  await until(async () => (await x.evaluate((e) => getComputedStyle(e).opacity)) === "1", 2000)
  check("the file bar shows an X on hover, beside the handle", (await x.evaluate((e) => getComputedStyle(e).opacity)) === "1"
    && await x.evaluate((e) => !!e.nextElementSibling?.matches("[data-pane-handle]")))
  await x.click()
  check("its X closes the pane", await until(async () => same(await files(), [a])), await panes())
  check("Reopen closed tab is offered", await command(page, "Reopen closed tab"))
  check("…and brings the pane back where it sat", await until(async () => same(await panes(), before)), [await panes(), before])

  // The strip's menu.
  await strip.click({ button: "right", position: { x: 40, y: 4 } }); await wait(200)
  check("the strip's menu has Close pane", await menuItem("Close pane"))
  check("…which closes it", await until(async () => (await panes()).length === 1), await panes())
  await command(page, "Reopen closed tab")
  check("…and it comes back again", await until(async () => same(await panes(), before)), await panes())

  // The palette's, on the focused pane.
  check("the palette has Close pane", await command(page, "Close pane"))
  check("…closing the focused pane", await until(async () => same(await files(), [a])), await panes())
  // Its keys, ⌥⇧⌘W.
  await command(page, "Reopen closed tab"); await until(async () => (await panes()).length === 2)
  await page.keyboard.press("ControlOrMeta+Alt+Shift+KeyW")
  check("⌥⇧⌘W closes the focused pane too", await until(async () => same(await files(), [a])), await panes())

  // The window's only pane: nothing to close it with.
  // (the pinned tab goes too: shown, unpinned, closed)
  await command(page, "Go to next tab"); await until(async () => same(await files(), [c]))
  await command(page, "Unpin tab"); await command(page, "Close current tab"); await until(async () => (await tabs()).length === 1)
  check("the only pane: no Close pane in the palette", !(await command(page, "Close pane")))
  check("…nor an X", (await page.locator("[data-pane-close]").count()) === 0)
  await command(page, "Pin tab"); await command(page, "Close current tab"); await wait(300)
  check("…and a pinned tab alone stays", same(await files(), [a]) && same(await tabs(), ["*>"]), await tabs())
  await command(page, "Unpin tab")

  // Pane titles on: the X beside each title row's handle. (c closed last, then b's pane: both back)
  await command(page, "Reopen closed tab"); await command(page, "Reopen closed tab"); await until(async () => (await panes()).length === 2)
  lookAs({ tabBar: false, paneTitles: true })
  check("with titles, each title row has the X", await until(async () => (await page.locator("[data-pane-title] ~ [data-pane-close]").count()) === 2, 8000))
  await page.locator("[data-pane-close]").last().click()
  check("…which closes its pane", await until(async () => (await panes()).length === 1), await panes())

  // As the user has it: no tab bar, titles nor rails, panes as cards, file bars fading always, tabs in the sidebar.
  mkdirSync(OUT, { recursive: true })
  lookAs({ tabBar: false, paneTitles: false, rails: false, paneCards: true, fileBarFade: "always" })
  await command(page, "Reopen closed tab"); await until(async () => (await panes()).length === 2)
  await until(async () => (await page.locator("[data-pane-title]").count()) === 0, 8000)
  const top = "[data-pane-area] > section[data-pane-frame][data-top]:not([data-away])"
  const topBar = page.locator(`${top} [data-view-bar]`).first(), topX = page.locator(`${top} [data-view-bar] [data-pane-close]`)
  const opacity = (l) => l.evaluate((e) => +getComputedStyle(e).opacity)
  check("the top pane's strip is folded away", await page.locator(`${top} > [data-pane-bar][data-merged]`).evaluate((e) => e.getBoundingClientRect().height === 0))
  check("…its file bar has its X and handle", (await topX.count()) === 1 && (await page.locator(`${top} [data-view-bar] [data-pane-handle]`).count()) === 1)
  await page.mouse.move(640, 500); await wait(900)
  check("…faded with the bar while the pointer is away", (await opacity(topBar)) === 0)
  await topBar.hover({ position: { x: 60, y: 20 } })
  check("…both shown as the pointer comes to the bar", await until(async () => (await opacity(topBar)) === 1 && (await opacity(topX)) === 1, 3000))
  await page.screenshot({ path: `${OUT}closepane-hover.png` })
  // Its handle drags it: onto the other pane's middle, the two swap.
  const order = async () => (await panes()).map((p) => p.to).join()
  const was2 = await order(), grip = await page.locator(`${top} [data-view-bar] [data-pane-handle]`).boundingBox()
  const low = await page.locator("[data-pane-area] > section[data-pane-frame]:not([data-away]):not([data-top]) [data-pane-body]").boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down()
  for (let k = 1; k <= 8; k++) { await page.mouse.move(grip.x + (low.x + low.width / 2 - grip.x) * k / 8, grip.y + (low.y + low.height / 2 - grip.y) * k / 8); await wait(30) }
  await page.mouse.up()
  check("its handle drags it onto the other pane: they swap", await until(async () => (await order()) === [...was2.split(",")].reverse().join()), [was2, await order()])
  // Zoomed: its unzoom at the bar's end too.
  await command(page, "Zoom pane")
  check("zoomed, its file bar has Unzoom", await until(async () => (await page.locator("[data-view-bar] [data-pane-unzoom]").count()) === 1, 3000))
  await page.locator("[data-view-bar] [data-pane-unzoom]").click({ force: true })
  check("…which unzooms it", await until(async () => (await page.locator("[data-pane-frame][data-zoomed]").count()) === 0, 3000))
  await topBar.hover({ position: { x: 60, y: 20 } }); await until(async () => (await opacity(topX)) === 1, 3000)
  await topX.click()
  check("the top pane's X closes it", await until(async () => (await panes()).length === 1), await panes())
  check("…and the one left has no X", await until(async () => (await page.locator("[data-pane-close]").count()) === 0, 3000))
  await command(page, "Reopen closed tab"); await until(async () => (await panes()).length === 2)

  // The sidebar's split row: a cell's X, its right-click and a drag onto the other cell.
  const cells = page.locator("[data-tabs-panel] [data-split-map] [data-pane-half]")
  if (!(await cells.count())) await command(page, "Show tabs in the sidebar").catch(() => {})
  check("the split's row shows a cell per pane", await until(async () => (await cells.count()) === 2, 5000), await cells.count())
  const cellOrder = () => cells.evaluateAll((es) => es.map((e) => e.dataset.paneHalf).join())
  check("…without the tab's X or …", (await page.locator("[data-tabs-panel] [data-split] [data-row-actions] button").count()) === 0)
  await cells.nth(1).click({ button: "right" }); await wait(200)
  const items = await page.locator("[role=menuitem]").allInnerTexts()
  check("a cell's right-click is its pane's menu, the tab's under Tab", items.some((t) => /Close pane/.test(t)) && items.some((t) => /^Tab/.test(t.trim())) && !items.some((t) => /Close others/.test(t)), items)
  await page.keyboard.press("Escape"); await wait(200)
  const before3 = await cellOrder(), [c0, c1] = [await cells.nth(0).boundingBox(), await cells.nth(1).boundingBox()]
  await page.mouse.move(c1.x + c1.width / 2, c1.y + c1.height / 2); await page.mouse.down()
  for (let k = 1; k <= 8; k++) { await page.mouse.move(c1.x + c1.width / 2 + (c0.x - c1.x) * k / 8, c1.y + c1.height / 2 + (c0.y - c1.y) * k / 8); await wait(30) }
  check("…a cell held on the other lights it", await until(async () => (await cells.nth(0).evaluate((e) => e.className)).includes("bg-primary"), 2000))
  await page.mouse.up()
  check("…and let go there, they swap", await until(async () => (await cellOrder()) === before3.split(",").reverse().join(), 3000), [before3, await cellOrder()])
  check("…in the panes too", await until(async () => (await panes()).length === 2, 2000))
  await cells.nth(0).hover()
  const cx = cells.nth(0).locator("[data-cell-close]")
  check("a cell's X shows on hover", await until(async () => (await opacity(cx)) === 1, 2000))
  await page.screenshot({ path: `${OUT}closepane-sidebar.png` })
  const gone = await cells.nth(0).getAttribute("data-pane-half")
  await cx.click()
  check("…and closes that pane", await until(async () => (await panes()).length === 1 && !(await page.locator(`[data-pane-frame="${gone}"]:not([data-away])`).count()), 3000), await panes())
} finally {
  await browser.close()
  if (was === null) rmSync(look, { force: true }); else writeFileSync(look, was)
}
await done()
