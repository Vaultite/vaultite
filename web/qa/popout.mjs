// Pop-out windows (core/workspace.ts popOut): tabs moved out and back, dragged between windows (either way), with the
// tabs in the sidebar too. Writes appearance.json and sidebars.json (then back).
//   node web/qa/popout.mjs <base url> <vault path>
import { readdirSync } from "node:fs"
import path from "node:path"
import { BACK_KEY, command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const [a, b, c] = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 3).map((f) => `Notes/${f}`)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage())
await page.goto(B)
await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
/** A window's tabs, each its focused pane's file: the main window's, or this pop-out's (its own list in the workspace). */
const listOf = (p, key) => p.evaluate((k) => {
  const w = JSON.parse(localStorage.getItem("vaultite.tabs") ?? "null"), id = new URLSearchParams(location.search).get("popout")
  return (k === "main" ? w : w?.windows?.find((x) => x.id === id)) ?? null
}, key)
const leaves = (n) => (n.kids ? n.kids.flatMap(leaves) : [n])
const focusedOf = (t) => leaves(t.root).find((x) => x.id === t.focus) ?? leaves(t.root)[0]
const tabsOf = async (p, key) => (await listOf(p, key))?.tabs.map((t) => focusedOf(t).to.replace(/^file:/, "")) ?? null
const hash = (p, f) => p.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)

await command(page, "Close all other tabs")
await hash(page, a); await wait(400)
await command(page, "Open new tab"); await hash(page, b); await wait(400)
// b's history: c, then back to b.
await hash(page, c); await wait(400); await page.keyboard.press(BACK_KEY); await wait(400)
check("two tabs here", JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a, b]), await tabsOf(page, "main"))

const popped = page.waitForEvent("popup")
check("Move current tab to new window", await command(page, "Move current tab to new window"))
const pop = await popped
watch(pop, { label: "popout" })
await pop.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
check("the new window shows the tab", await until(async () => decodeURIComponent(await pop.evaluate(() => location.hash)).includes(b)), await pop.evaluate(() => location.hash))
check("it's gone from this window", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a])), await tabsOf(page, "main"))
check("the new window has no sidebars", (await pop.locator("aside[data-side]").count()) === 0)
check("its tab kept its history (Forward goes to where it was)", await until(async () => {
  const l = await listOf(pop, "pop")
  return !!l && focusedOf(l.tabs[0]).fwd?.[0] === `file:${c}`
}))

// Its own tabs: a new one there leaves this window's as they are.
await command(pop, "Open new tab"); await hash(pop, c); await wait(500)
check("a pop-out's tabs are its own", JSON.stringify(await tabsOf(pop, "pop")) === JSON.stringify([b, c]) && JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a]),
  [await tabsOf(pop, "pop"), await tabsOf(page, "main")])

// Closing its last tab closes it.
await command(pop, "Close current tab"); await wait(300)
const closed = pop.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
await command(pop, "Close current tab")
check("closing a pop-out's last tab closes the window", await closed)

// Back to the main window from the tab's menu.
const menuItem = async (p, label) => {
  const it = p.locator("[role=menuitem]", { hasText: label }).first()
  if (!(await it.count())) { await p.keyboard.press("Escape"); return false }
  await it.click(); await wait(300); return true
}
await command(page, "Open new tab"); await hash(page, b); await wait(400)
await hash(page, c); await wait(400); await page.keyboard.press(BACK_KEY); await wait(400)
let popped3 = page.waitForEvent("popup")
await command(page, "Move current tab to new window")
let pop3 = await popped3
await pop3.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a]))
await pop3.locator("[data-tab-id]").first().click({ button: "right" })
let gone = pop3.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
check("a pop-out tab's menu has Move to main window", await menuItem(pop3, "Move to main window"))
check("…it's back in the main window", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a, b])), await tabsOf(page, "main"))
check("…and the emptied pop-out closed", await gone)
check("…its history came with it", await listOf(page, "main").then((l) => !!l?.tabs[1] && focusedOf(l.tabs[1]).fwd?.[0] === `file:${c}`))

