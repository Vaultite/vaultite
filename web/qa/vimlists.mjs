// Vim's keys in keyboard lists (lists.ts, over the app's web/src/core/keylist.ts): j/k/h/l/gg/G move in the file
// tree, Ctrl+W h from the leftmost pane goes into the sidebar and Ctrl+W l comes back, Space on a row doesn't click it;
// a canvas pans with h/j/k/l; in a terminal Ctrl+W stays the shell's and Ctrl+\ Ctrl+N leaves it. Installs the plugin;
// WRITES plugins.json's `enabled` (Vim on, then off again): throwaway only.
//   node web/qa/vimlists.mjs <base url> [out dir]
import { apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
// Vim is built in, off until in plugins.json's `enabled`: switched there, the rest of the list kept.
const vim = async (on) => {
  const api = apiAt(B), conf = await api("GET", "config/plugins")
  return api("PATCH", "config/plugins", { enabled: [...(conf.enabled ?? []).filter((x) => x !== "vim"), ...(on ? ["vim"] : [])] })
}

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

await page.goto(`${B}#file/${encodeURIComponent("Dashboards/People.md")}`); await wait(2000)
// A file at the vault's top level (whatever the vault has: the sandbox's ME.md), to open with l.
const L_FILE = await page.evaluate(() => [...document.querySelectorAll("[data-sidebar-body=left] [data-tree-path]")]
  .map((e) => e.getAttribute("data-tree-path")).filter((p) => p && !p.includes("/") && p.endsWith(".md")).pop())
let w

// ---- Vim
await vim(true); await page.reload(); await wait(2500)
await page.goto(`${B}#file/${encodeURIComponent("Dashboards/People.md")}`); await wait(1500)
await page.mouse.click(700, 500); await wait(200)
await page.keyboard.press("Control+w"); await page.keyboard.press("h"); await wait(500)
w = await where()
check(`Vim: Ctrl+W h from the leftmost pane goes into the left sidebar (${w.row})`, w.side === "left" && !!w.row)
await focusRow("Notes"); await wait(100)
await page.keyboard.press("l"); await wait(250)
check("l opens a folder", await expanded("Notes") === "true")
await page.keyboard.press("j"); await wait(150)
check("j moves down into it", (await where()).row?.startsWith("Notes/"))
await page.keyboard.press("h"); await wait(150)
check("h goes to the parent", (await where()).row === "Notes")
await page.keyboard.press("h"); await wait(250)
check("h closes it", await expanded("Notes") === "false")
await page.keyboard.press("k"); await wait(150)
check("k moves up", (await where()).row !== "Notes")
await page.keyboard.press("Shift+G"); await wait(150)
const lastRow = (await where()).row
await page.keyboard.press("g"); await page.keyboard.press("g"); await wait(150)
check(`G and gg go to the last and first rows (${lastRow})`, (await where()).row !== lastRow)
await focusRow("ME.md"); const h0 = await hash()
await page.keyboard.press("Space"); await wait(150); await page.keyboard.press("Escape"); await wait(400)
check("Space (the leader) on a row doesn't click it", await hash() === h0 && (await where()).row === "ME.md")
await focusRow(L_FILE); await page.keyboard.press("l"); await wait(800)
check(`l on a file opens it (${L_FILE})`, (await hash()).includes(L_FILE))
await focusRow("ME.md"); await wait(100)
await page.keyboard.press("Control+w"); await page.keyboard.press("l"); await wait(500)
check("Ctrl+W l comes back out of the sidebar", (await where()).side === null)
await page.keyboard.press("Escape"); await wait(200)

// ---- a canvas
await page.goto(`${B}#file/${encodeURIComponent("Projects/Lighthouse/Launch plan.canvas")}`); await wait(2500)
// (the one shown: a pane keeps its other tabs drawn but hidden, and one may embed a canvas)
const board = page.locator("#main-scroll [data-canvas-board]").first()
const bg = () => board.evaluate((el) => el.style.backgroundPosition)
const box = await board.boundingBox()
await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30); await wait(300)
await board.evaluate((el) => el.focus())
const p0 = await bg()
await page.keyboard.press("j"); await wait(200)
check("Vim's j pans a canvas", await bg() !== p0)

// ---- a terminal
await page.keyboard.press("Control+`"); await wait(3000)
const ta = page.locator(".xterm-helper-textarea").last()
await ta.focus(); await wait(300)
await page.evaluate(() => { window.__takenCtrlW = false; addEventListener("keydown", (e) => { if (e.ctrlKey && e.key === "w" && e.defaultPrevented && !e.target.matches?.(".xterm-helper-textarea")) window.__takenCtrlW = true }) })
await page.keyboard.type("echo abc def"); await page.keyboard.press("Control+w"); await wait(300)
const hint = await page.locator('[aria-label="Keys"]').count()
check("in a terminal Ctrl+W stays the shell's", !(await page.evaluate(() => window.__takenCtrlW)) && hint === 0 && (await where()).xterm)
await page.keyboard.press("Control+c"); await wait(200)
await page.keyboard.press("Control+\\"); await page.keyboard.press("Control+n"); await wait(300)
check("Ctrl+\\ Ctrl+N leaves the terminal", !(await where()).xterm)
await page.keyboard.press("Meta+p"); await wait(300); await page.keyboard.type("End terminal session"); await wait(200)
await page.keyboard.press("Escape")

await vim(false)
await done()
