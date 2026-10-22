// Typing in a menu (components/ContextMenu.tsx): the sidebar's Panels ▸ filtered to a hidden panel in More, ticked with
// Enter, Backspace and Escape; a long menu says it can be typed into; the panels' icons beside their checks. Then
// Customize sidebars (pages/Sidebars.tsx): opened from the menu, a panel dragged between the sidebars and down to
// Hidden, moved from its menu, the filter, Restore defaults and its Undo. WRITES sidebars.json and empties the
// workspaces: throwaway only.
//   node web/qa/menufilter.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/menufilter-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json" }
const put = async (s) => {
  const body = { right: [], collapsed: [], heights: {}, ...s }
  await fetch(new URL("/api/config/sidebars", B), { method: "PUT", headers: json, body: JSON.stringify(body) })
}
const saved = async (side = "left") => {
  const w = (await fetch(new URL("/api/workspaces", B)).then((r) => r.json())).workspaces
  const s = w?.[0]?.sidebars ?? await fetch(new URL("/api/config/sidebars", B)).then((r) => r.json())
  return (s?.[side] ?? []).join("|")
}
for (const n of [1, 2, 3, 4, 5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
await put({ left: ["search:search", "pages:pages", "files:files"] })

try {
  const page = watch(await browser.newPage({ viewport: { width: 1400, height: 900 } }))
  await page.goto(B)
  await page.waitForSelector("[data-sidebar-body=left] [data-panel='files:files']", { timeout: 30000 })
  const L = "[data-sidebar-body=left]"
  const menus = () => page.locator("[role=menu]")
  const closeMenus = async () => { for (let i = 0; i < 4 && await menus().count(); i++) { await page.keyboard.press("Escape"); await wait(120) } }
  const rows = (n) => menus().nth(n).locator(":scope > button").allInnerTexts().then((t) => t.map((x) => x.trim()))

  // ---------- typing in Panels ▸ ----------
  await page.click(`${L} [data-panel='files:files'] [data-panel-handle]`, { button: "right" })
  await menus().first().locator(":scope > button", { hasText: /^Panels$/ }).hover()
  await until(async () => (await menus().count()) === 2)
  const icons = await menus().nth(1).locator("[role=menuitemcheckbox]").first().locator("svg").count()
  check("a panel in Panels ▸: its check and its icon", icons === 2, icons)
  check("Panels ▸ ends with Customize sidebars…", (await rows(1)).at(-1) === "Customize sidebars…", await rows(1))
  await menus().nth(1).locator(":scope > button").first().focus()
  await page.keyboard.type("outl")
  await wait(150)
  const found = await rows(1)
  check("typed 'outl': Outline from More, first", found[0] === "Outline" && !found.includes("Search field"), found)
  check("...the query shown at the top", (await menus().nth(1).locator("[data-menu-filter]").innerText()).includes("outl"))
  check("...the best one focused", await page.evaluate(() => document.activeElement?.textContent?.trim()) === "Outline")
  await page.screenshot({ path: `${OUT}filtered.png` })
  await page.keyboard.press("Enter")
  check("Enter ticks it: Outline at the end of the left, the menu still open",
    !!(await until(async () => (await saved()) === "search:search|pages:pages|files:files|outline:outline")) && (await menus().count()) > 0, await saved())
  for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace")
  await wait(100)
  check("Backspace widens it again", (await rows(1)).length > found.length, await rows(1))
  await page.keyboard.type("ou"); await page.keyboard.press("Escape"); await wait(100)
  check("Escape clears the query first, the menu stays", (await menus().count()) === 2 && !(await menus().nth(1).locator("[data-menu-filter]").count()))
  await page.keyboard.type("zzzq"); await wait(100)
  check("nothing matches: says so", (await menus().nth(1).innerText()).includes("No matches"))
  await page.keyboard.press("Backspace"); await wait(100)
  check("...and still takes keys: Backspace edits the query", (await menus().nth(1).locator("[data-menu-filter]").innerText()).includes("zzz")
    && !(await menus().nth(1).locator("[data-menu-filter]").innerText()).includes("zzzq"))
  await page.keyboard.type("q"); await page.keyboard.press("Escape"); await wait(100)
  check("...Escape clears it, the menu stays", (await menus().count()) === 2 && !(await menus().nth(1).locator("[data-menu-filter]").count()))
  await closeMenus()

  // ---------- a long menu says so ----------
  await page.click(`${L} [data-panel='files:files'] [data-panel-handle]`, { button: "right" })
  await menus().first().locator(":scope > button", { hasText: /^Panels$/ }).hover()
  await until(async () => (await menus().count()) === 2)
  await menus().nth(1).locator(":scope > button", { hasText: /^More$/ }).hover()
  await until(async () => (await menus().count()) === 3)
  const long = await rows(2)
  check("More ▸ (a long list): 'Type to filter' on top", long.length < 12 || (await menus().nth(2).locator("[data-menu-filter]").innerText()).includes("Type to filter"), long.length)
  await page.screenshot({ path: `${OUT}more.png` })
  await closeMenus()

  // ---------- Customize sidebars ----------
  await page.click(`${L} [data-panel='files:files'] [data-panel-handle]`, { button: "right" })
  await menus().first().locator(":scope > button", { hasText: /^Panels$/ }).hover()
  await until(async () => (await menus().count()) === 2)
  await menus().nth(1).locator(":scope > button", { hasText: "Customize sidebars…" }).click()
  await page.waitForSelector("[data-customize-sidebars]")
  const list = (w) => page.$$eval(`[data-panel-list=${w}] > [data-row]`, (els) => els.map((e) => e.dataset.row).join("|"))
  check("the sheet: the left sidebar's panels in order", (await list("left")) === "search:search|pages:pages|files:files|outline:outline", await list("left"))
  check("...the right one empty, saying where to drag", (await page.locator("[data-panel-list=right]").innerText()).includes("Drag panels here"))
  check("...the hidden ones below", (await list("hidden")).length > 0)
  await page.screenshot({ path: `${OUT}sheet.png` })
  const mid = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2] }
  const drag = async (from, [x, y]) => {
    const [fx, fy] = await mid(from)
    await page.mouse.move(fx, fy); await page.mouse.down()
    await page.mouse.move(fx + 6, fy + 6, { steps: 3 }); await page.mouse.move(x, y, { steps: 12 }); await wait(120)
    await page.mouse.up(); await wait(200)
  }
  await drag("[data-panel-list=left] > [data-row='pages:pages']", await mid("[data-panel-list=right]"))
  check("Pinned dragged to the right sidebar", !!(await until(async () => (await saved("right")) === "pages:pages" && !(await saved()).includes("pages:pages"))), [await saved(), await saved("right")])
  const top = await page.locator("[data-panel-list=left] > [data-row='search:search']").boundingBox()
  await drag("[data-panel-list=left] > [data-row='outline:outline']", [top.x + 40, top.y + 2])
  check("Outline dragged to the top of the left", !!(await until(async () => (await saved()) === "outline:outline|search:search|files:files")), await saved())
  await drag("[data-panel-list=left] > [data-row='outline:outline']", await mid("[data-panel-list=hidden]"))
  check("Outline dragged down to Hidden: hidden", !!(await until(async () => !(await saved()).includes("outline"))) && (await list("hidden")).includes("outline:outline"), await saved())
  await page.click("[data-panel-list=hidden] > [data-row='outline:outline']", { button: "right" })
  await page.getByRole("menuitem", { name: "Show in right sidebar" }).click()
  check("its menu: Show in right sidebar", !!(await until(async () => (await saved("right")) === "pages:pages|outline:outline")), await saved("right"))
  await page.click("[data-panel-list=right] > [data-row='outline:outline']", { button: "right" })
  await page.getByRole("menuitem", { name: "Move up" }).click()
  check("its menu: Move up", !!(await until(async () => (await saved("right")) === "outline:outline|pages:pages")), await saved("right"))
  await page.fill("[data-customize-sidebars] input", "file")
  check("the filter: only the matching panels", (await list("left")) === "files:files" && !(await list("right")), [await list("left"), await list("right")])
  await page.fill("[data-customize-sidebars] input", "")
  await page.click("[data-restore-sidebars]")
  check("Restore defaults: each panel where it comes", !!(await until(async () => (await saved()) === "search:search|pages:pages|buttons:buttons|terminal:sessions|cloud-sessions:cloud|files:files" && (await saved("right")) === "companion:conversations")), [await saved(), await saved("right")])
  check("...the button undoes it now", (await page.locator("[data-restore-sidebars]").innerText()) === "Undo restore")
  await page.click("[data-restore-sidebars]")
  check("...Undo puts them back", !!(await until(async () => (await saved("right")) === "outline:outline|pages:pages")), await saved("right"))
  check("...and it restores again", (await page.locator("[data-restore-sidebars]").innerText()) === "Restore defaults")
  await page.screenshot({ path: `${OUT}sheet-after.png` })
} finally {
  await put({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"] })
}
await done()
