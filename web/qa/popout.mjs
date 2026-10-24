// Pop-out windows (core/workspace.ts popOut, POPOUT): Move current tab to new window takes the tab out
// of this window into one of its own, with its history; that window has no sidebars and tabs of its own (this one's
// are left as they are); Open current tab in new window leaves it here too; closing a pop-out's last tab closes it.
// Back: a pop-out tab's Move to main window, and a tab dragged out of the pop-out and let go over the main window (into
// the pane or bar under the pointer), each closing the emptied pop-out. A tab bar's empty space: Stack tabs, Hide tab bar.
// A tab dragged out of the main window and let go clear of it goes on in a new window. With the tabs in the sidebar:
// the top of a pane has the tab on screen's menu, and a pop-out (no sidebar) draws its tabs on top.
// WRITES the vault's appearance.json and sidebars.json (the tab bar hidden, the tabs in the sidebar, then back on top).
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
const tabsOf = (p, key) => p.evaluate((k) => {
  const raw = (k === "main" ? localStorage.getItem("vaultite.tabs") : sessionStorage.getItem(Object.keys(sessionStorage).find((x) => x.startsWith("vaultite.popout.")) ?? ""))
  const w = JSON.parse(raw ?? "null"); if (!w) return null
  const g = (function walk(n) { return n.tabs ? n : walk(n.kids[0]) })(w.root)
  return g.tabs.map((t) => t.to.replace(/^file:/, ""))
}, key)
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
await pop.waitForSelector("[data-tab-id]", { timeout: 15000 })
check("the new window shows the tab", await until(async () => decodeURIComponent(await pop.evaluate(() => location.hash)).includes(b)), await pop.evaluate(() => location.hash))
check("it's gone from this window", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a])), await tabsOf(page, "main"))
check("the new window has no sidebars", (await pop.locator("aside[data-side]").count()) === 0)
check("its tab kept its history (Forward goes to where it was)", await until(async () => {
  const w = await pop.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((x) => x.startsWith("vaultite.popout.")))))
  return w?.root?.tabs?.[0]?.fwd?.[0] === `file:${c}`
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
await pop3.waitForSelector("[data-tab-id]", { timeout: 15000 })
await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a]))
await pop3.locator("[data-tab-id]").first().click({ button: "right" })
let gone = pop3.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
check("a pop-out tab's menu has Move to main window", await menuItem(pop3, "Move to main window"))
check("…it's back in the main window", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a, b])), await tabsOf(page, "main"))
check("…and the emptied pop-out closed", await gone)
check("…its history came with it", await page.evaluate((c) => {
  const w = JSON.parse(localStorage.getItem("vaultite.tabs")); const g = (function walk(n) { return n.tabs ? n : walk(n.kids[0]) })(w.root)
  return g.tabs[1]?.fwd?.[0] === `file:${c}`
}, c))

// Back by dragging it out of the pop-out onto the main window's tab bar, past the pop-out's right edge (the end of
// the bar: it goes last).
await page.locator("[data-tab-id]").nth(1).click(); await wait(200)
popped3 = page.waitForEvent("popup")
await command(page, "Move current tab to new window")
pop3 = await popped3
await pop3.waitForSelector("[data-tab-id]", { timeout: 15000 })
await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a]))
const mg = await page.evaluate(() => ({ x: screenX, y: screenY, top: outerHeight - innerHeight }))
const mbar = await page.locator("[data-tab-bar]").first().boundingBox()
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

// A tab bar's empty space: Stack tabs, Hide tab bar (and Show tab bar on the title row left).
const bar = await page.locator("[data-tab-bar]").first().boundingBox()
const empty = async () => page.mouse.click(bar.x + bar.width - 60, bar.y + bar.height / 2, { button: "right" })
await empty(); await wait(200)
check("the bar's empty space has Stack tabs", (await page.locator("[role=menuitem]", { hasText: "Stack tabs" }).count()) === 1)
check("…and Hide tab bar", await menuItem(page, "Hide tab bar"))
check("…which hides it", await until(async () => (await page.locator("[data-tabs-hidden]").count()) === 1))
// Hidden, with pane titles off, the note's bar is the window's title row: its empty part has the bar's menu.
const fill = await page.locator("[data-view-bar-fill]:visible").first().boundingBox()
await page.mouse.click(fill.x + fill.width - 4, fill.y + fill.height / 2, { button: "right" }); await wait(200)
check("…and Show tab bar brings it back", (await menuItem(page, "Show tab bar")) && await until(async () => (await page.locator("[data-tabs-hidden]").count()) === 0))

// Open in new window: it stays here too.
const popped2 = page.waitForEvent("popup")
check("Open current tab in new window", await command(page, "Open current tab in new window"))
const pop2 = await popped2
await pop2.waitForSelector("[data-tab-id]", { timeout: 15000 })
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
  await pop4.waitForSelector("[data-tab-id]", { timeout: 15000 })
  check("…showing it", decodeURIComponent(await pop4.evaluate(() => location.hash)).includes(b), await pop4.evaluate(() => location.hash))
  check("…and it left the main window", await until(async () => JSON.stringify(await tabsOf(page, "main")) === JSON.stringify([a])), await tabsOf(page, "main"))
  await pop4.close()
}

// Tabs in the sidebar: the top of a pane is the tab on screen's (and the pane's), and a pop-out, which has no
// sidebar, draws its tabs on top so they can be switched, right-clicked and dragged back.
await command(page, "Open new tab"); await hash(page, b); await wait(400)
check("Show tabs in the sidebar", await command(page, "Show tabs in the sidebar"))
await until(async () => (await page.locator("[data-tabs-hidden]").count()) > 0)
const top = await page.locator("[data-view-bar-fill]:visible").first().boundingBox()
await page.mouse.click(top.x + top.width - 4, top.y + top.height / 2, { button: "right" }); await wait(200)
const topItems = await page.locator("[role=menuitem]").allInnerTexts()
check("the top of a pane has the tab's menu", ["Close", "Split right", "Move to new window", "Copy path", "New tab", "Show tabs on top"].every((l) => topItems.includes(l)), topItems)
await page.keyboard.press("Escape")
const popped5 = page.waitForEvent("popup")
await command(page, "Move current tab to new window")
const pop5 = watch(await popped5, { label: "popout (tabs in the sidebar)" })
check("a pop-out draws its tabs on top when they're in the sidebar", await until(async () => (await pop5.locator("[data-tab-id]").count()) === 1, 15000))
check("…while the main window keeps them in its sidebar", (await page.locator("[data-tabs-hidden]").count()) > 0)
await pop5.locator("[data-tab-id]").first().click({ button: "right" })
const gone5 = pop5.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
check("…whose menu has Move to main window", await menuItem(pop5, "Move to main window"))
check("…which brings it back", await gone5 && await until(async () => (await tabsOf(page, "main"))?.includes(b)), await tabsOf(page, "main"))
check("Show tabs on top", await command(page, "Show tabs on top"))
await done()
