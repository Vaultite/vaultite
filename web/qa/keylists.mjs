// Keyboard lists: the file tree, sidebars, menus, areas, resizing edges, the palette, a tab bar and a canvas.
// Throwaway only.
//   node web/qa/keylists.mjs <base url> [out dir]
// Paths: web/src/core/keylist.ts
import { SHOTS, palette, qa } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage()), ui = app(page)
const where = () => page.evaluate(() => {
  const a = document.activeElement
  const row = a?.closest("[data-keyrow]")
  return {
    row: row ? (row.closest("[data-tree-path]")?.getAttribute("data-tree-path") ?? row.textContent.trim()) : null,
    side: a?.closest("[data-sidebar-body]")?.getAttribute("data-sidebar-body") ?? null,
    tag: a?.tagName ?? null, xterm: !!a?.matches("[data-term-input]"),
  }
})
const expanded = (p) => page.evaluate((p) => document.querySelector(`[data-sidebar-body=left] [data-tree-path="${p}"]`)?.querySelector("[role=treeitem]")?.getAttribute("aria-expanded"), p)
const focusRow = (p) => page.evaluate((p) => document.querySelector(`[data-sidebar-body=left] [data-tree-path="${p}"] [data-keyrow]`)?.focus(), p)
const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
const tabCount = () => page.locator("[data-tab-id], [role=tab]").count()

await page.goto(`${B}#file/${encodeURIComponent("Dashboards/People.md")}`); await page.locator("[data-sidebar-body=left] [data-tree-path=Notes]").waitFor(); await ui.idle()
const topFiles = await page.evaluate(() => [...document.querySelectorAll("[data-sidebar-body=left] [data-tree-path]")]
  .map((e) => e.getAttribute("data-tree-path")).filter((p) => p && !p.includes("/") && p.endsWith(".md")))
const ENTER_FILE = topFiles[0]
check(`the tree shows top-level files to open (${topFiles.join(", ")})`, topFiles.length >= 1)

await palette(page, "Focus the left sidebar", 0); await ui.idle()
let w = await where()
check(`Focus the left sidebar: the keyboard is on a row there (${w.row})`, w.side === "left" && !!w.row)
await page.evaluate(() => document.querySelector("[data-sidebar-body=left] [data-tree-path=Notes]")?.querySelector("[role=treeitem]")?.getAttribute("aria-expanded") === "true" && document.querySelector("[data-sidebar-body=left] [data-tree-path=Notes] [data-keyrow]")?.click())
await focusRow("Notes"); await ui.idle()
check("Notes starts closed", await expanded("Notes") === "false")
await page.keyboard.press("ArrowRight"); await ui.idle()
check("→ opens a folder", await expanded("Notes") === "true")
await page.keyboard.press("ArrowRight"); await ui.idle()
w = await where()
check(`→ again steps into it (${w.row})`, w.row?.startsWith("Notes/"))
await page.keyboard.press("ArrowLeft"); await ui.idle()
check("← goes to the parent folder", (await where()).row === "Notes")
await page.keyboard.press("ArrowLeft"); await ui.idle()
check("← again closes it", await expanded("Notes") === "false")
await page.keyboard.press("ArrowDown"); await ui.idle()
const next = (await where()).row
check(`↓ moves to the next row (${next})`, !!next && next !== "Notes")
await page.keyboard.press("Home"); await ui.idle()
const first = (await where()).row
await page.keyboard.press("End"); await ui.idle()
check("Home and End go to the first and last rows", (await where()).row !== first)
await focusRow(ENTER_FILE); await page.keyboard.press("Enter"); await ui.idle()
check(`Enter opens the file (${ENTER_FILE})`, (await hash()).includes(ENTER_FILE))
await focusRow("ME.md"); const tabs0 = await tabCount()
await page.keyboard.press("ControlOrMeta+Enter"); await ui.idle()
check("⌘Enter opens it in a new tab", await tabCount() > tabs0)
await focusRow("ME.md"); await page.keyboard.press("Escape"); await ui.idle()
check("Escape gives the keyboard back to the pane", (await where()).side === null)
await page.screenshot({ path: `${OUT}keylists-tree.png` })

