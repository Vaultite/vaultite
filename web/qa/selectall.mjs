// ⌘A selects the text the user is in, never the whole window (core/selectAll.ts, core/commands.ts' FIELD_KEYS): a
// file's name being renamed in the tree selects only that name (not the tree's rows); the sidebar selects nothing; a
// note in reading view, with the keyboard on its page, selects just its text. Throwaway only.
//   node web/qa/selectall.mjs <base url> [out dir]
import { SHOTS, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)

const page = watch(await browser.newPage({ viewport: { width: 1400, height: 900 } }))
const L = "[data-sidebar-body=left]"
const selected = () => page.evaluate(() => getSelection().toString())
await page.goto(B)
await page.waitForSelector(`${L} [data-tree-path]`, { timeout: 30000 })
const file = await page.evaluate(() => [...document.querySelectorAll("[data-sidebar-body=left] [data-tree-path]")]
  .map((e) => e.getAttribute("data-tree-path")).find((p) => p && !p.includes("/") && p.endsWith(".md")))
check(`a note at the vault's top (${file})`, !!file)

// ---- renaming a row: its name, not the rows
await page.click(`${L} [data-tree-path="${file}"] [data-keyrow]`, { button: "right" })
await page.getByRole("menuitem", { name: "Rename" }).first().click()
await page.waitForSelector(`${L} input[aria-label="New name"]`)
await page.keyboard.type("Renamed draft")
await page.keyboard.press("ControlOrMeta+a")
const field = await page.evaluate(() => { const f = document.activeElement; return [f.selectionStart, f.selectionEnd, f.value.length] })
check("renaming: ⌘A selects the name typed", field[0] === 0 && field[1] === field[2] && field[2] > 0, field)
// (the page's selection reads a focused field's: more than the name is the page's)
check("...not the tree's rows, nor the page", !(await page.locator(`${L} [data-selected]`).count()) && (await selected()) === "Renamed draft", await selected())
await page.keyboard.press("Escape"); await wait(200)

// ---- the sidebar, clicked off its rows: nothing
const box = await page.locator(L).boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12); await wait(100)
await page.keyboard.press("ControlOrMeta+a"); await wait(100)
check("the sidebar: ⌘A selects nothing", (await selected()) === "", (await selected()).slice(0, 200))

// ---- a note in reading view: its text
await page.goto(`${B}#file/${encodeURIComponent(file)}`)
await page.waitForSelector("[data-pane] .cm-content")
await palette(page, "Switch to reading view")
await until(() => page.evaluate(() => document.querySelector("[data-pane] .cm-content")?.getAttribute("contenteditable") === "false"))
await page.locator("[data-pane] .cm-content .cm-line").first().click(); await wait(100)
await page.keyboard.press("ControlOrMeta+a"); await wait(100)
const got = await selected()
const inNote = await page.evaluate(() => getSelection().rangeCount > 0 && document.querySelector("[data-pane] .cm-content").contains(getSelection().getRangeAt(0).commonAncestorContainer))
check("reading view: ⌘A selects the note's text", got.trim().length > 0 && inNote, got.slice(0, 200))
check("...and nothing of the sidebars or tab bar", !(await page.evaluate(() => {
  const r = getSelection().rangeCount ? getSelection().getRangeAt(0) : null
  return !!r && [...document.querySelectorAll("[data-sidebar-body], [role=tablist]")].some((el) => r.intersectsNode(el))
})))
await page.screenshot({ path: `${OUT}selectall-reading.png` })
await done()