// Back by dragging it out of the pop-out onto the main window's tab bar, past the pop-out's right edge (the end of
// the bar: it goes last).
await page.locator("[data-tab-id]").nth(1).click(); await wait(200)
popped3 = page.waitForEvent("popup")
await command(page, "Move current tab to new window")
pop3 = await popped3
await pop3.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a]))
const mg = await page.evaluate(() => ({ x: screenX, y: screenY, top: outerHeight - innerHeight }))
const mbar = await page.locator("[data-tab-strip]").first().boundingBox()
const t = await pop3.locator("[data-tab-id]").first().boundingBox()
gone = pop3.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
// Where the pop-out's page is on the screen, as its pointer events say (headless Chrome's window.screenX/Y don't).
await pop3.evaluate(() => addEventListener("pointermove", (e) => { window.__off = { x: e.screenX - e.clientX, y: e.screenY - e.clientY } }, true))
await pop3.mouse.move(t.x + 20, t.y + t.height / 2); await pop3.mouse.down()
await pop3.mouse.move(t.x + 40, t.y + t.height / 2, { steps: 3 })
const off = await pop3.evaluate(() => window.__off)
// A point on the main window's bar past the pop-out's right edge, as one in the pop-out's page.
const vw = await pop3.evaluate(() => innerWidth), vh = await pop3.evaluate(() => innerHeight)
// (mx, my): the point in the main window's page; (px, py): the same screen point in the pop-out's.
const mx = Math.max(vw + 60 + off.x - mg.x, mbar.x + mbar.width / 2), my = mbar.y + mbar.height / 2
const px = mg.x + mx - off.x, py = mg.y + mg.top + my - off.y
const outsideIt = (px < 0 || py < 0 || px >= vw || py >= vh) && mx < mbar.x + mbar.width
await pop3.mouse.move(px, py, { steps: 5 }); await pop3.mouse.up()
check("(the drop point is outside the pop-out, on the main window's bar)", outsideIt, { mx, px, py, mg, off, vw })
check("a tab dragged out of the pop-out onto the main window's bar lands there", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a, b])), await tabsOf(page, "main"))
check("…and the emptied pop-out closed", await gone)

// The tab bar's empty space: Hide tab bar (and Show tab bar on the title row left).
const bar = await page.locator("[data-tab-strip]").first().boundingBox()
const empty = async () => page.mouse.click(bar.x + bar.width - 60, bar.y + bar.height / 2, { button: "right" })
await empty(); await wait(200)
check("the bar's empty space has Hide tab bar", await menuItem(page, "Hide tab bar"))
check("…which hides it", await until(async () => (await page.locator("[data-tab-strip]").count()) === 0))
// Hidden, with pane tab bars off, the note's bar is the window's title row: its empty part has the bar's menu.
const fill = await page.locator("[data-view-bar-fill]:visible").first().boundingBox()
await page.mouse.click(fill.x + fill.width - 4, fill.y + fill.height / 2, { button: "right" }); await wait(200)
check("…and Show tab bar brings it back", (await menuItem(page, "Show tab bar")) && await until(async () => (await page.locator("[data-tab-strip]").count()) === 1))

// Open in new window: it stays here too.
const popped2 = page.waitForEvent("popup")
check("Open current tab in new window", await command(page, "Open current tab in new window"))
const pop2 = await popped2
await pop2.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
check("…and it's still here", JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a, b]), await tabsOf(page, "main"))
await pop2.close()

// Torn off: a tab dragged out of the main window and let go clear of it goes on in a window of its own.
const tb = await page.locator("[data-tab-id]").nth(1).boundingBox()
const torn = page.waitForEvent("popup")
await page.mouse.move(tb.x + 20, tb.y + tb.height / 2); await page.mouse.down()
await page.mouse.move(tb.x + 40, tb.y + tb.height / 2, { steps: 3 })
await page.mouse.move(1280 + 120, 400, { steps: 6 }); await page.mouse.up()
const pop4 = await Promise.race([torn, wait(5000).then(() => null)])
check("a tab dragged out of the window and let go opens a window of its own", !!pop4)
if (pop4) {
  await pop4.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
  check("…showing it", decodeURIComponent(await pop4.evaluate(() => location.hash)).includes(b), await pop4.evaluate(() => location.hash))
  check("…and it left the main window", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a])), await tabsOf(page, "main"))
  await pop4.close()
}

