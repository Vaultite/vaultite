// Vim's keys in keyboard lists (lists.ts over web/src/core/keylist.ts): the tree, Ctrl+W into the sidebar, a canvas, a
// terminal. Installs the plugin; WRITES plugins.json's `enabled` (on, then off): throwaway only.
//   node web/qa/vimlists.mjs <base url> [out dir]
import { apiAt, openPalette, qa } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
// Vim is built in, off until in plugins.json's `enabled`: switched there, the rest of the list kept.
const vim = async (on) => {
  const api = apiAt(B), conf = await api("GET", "config/plugins")
  return api("PATCH", "config/plugins", { enabled: [...(conf.enabled ?? []).filter((x) => x !== "vim"), ...(on ? ["vim"] : [])] })
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage()), ui = app(page)
/** The keyboard's row: its tree path (or its text), and where it is. */
const where = () => page.evaluate(() => {
  const a = document.activeElement
  const row = a?.closest("[data-keyrow]")
  return {
    row: row ? (row.closest("[data-tree-path]")?.getAttribute("data-tree-path") ?? row.textContent.trim()) : null,
    side: a?.closest("[data-sidebar-body]")?.getAttribute("data-sidebar-body") ?? null,
    tag: a?.tagName ?? null, inTerminal: !!a?.matches("[data-term-input]"),
  }
})
const expanded = (p) => page.evaluate((p) => document.querySelector(`[data-sidebar-body=left] [data-tree-path="${p}"]`)?.querySelector("[role=treeitem]")?.getAttribute("aria-expanded"), p)
const focusRow = (p) => page.evaluate((p) => document.querySelector(`[data-sidebar-body=left] [data-tree-path="${p}"] [data-keyrow]`)?.focus(), p)
const hash = () => page.evaluate(() => decodeURIComponent(location.hash))

const tree = page.locator("[data-sidebar-body=left] [data-tree-path]")
const people = async () => { await page.goto(`${B}#file/${encodeURIComponent("Dashboards/People.md")}`); await tree.first().waitFor(); await page.locator("article.file-view[data-path='Dashboards/People.md']:visible").waitFor(); await ui.idle() }
await people()
// A file at the vault's top level (whatever the vault has: the sandbox's ME.md), to open with l.
const L_FILE = await page.evaluate(() => [...document.querySelectorAll("[data-sidebar-body=left] [data-tree-path]")]
  .map((e) => e.getAttribute("data-tree-path")).filter((p) => p && !p.includes("/") && p.endsWith(".md")).pop())
let w

// ---- Vim
await vim(true); await page.reload(); await tree.first().waitFor(); await ui.idle()
await people()
await page.mouse.click(700, 500); await ui.idle()
await page.keyboard.press("Control+w"); await page.keyboard.press("h"); await ui.idle()
w = await where()
check(`Vim: Ctrl+W h from the leftmost pane goes into the left sidebar (${w.row})`, w.side === "left" && !!w.row)
await focusRow("Notes"); await ui.idle()
await page.keyboard.press("l"); await ui.idle()
check("l opens a folder", await expanded("Notes") === "true")
await page.keyboard.press("j"); await ui.idle()
check("j moves down into it", (await where()).row?.startsWith("Notes/"))
await page.keyboard.press("h"); await ui.idle()
check("h goes to the parent", (await where()).row === "Notes")
await page.keyboard.press("h"); await ui.idle()
check("h closes it", await expanded("Notes") === "false")
await page.keyboard.press("k"); await ui.idle()
check("k moves up", (await where()).row !== "Notes")
await page.keyboard.press("Shift+G"); await ui.idle()
const lastRow = (await where()).row
await page.keyboard.press("g"); await page.keyboard.press("g"); await ui.idle()
check(`G and gg go to the last and first rows (${lastRow})`, (await where()).row !== lastRow)
await focusRow("ME.md"); const h0 = await hash()
await page.keyboard.press("Space"); await ui.idle(); await page.keyboard.press("Escape"); await ui.idle()
check("Space (the leader) on a row doesn't click it", await hash() === h0 && (await where()).row === "ME.md")
await focusRow(L_FILE); await page.keyboard.press("l"); await ui.idle()
check(`l on a file opens it (${L_FILE})`, (await hash()).includes(L_FILE))
await focusRow("ME.md"); await ui.idle()
await page.keyboard.press("Control+w"); await page.keyboard.press("l"); await ui.idle()
check("Ctrl+W l comes back out of the sidebar", (await where()).side === null)
await page.keyboard.press("Escape"); await ui.idle()

// ---- a canvas
await page.goto(`${B}#file/${encodeURIComponent("Projects/Lighthouse/Launch plan.canvas")}`)
// (the one shown: a pane keeps its other tabs drawn but hidden, and one may embed a canvas)
const board = page.locator("#main-scroll [data-canvas-board]").first()
await board.waitFor(); await ui.idle()
const bg = () => board.evaluate((el) => el.style.backgroundPosition)
const box = await board.boundingBox()
await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30); await ui.idle()
await board.evaluate((el) => el.focus())
const p0 = await bg()
await page.keyboard.press("j"); await ui.idle()
check("Vim's j pans a canvas", await bg() !== p0)

// ---- a terminal
await page.keyboard.press("Control+`")
const ta = page.locator("[data-term-input]").last()
await ta.waitFor(); await ui.idle()
await ta.focus(); await ui.idle()
await page.evaluate(() => { window.__takenCtrlW = false; addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "w" && e.defaultPrevented && !e.target.matches?.("[data-term-input]")) window.__takenCtrlW = true }) })
await page.keyboard.type("echo abc def"); await page.keyboard.press("Control+w"); await ui.idle()
const hint = await page.locator('[aria-label="Keys"]').count()
check("in a terminal Ctrl+W stays the shell's", !(await page.evaluate(() => window.__takenCtrlW)) && hint === 0 && (await where()).inTerminal)
await page.keyboard.press("Control+c"); await ui.idle()
// (a Mac's keys only: elsewhere Ctrl is the app's Mod and Ctrl+\ toggles the sidebar, so Leave the terminal has none)
if (process.platform === "darwin") {
  await page.keyboard.press("Control+\\"); await page.keyboard.press("Control+n"); await ui.idle()
  check("Ctrl+\\ Ctrl+N leaves the terminal", !(await where()).inTerminal)
} else console.log("skip Ctrl+\\ Ctrl+N leaves the terminal: a Mac's keys only")
await openPalette(page); await ui.idle(); await page.keyboard.type("End terminal session"); await ui.idle()
await page.keyboard.press("Escape")

await vim(false)
await done()