const menuOpen = () => page.evaluate(() => !!document.querySelector("[role=menu]"))
await focusRow("Notes"); await page.keyboard.press("Tab"); await ui.idle()
check("Tab from a tree row leaves the tree", !(await where()).row?.startsWith("Notes") && !await page.evaluate(() => !!document.activeElement?.closest("[role=tree]")))
await page.keyboard.press("Shift+Tab"); await ui.idle()
check("⇧Tab comes back to the row it was on", (await where()).row === "Notes")
await page.keyboard.press("Shift+F10"); await ui.idle()
check("⇧F10 opens the row's menu", await menuOpen())
await page.keyboard.press("Tab"); await ui.idle()
check("Tab closes the menu, the keyboard back on the row", !await menuOpen() && (await where()).row === "Notes")
await page.keyboard.press("F6"); await ui.idle()
check("F6 goes on from the sidebar to the pane", await page.evaluate(() => !!document.activeElement?.closest("[data-pane]")))
await page.keyboard.press("Shift+F6"); await ui.idle()
check("⇧F6 goes back to the sidebar", (await where()).side === "left")
const width = () => page.evaluate(() => document.querySelector("[data-sidebar-body=left]")?.getBoundingClientRect().width)
const w0 = await width()
await page.evaluate(() => document.querySelector("[role=separator][aria-label='Resize the sidebar']")?.focus())
await page.keyboard.press("ArrowRight"); await ui.idle()
check("→ on the sidebar's edge widens it", await width() > w0)
await page.keyboard.press("Enter"); await ui.idle()

await page.keyboard.press("ControlOrMeta+p"); await page.locator("[data-i]").first().waitFor(); await ui.idle()
const selected = () => page.evaluate(() => [...document.querySelectorAll("[data-i]")].findIndex((el) => el.className.includes("bg-foreground/[0.07]")))
const s0 = await selected()
await page.keyboard.press("Control+j"); await ui.idle()
const s1 = await selected()
await page.keyboard.press("Control+k"); await ui.idle()
check("the palette: Ctrl+J moves down, Ctrl+K up", s1 === s0 + 1 && await selected() === s0)
await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await ui.idle()
check("the palette: Tab stays in its field", await page.evaluate(() => document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest("[role=dialog]")))
await page.keyboard.press("Escape"); await ui.idle()
check("the palette: Escape closes it", !await page.evaluate(() => !!document.querySelector("[role=dialog][aria-modal=true]:not(dialog)")))

const ws = page.locator("[data-tab-strip]")
for (const h of ["settings", "view/files", "view/search"]) {
  await ws.locator("button[aria-label='New tab']").click(); await ui.idle()
  await page.evaluate((h) => { location.hash = h }, h); await ui.idle()
}
const tabsNow = () => ws.locator("[role=tab]").evaluateAll((ts) => ts.map((t) => t.textContent.trim()))
const onTab = () => page.evaluate(() => document.activeElement?.matches("[role=tab]") ? document.activeElement.textContent.trim() : document.activeElement?.getAttribute("aria-label"))
const names = await tabsNow(), shown = await ws.locator("[role=tab][aria-selected=true]").textContent()
await ws.locator("button[aria-label='New tab']").focus()
await page.keyboard.press("Shift+Tab"); await ui.idle()
check("tab bar: Shift+Tab into it lands on the shown tab, not an X", (await onTab()) === shown.trim(), await onTab())
await page.keyboard.press("Home"); await ui.idle()
check("tab bar: Home, the first tab", (await onTab()) === names[0], await onTab())
await page.keyboard.press("ArrowRight"); await ui.idle()
check("tab bar: ArrowRight, the next", (await onTab()) === names[1], await onTab())
await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await ui.idle()
check("tab bar: ArrowLeft goes round to the last", (await onTab()) === names.at(-1), await onTab())
await page.keyboard.press("Tab"); await ui.idle()
check("tab bar: Tab leaves it, past every tab and X", (await onTab()) === "New tab", await onTab())
await page.keyboard.press("Shift+Tab"); await page.keyboard.press("End"); await page.keyboard.press("Delete"); await ui.idle()
check("tab bar: Delete closes the tab with the keyboard", (await tabsNow()).length === names.length - 1, await tabsNow())

await page.goto(`${B}#file/${encodeURIComponent("Projects/Lighthouse/Launch plan.canvas")}`)
const board = page.locator("#main-scroll [data-canvas-board]").first()
await board.waitFor(); await ui.idle()
const bg = () => board.evaluate((el) => el.style.backgroundPosition)
const box = await board.boundingBox()
await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30); await ui.idle()
await board.evaluate((el) => el.focus())
const p0 = await bg()
await page.keyboard.press("ArrowRight"); await ui.idle()
const p1 = await bg()
check(`the arrows pan a canvas (${p0} -> ${p1})`, p1 !== p0)
await page.screenshot({ path: `${OUT}keylists-canvas.png` })

await done()