// Tabs in the sidebar: the top of a pane is the tab on screen's (and the pane's), and a pop-out, which has no
// sidebar, draws its tabs on top so they can be switched, right-clicked and dragged back.
await command(page, "Open new tab"); await hash(page, b); await wait(400)
check("Show tabs in the sidebar", await command(page, "Show tabs in the sidebar"))
await until(async () => (await page.locator("[data-tab-strip]").count()) === 0)
const top = await page.locator("[data-view-bar-fill]:visible").first().boundingBox()
await page.mouse.click(top.x + top.width - 4, top.y + top.height / 2, { button: "right" }); await wait(200)
const topItems = await page.locator("[role=menuitem]").allInnerTexts()
check("the top of a pane has the tab's menu", ["Close", "Split right", "Move to new window", "Copy path", "New tab", "Show tabs on top"].every((l) => topItems.includes(l)), topItems)
await page.keyboard.press("Escape")
const popped5 = page.waitForEvent("popup")
await command(page, "Move current tab to new window")
const pop5 = watch(await popped5, { label: "popout (tabs in the sidebar)" })
check("a pop-out draws its tabs on top when they're in the sidebar", await until(async () => (await pop5.locator("[data-tab-strip] [data-tab-id]").count()) === 1, 15000))
check("…while the main window keeps them in its sidebar", (await page.locator("[data-tab-strip]").count()) === 0)
await pop5.locator("[data-tab-id]").first().click({ button: "right" })
const gone5 = pop5.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
check("…whose menu has Move to main window", await menuItem(pop5, "Move to main window"))
check("…which brings it back", await gone5 && await until(async () => (await tabsOf(page, "main"))?.includes(b)), await tabsOf(page, "main"))
check("Show tabs on top", await command(page, "Show tabs on top"))

// The other way: a main window's tab held over a pop-out shows there where it would land, as within a window, and
// lands there (the pop-out torn off past the main window's right edge, so a point can be on it and off the main one).
await page.bringToFront(); await wait(300)
await command(page, "Close all other tabs"); await hash(page, a); await wait(400)
await command(page, "Open new tab"); await hash(page, b); await wait(400)
await command(page, "Open new tab"); await hash(page, c); await wait(400)
const tb7 = await page.locator("[data-tab-id]").nth(1).boundingBox()
const torn7 = page.waitForEvent("popup")
await page.mouse.move(tb7.x + 20, tb7.y + tb7.height / 2); await page.mouse.down()
await page.mouse.move(tb7.x + 40, tb7.y + tb7.height / 2, { steps: 3 })
await page.mouse.move(1280 + 200, 300, { steps: 6 }); await page.mouse.up()
const pop7 = watch(await torn7, { label: "popout (a main window's tab held over it)" })
await pop7.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a, c]))
// (headless Chrome opens it where it likes: it's put right of the main window)
{
  const cdp = await ctx.newCDPSession(pop7), { windowId } = await cdp.send("Browser.getWindowForTarget")
  const m = await page.evaluate(() => ({ x: screenX, w: outerWidth, y: screenY }))
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: m.x + m.w + 40, top: m.y + 60 } }); await wait(300)
}
// Where the pop-out's page is on the screen, from its own pointer events, and the main page's.
await pop7.evaluate(() => addEventListener("pointermove", (e) => { window.__off = { x: e.screenX - e.clientX, y: e.screenY - e.clientY } }, true))
await pop7.mouse.move(50, 50); await pop7.mouse.move(60, 60)
const off7 = await pop7.evaluate(() => window.__off)
await page.evaluate(() => addEventListener("pointermove", (e) => { window.__off = { x: e.screenX - e.clientX, y: e.screenY - e.clientY } }, true))
const body7 = await pop7.locator("[data-pane-body]:visible").first().boundingBox()
const tc = await page.locator("[data-tab-id]").nth(1).boundingBox()
await page.mouse.move(tc.x + 20, tc.y + tc.height / 2); await page.mouse.down()
await page.mouse.move(tc.x + 40, tc.y + tc.height / 2, { steps: 3 })
const offM = await page.evaluate(() => window.__off)
// (the right edge of the pop-out's pane, as a point in the main window's page)
const rx = off7.x + body7.x + body7.width - 20 - offM.x, ry = off7.y + body7.y + body7.height / 2 - offM.y
check("(the point held is outside the main window, on the pop-out's pane's right edge)", rx >= 1280 || ry >= 800, { rx, ry, off7, offM, body7 })
await page.mouse.move(rx, ry, { steps: 6 })
check("held there, the pop-out shows where it would land: a split on the right", await until(async () => (await pop7.locator("[data-drop-zone='right']").count()) === 1))
check("…and draws no picture of its own of it (the main window's)", (await pop7.locator("[data-drag-ghost]").count()) === 0)
await page.mouse.up()
check("let go, it lands there: the pop-out's tab split, it on the right", await until(async () => {
  const l = await listOf(pop7, "pop")
  return l?.tabs.length === 1 && leaves(l.tabs[0].root).map((p) => p.to).join() === [`file:${b}`, `file:${c}`].join()
}), await listOf(pop7, "pop"))
check("…and it left the main window", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a])), await tabsOf(page, "main"))
check("…the pop-out's drop zone gone", (await pop7.locator("[data-drop-zone]").count()) === 0)
await pop7.close()

