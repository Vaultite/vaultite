// Pages are files: a page's file address opens its dashboard, the sidebar lists the pinned files, right-click hides and
// shows them (the menu stays open), dashboards open in reading as a grid and ⌘E edits them, on a phone the drawer
// lists them (the sidebar's panel) and a new tab shows them as tiles, Pinned's settings list them, Show pinned pages as
// Tiles draws the open sidebar's as a grid (the drawer keeps its list), and /api/render reads a dashboard as text.
// Screenshots in /tmp/vaultite-pages/.
// WRITES .vaultite/pages.json and Pinned's data.json (and puts them back): throwaway server only.
//   node web/qa/pages.mjs <base url>
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { qa } from "./lib/qa.mjs"
import { pagePath } from "./subjects.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const OUT = "/tmp/vaultite-pages/"
mkdirSync(OUT, { recursive: true })
const pinnedBefore = (await (await fetch(`${B}api/config/pages`)).json()).pinned
const pluginsBefore = await (await fetch(`${B}api/config/plugins`)).json()
const showBefore = (await (await fetch(`${B}api/config/plugin/pages`)).json()).show ?? null
const setShow = (show) => fetch(`${B}api/config/plugin/pages`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show }) })
await setShow(null)
// What it tests, whatever the vault turned off or pinned (the sandbox starts calm: two pins): the plugins whose pages
// it opens on (a page arrives with its plugin), and those five pages pinned. Both put back at the end.
const PAGES = ["People", "Claude", "Agents", "Queue", "People map"]
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
for (const id of ["people", "claude-code", "terminal", "player", "people-map"]) vau("plugin", "on", id)
for (const name of PAGES) {
  const p = await pagePath(B, name)
  await fetch(`${B}api/pins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p, pinned: true }) })
}
// (where the vault keeps its pages: Dashboards/, or a folder of the user's)
const DIR = (await pagePath(B, "People")).split("/").slice(0, -1).join("/")
const hashOf = (name) => `#file/${encodeURIComponent(`${DIR}/${name}.md`)}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = watch(await ctx.newPage())
for (const [id, name] of [["people", "People"], ["claude-code", "Claude"], ["terminal", "Agents"], ["player", "Queue"], ["people-map", "People map"]]) {
  await page.goto(`${B}${hashOf(name)}`); await page.waitForTimeout(1500)
  const hash = await page.evaluate(() => location.hash)
  check(`${name}'s address shows it`, hash === hashOf(name), hash)
  const cards = await page.locator("article.file-view .grid > div").count()
  check(`${name} is a grid of cards in reading`, cards > 0 && !(await page.locator("article.file-view .cm-editor").count()), cards)
  await page.screenshot({ path: `${OUT}desktop-${id}.png` })
}
const side = async () => (side.last = await page.locator("nav[aria-label=Pages] a").allInnerTexts())
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
check("the sidebar lists the pinned pages", (await side()).length >= 5, await side())
await page.locator("[data-panel='pages:pages'] [data-panel-handle]").first().click({ button: "right" }); await page.waitForTimeout(200)
// The panel heading's menu: the pages are a submenu, Pinned pages ▸.
await page.locator("[role=menu] button", { hasText: /^Pinned pages$/ }).first().hover(); await page.waitForTimeout(300)
const items = await page.locator("[role=menu] [role=menuitemcheckbox]").allInnerTexts()
// The Queue page's own row (by its whole name)
const row = page.locator("[role=menu]").getByRole("menuitemcheckbox", { name: "Queue", exact: true })
check("right-click lists the pages with checks", items.includes("Queue") && items.includes("People"), items)
const order = () => page.locator("[role=menu] [role=menuitemcheckbox]").allInnerTexts()
const sideBefore = await side()
await row.click(); await page.waitForTimeout(300)
check("unticking hides the page, the menu stays", !(await side()).includes("Queue") && await page.locator("[role=menu]").first().isVisible(), await side())
check("its row stays where it was, unticked", await row.getAttribute("aria-checked") === "false" && same(await order(), items), await order())
await page.screenshot({ path: `${OUT}desktop-menu.png` })
await row.click(); await page.waitForTimeout(300)
check("ticking brings it back, ticked, in its place", same(await side(), sideBefore) && await row.getAttribute("aria-checked") === "true", [await side(), sideBefore])
await page.keyboard.press("Escape"); await page.keyboard.press("Escape") // the submenu, then the menu
// Right-clicked on a page's row: only its own items, Unpin last (the panel's menu is its heading's).
await page.locator("nav[aria-label=Pages] a", { hasText: /^People$/ }).click({ button: "right" }); await page.waitForTimeout(200)
const rowItems = await page.locator("[role=menu] [role^=menuitem]").allInnerTexts()
check("a page's row: its own items, a file's (Copy path), Unpin last, no panel items", rowItems.at(-1) === "Unpin" && rowItems.filter((t) => t === "Unpin").length === 1 && rowItems.includes("Copy path") && !rowItems.some((t) => /^(Pinned pages|Panels|Hide |Move to )/.test(t)), rowItems)
await page.keyboard.press("Escape")
// Its … (on hover): the same menu.
await page.locator("nav[aria-label=Pages] a", { hasText: /^People$/ }).hover()
await page.locator("nav[aria-label=Pages] a", { hasText: /^People$/ }).locator("[data-row-more]").click(); await page.waitForTimeout(200)
const dotItems = await page.locator("[role=menu] [role^=menuitem]").allInnerTexts()
check("a page's …: the same menu as right-click", JSON.stringify(dotItems) === JSON.stringify(rowItems), [dotItems, rowItems])
await page.keyboard.press("Escape")
await page.locator("[data-panel='pages:pages'] [data-panel-handle]").first().click({ button: "right" }); await page.waitForTimeout(200)
await page.locator("[role=menu] button", { hasText: /^Pinned pages$/ }).first().hover(); await page.waitForTimeout(300)
// Pages not pinned are under More ▸: ticking one pins it at the end; the menu stays, its row ticked where it was.
await page.locator("[role=menu] button", { hasText: /^More$/ }).last().hover(); await page.waitForTimeout(300)
const moreRows = () => page.locator("[role=menu]").last().locator("[role=menuitemcheckbox]")
const more = await moreRows().allInnerTexts()
check("More ▸ lists the pages not pinned, unticked", more.length > 1 && !more.some((t) => (side.last ?? []).includes(t)) && (await moreRows().evaluateAll((els) => els.every((e) => e.getAttribute("aria-checked") === "false"))), more)
if (more.length > 1) {
  const [a, b] = [more[0].split("\n")[0], more[1].split("\n")[0]]
  await moreRows().nth(0).click(); await page.waitForTimeout(300)
  await moreRows().nth(1).click(); await page.waitForTimeout(400)
  check("ticking two in More ▸ pins both at the end, the menu open", same((await side()).slice(-2), [a, b]) && await page.locator("[role=menu]").count() === 3, await side())
  check("...both ticked where they were in More ▸", same(await moreRows().allInnerTexts(), more) && await moreRows().nth(0).getAttribute("aria-checked") === "true" && await moreRows().nth(1).getAttribute("aria-checked") === "true", await moreRows().allInnerTexts())
  await moreRows().nth(0).click(); await page.waitForTimeout(300)
  await moreRows().nth(1).click(); await page.waitForTimeout(400)
  check("...and unticking them there unpins them", !(await side()).includes(a) && !(await side()).includes(b), await side())
}
for (let i = 0; i < 3 && await page.$("[role=menu]"); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(100) }
await page.goto(`${B}${hashOf("People")}`); await page.waitForTimeout(1200)
await page.keyboard.press("ControlOrMeta+e"); await page.waitForTimeout(1200)
check("⌘E edits the dashboard's text", (await page.locator("article.file-view .cm-editor").count()) > 0)

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const m = watch(await phone.newPage(), { label: "phone" })
await m.goto(B); await m.waitForTimeout(1500)
// (the vault's first pin, wherever it is: the sandbox's is Start here.md, at the top)
const firstPin = (await (await fetch(`${B}api/config/pages`)).json()).pinned.find((p) => p.endsWith(".md"))
check("a phone opens on the first pinned page", decodeURIComponent(await m.evaluate(() => location.hash)) === `#file/${firstPin}`, [firstPin, await m.evaluate(() => location.hash)])
// The pinned pages are in the drawer (the sidebar's Pages panel), not the bar (phonetabs.mjs, phonenav.mjs).
// (The sidebar's list: workspace 1's own, made when a page was unticked above, else pages.json's.)
const ws1 = (await (await fetch(`${B}api/workspaces`)).json()).workspaces?.[0]?.pinned
const pinnedNow = (ws1 ?? (await (await fetch(`${B}api/config/pages`)).json()).pinned).filter((p) => !p.includes("/") || p.endsWith(".md"))
check("the bar has no pages in it", !(await m.locator("[data-phone-bar] a").count()), await m.locator("[data-phone-bar] a").count())
await m.screenshot({ path: `${OUT}phone-home.png`, fullPage: true })
await m.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await m.waitForTimeout(500)
const drawer = await m.locator("[data-phone-drawer=left] nav[aria-label=Pages] a").evaluateAll((as) => as.map((a) => decodeURIComponent(a.getAttribute("href"))))
check("the drawer lists the pinned pages, in order, as page files", drawer.length >= 5 && drawer.join() === pinnedNow.map((p) => `#file/${p}`).slice(0, drawer.length).join(), { drawer, pinnedNow })
await m.screenshot({ path: `${OUT}phone-drawer.png` })
await m.locator("[data-phone-drawer=left] nav[aria-label=Pages] a").nth(1).tap(); await m.waitForTimeout(800)
check("a page from the drawer opens it", (await m.evaluate(() => decodeURIComponent(location.hash))) === drawer[1], [drawer[1], await m.evaluate(() => location.hash)])
await m.locator("[data-bar=new]").tap(); await m.waitForTimeout(500)
const tiles = await m.locator("[data-new-tab-pages] a").evaluateAll((as) => as.map((a) => decodeURIComponent(a.getAttribute("href"))))
check("a new tab shows the pinned pages as tiles", tiles.length === drawer.length && tiles.join() === drawer.join(), { tiles, drawer })
await m.screenshot({ path: `${OUT}phone-new-tab.png`, fullPage: true })
await m.goto(`${B}#settings`); await m.waitForTimeout(1500)
check("Settings doesn't list the pages (Pinned's settings do)", !(await m.locator("[data-page-row]").count()))
await m.locator('[data-settings-nav="plugin:pages"]').tap(); await m.waitForTimeout(800)
check("Pinned's settings: the pages, saying how many are pinned", (await m.locator("dialog[open] [data-page-row]").count()) >= drawer.length &&
  (await m.locator("dialog[open] [data-pages-count]").innerText()).includes(`${drawer.length} pinned`), await m.locator("dialog[open] [data-pages-count]").innerText().catch(() => ""))
await m.screenshot({ path: `${OUT}phone-settings.png`, fullPage: true })

// Tiles: the open sidebar's pages as a grid of icons, named by their tooltips, in the list's order; the drawer keeps rows.
const listed = await side()
await setShow("tiles")
await page.goto("about:blank"); await page.goto(`${B}${hashOf("People")}`)
await page.waitForSelector("[data-pin-tiles] [data-pin]", { timeout: 10000 }).catch(() => {})
const grid = await page.locator("[data-pin-tiles] [data-pin]").evaluateAll((ts) => ts.map((t) => ({ tip: t.getAttribute("data-tip"), text: t.textContent, top: Math.round(t.getBoundingClientRect().top) })))
check("Tiles: the sidebar's pages as a grid, named by tooltips", grid.length >= 5 && grid.every((t) => t.tip && !t.text) && grid[0].top === grid[3].top && same(grid.map((t) => t.tip), listed.map((l) => l.replaceAll(" / ", "/"))), [grid.map((t) => t.tip), listed])
check("Tiles: the open page's tile is the active one", await page.locator('[data-pin-tiles] [aria-current="page"]').getAttribute("data-tip") === "People")
await page.screenshot({ path: `${OUT}desktop-tiles.png` })
await page.locator("[data-pin-tiles] [data-pin]").nth(1).click(); await page.waitForTimeout(600)
check("Tiles: a click opens its page", await page.locator("[data-pin-tiles] [data-pin]").nth(1).getAttribute("aria-current") === "page")
await m.goto("about:blank"); await m.goto(`${B}#files`); await m.waitForTimeout(1200)
await m.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await m.waitForTimeout(500)
check("Tiles: a phone's drawer keeps the list", (await m.locator("[data-phone-drawer=left] nav[aria-label=Pages] a").count()) >= 5 && !(await m.locator("[data-phone-drawer=left] [data-pin-tiles]").count()))
await setShow(showBefore)

const md = await (await fetch(`${B}api/render?path=${encodeURIComponent(`${DIR}/People.md`)}`)).text()
check("/api/render reads a dashboard as text", md.includes("## Want to reach out") && !md.includes("```block-"), md.slice(0, 200))
await fetch(`${B}api/config/pages`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: pinnedBefore }) })
await fetch(`${B}api/config/plugins`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled: pluginsBefore.disabled ?? [], enabled: pluginsBefore.enabled ?? [] }) })
await done()
