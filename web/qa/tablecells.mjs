// A table in live preview, edited cell by cell (editor/tables.ts): a click opens a cell, a click on another moves to it
// with the table still drawn (not its Markdown), its columns staying put while it's edited, even with Markdown wider
// than its text; leaving it lets them settle, the typing in the file. WRITES a "Qa tablecells" folder: throwaway only.
//   node web/qa/tablecells.mjs <base url> [out dir]
import { SHOTS, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const NOTE = "Qa tablecells/Cells.md"
const put = (path, text) => fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
await fetch(`${B}api/file?path=${encodeURIComponent(NOTE)}`, { method: "DELETE" })
await put(NOTE, "Top line\n\n| Where | Free | Note |\n|---|---|---|\n| Laptop | 122G | Up from **32G** on [[Lighthouse]] |\n| Desktop | 95G | `short` |\n\nBottom line\n")

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const ed = page.locator(".vau-editor")
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(1500)
if (!(await ed.locator(".cm-block-table").count())) { await palette(page, "Switch to live preview", 700); await wait(800) }
const table = ed.locator(".cm-block-table table")
const cell = (r, c) => table.locator("tr").nth(r).locator("th, td").nth(c)
// (clicked at its edge: its middle may be a link, which is followed)
const click = (r, c) => cell(r, c).click({ position: { x: 3, y: 3 } })
const widths = () => table.evaluate((t) => [...t.rows[0].cells].map((c) => Math.round(c.getBoundingClientRect().width)))
const drawn = async () => (await ed.locator(".cm-block-table").count()) === 1 && !(await ed.locator(".cm-line", { hasText: "| Where |" }).count())

const before = await widths()
await click(2, 1); await wait(300)
check("a click opens the cell", await ed.locator(".cm-cell-input").count() === 1 && await drawn())
await click(1, 2); await wait(300)
check("a click on another cell moves to it, the table still drawn", await ed.locator(".cm-cell-input").count() === 1 && await drawn())
check(`its Markdown, wider than its text, moves no column (${before} → ${await widths()})`, JSON.stringify(await widths()) === JSON.stringify(before))
await page.keyboard.press("End"); await page.keyboard.type(" and more text to wrap")
check(`typing wraps in the cell, the columns stay (${await widths()})`, JSON.stringify(await widths()) === JSON.stringify(before))
await click(1, 0); await wait(300)
check("and moves on, still drawn", await ed.locator(".cm-cell-input").count() === 1 && await drawn())
await page.screenshot({ path: `${OUT}/tablecells-editing.png` })
await ed.locator(".cm-line", { hasText: "Bottom line" }).click(); await wait(400)
check("leaving it closes the cell", !(await ed.locator(".cm-cell-input").count()) && await drawn())
check("its columns settle once it's left", await table.evaluate((t) => t.style.tableLayout === ""))
const text = async () => (await (await fetch(`${B}api/file?path=${encodeURIComponent(NOTE)}`)).json()).text
const saved = await until(async () => (await text()).includes("[[Lighthouse]] and more text to wrap |\n"))
check(`the typing is in the file (${JSON.stringify(saved || await text())})`, saved)
await done()