// Held over the main window, a pop-out's tab shows there where it would land, as a drag of its own would (a pane's
// edge: a split), and lands there.
await command(page, "Close all other tabs"); await hash(page, a); await wait(400)
await command(page, "Open new tab"); await hash(page, b); await wait(400)
const popped6 = page.waitForEvent("popup")
await command(page, "Move current tab to new window")
const pop6 = watch(await popped6, { label: "popout (held over the main window)" })
await pop6.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a]))
const body = await page.locator("[data-pane-body]:visible").first().boundingBox()
const t6 = await pop6.locator("[data-tab-id]").first().boundingBox()
await pop6.evaluate(() => addEventListener("pointermove", (e) => { window.__off = { x: e.screenX - e.clientX, y: e.screenY - e.clientY } }, true))
await pop6.mouse.move(t6.x + 20, t6.y + t6.height / 2); await pop6.mouse.down()
await pop6.mouse.move(t6.x + 40, t6.y + t6.height / 2, { steps: 3 })
const off6 = await pop6.evaluate(() => window.__off), vw6 = await pop6.evaluate(() => innerWidth), vh6 = await pop6.evaluate(() => innerHeight)
// (the right edge of the main window's pane, past the pop-out's)
const ex = body.x + body.width - 20, ey = body.y + body.height / 2
const qx = mg.x + ex - off6.x, qy = mg.y + mg.top + ey - off6.y
check("(the point held is outside the pop-out, on the main window's pane's right edge)", qx >= vw6 || qy >= vh6, { ex, qx, vw6, body })
await pop6.mouse.move(qx, qy, { steps: 6 })
check("held there, the main window shows where it would land: a split on the right", await until(async () => (await page.locator("[data-drop-zone='right']").count()) === 1))
check("…and draws no picture of its own of it (the pop-out's)", (await page.locator("[data-drag-ghost]").count()) === 0)
const gone6 = pop6.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
await pop6.mouse.up()
check("let go, it lands there: the main window's tab split, it on the right", await until(async () => {
  const l = await listOf(page, "main")
  return l?.tabs.length === 1 && leaves(l.tabs[0].root).map((p) => p.to).join() === [`file:${a}`, `file:${b}`].join()
}), await listOf(page, "main"))
check("…the main window's drop zone gone", (await page.locator("[data-drop-zone]").count()) === 0)
check("…and the emptied pop-out closed", await gone6)
await done()
