// Keyboard lists (web/src/core/keylist.ts): the file tree moves with the arrows (→ opens a folder and steps in, ← goes
// to the parent and closes it, Enter opens a file, ⌘Enter in a new tab), "Focus the left sidebar" brings the keyboard
// in and Escape gives it back; Tab passes a list as one stop, ⇧F10 opens a row's menu, F6 moves between areas, an edge
// resizes with the arrows; the palette takes Ctrl+J/K and keeps Tab; a canvas pans with the arrows. Throwaway only.
//   node web/qa/keylists.mjs <base url> [out dir]
import { SHOTS, palette, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
/** The keyboard's row: its tree path (or its text), and where it is. */
const where = () => page.evaluate(() => {
  const a = document.activeElement
  const row = a?.closest("[data-keyrow]")
  return {
    row: row ? (row.closest("[data-tree-path]")?.getAttribute("data-tree-path") ?? row.textContent.trim()) : null,
    side: a?.closest("[data-sidebar-body]")?.getAttribute("data-sidebar-body") ?? null,
    tag: a?.tagName ?? null, xterm: !!a?.matches(".xterm-helper-textarea"),
  }
})
const expanded = (p) => page.evaluate((p) => document.querySelector(`[data-sidebar-body=left] [data-tree-path="${p}"]`)?.closest("[role=treeitem]")?.getAttribute("aria-expanded"), p)
const focusRow = (p) => page.evaluate((p) => document.querySelector(`[data-sidebar-body=left] [data-tree-path="${p}"] [data-keyrow]`)?.focus(), p)
const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
const tabCount = () => page.locator("[data-tab-id], [role=tab]").count()

await page.goto(`${B}#file/${encodeURIComponent("Dashboards/People.md")}`); await wait(2000)
// A file at the vault's top level (whatever the vault has: the sandbox's ME.md), one not open yet.
const topFiles = await page.evaluate(() => [...document.querySelectorAll("[data-sidebar-body=left] [data-tree-path]")]
  .map((e) => e.getAttribute("data-tree-path")).filter((p) => p && !p.includes("/") && p.endsWith(".md")))
const ENTER_FILE = topFiles[0]
check(`the tree shows top-level files to open (${topFiles.join(", ")})`, topFiles.length >= 1)

// ---- the arrows
await palette(page, "Focus the left sidebar", 600)
let w = await where()
check(`Focus the left sidebar: the keyboard is on a row there (${w.row})`, w.side === "left" && !!w.row)
await page.evaluate(() => document.querySelector("[data-sidebar-body=left] [data-tree-path=Notes]")?.closest("[role=treeitem]")?.getAttribute("aria-expanded") === "true" && document.querySelector("[data-sidebar-body=left] [data-tree-path=Notes] [data-keyrow]")?.click())
await focusRow("Notes"); await wait(100)
check("Notes starts closed", await expanded("Notes") === "false")
await page.keyboard.press("ArrowRight"); await wait(250)
check("→ opens a folder", await expanded("Notes") === "true")
await page.keyboard.press("ArrowRight"); await wait(150)
w = await where()
check(`→ again steps into it (${w.row})`, w.row?.startsWith("Notes/"))
await page.keyboard.press("ArrowLeft"); await wait(150)
check("← goes to the parent folder", (await where()).row === "Notes")
await page.keyboard.press("ArrowLeft"); await wait(250)
check("← again closes it", await expanded("Notes") === "false")
await page.keyboard.press("ArrowDown"); await wait(150)
const next = (await where()).row
check(`↓ moves to the next row (${next})`, !!next && next !== "Notes")
await page.keyboard.press("Home"); await wait(150)
const first = (await where()).row
await page.keyboard.press("End"); await wait(150)
check("Home and End go to the first and last rows", (await where()).row !== first)
await focusRow(ENTER_FILE); await page.keyboard.press("Enter"); await wait(800)
check(`Enter opens the file (${ENTER_FILE})`, (await hash()).includes(ENTER_FILE))
await focusRow("ME.md"); const tabs0 = await tabCount()
await page.keyboard.press("ControlOrMeta+Enter"); await wait(800)
check("⌘Enter opens it in a new tab", await tabCount() > tabs0)
await focusRow("ME.md"); await page.keyboard.press("Escape"); await wait(400)
check("Escape gives the keyboard back to the pane", (await where()).side === null)
await page.screenshot({ path: `${OUT}keylists-tree.png` })

// ---- Tab past the tree, its menu, the areas
const menuOpen = () => page.evaluate(() => !!document.querySelector("[role=menu]"))
await focusRow("Notes"); await page.keyboard.press("Tab"); await wait(150)
check("Tab from a tree row leaves the tree", !(await where()).row?.startsWith("Notes") && !await page.evaluate(() => !!document.activeElement?.closest("[role=tree]")))
await page.keyboard.press("Shift+Tab"); await wait(150)
check("⇧Tab comes back to the row it was on", (await where()).row === "Notes")
await page.keyboard.press("Shift+F10"); await wait(300)
check("⇧F10 opens the row's menu", await menuOpen())
await page.keyboard.press("Tab"); await wait(300)
check("Tab closes the menu, the keyboard back on the row", !await menuOpen() && (await where()).row === "Notes")
await page.keyboard.press("F6"); await wait(300)
check("F6 goes on from the sidebar to the pane", await page.evaluate(() => !!document.activeElement?.closest("[data-pane]")))
await page.keyboard.press("Shift+F6"); await wait(400)
check("⇧F6 goes back to the sidebar", (await where()).side === "left")
const width = () => page.evaluate(() => document.querySelector("[data-sidebar-body=left]")?.getBoundingClientRect().width)
const w0 = await width()
await page.evaluate(() => document.querySelector("[role=separator][aria-label='Resize the sidebar']")?.focus())
await page.keyboard.press("ArrowRight"); await wait(300)
check("→ on the sidebar's edge widens it", await width() > w0)
await page.keyboard.press("Enter"); await wait(300)

// ---- the palette: Ctrl+J / Ctrl+K
await page.keyboard.press("ControlOrMeta+p"); await wait(400)
const selected = () => page.evaluate(() => [...document.querySelectorAll("[data-i]")].findIndex((el) => el.className.includes("bg-foreground/[0.07]")))
const s0 = await selected()
await page.keyboard.press("Control+j"); await wait(100)
const s1 = await selected()
await page.keyboard.press("Control+k"); await wait(100)
check("the palette: Ctrl+J moves down, Ctrl+K up", s1 === s0 + 1 && await selected() === s0)
await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await wait(100)
check("the palette: Tab stays in its field", await page.evaluate(() => document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest("[role=dialog]")))
await page.keyboard.press("Escape"); await wait(300)
check("the palette: Escape closes it", !await page.evaluate(() => !!document.querySelector("[role=dialog][aria-modal=true]:not(dialog)")))

// ---- a canvas
await page.goto(`${B}#file/${encodeURIComponent("Projects/Lighthouse/Launch plan.canvas")}`); await wait(2500)
// (the one shown: a pane keeps its other tabs drawn but hidden, and one may embed a canvas)
const board = page.locator("#main-scroll [data-canvas-board]").first()
const bg = () => board.evaluate((el) => el.style.backgroundPosition)
const box = await board.boundingBox()
await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30); await wait(300)
await board.evaluate((el) => el.focus())
const p0 = await bg()
await page.keyboard.press("ArrowRight"); await wait(200)
const p1 = await bg()
check(`the arrows pan a canvas (${p0} -> ${p1})`, p1 !== p0)
await page.screenshot({ path: `${OUT}keylists-canvas.png` })

await done()
