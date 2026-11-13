// A .csv drawn as a table (plugins/core/tables): a cell edited in place rewrites only that field (its quotes and
// separator kept), Enter and Tab go on, Escape cancels, Add row. WRITES "Qa csvtables/": throwaway only.
//   node web/qa/csvtables.mjs <base url> [out dir]
import { SHOTS, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const CSV = "Qa csvtables/Readings.csv"
const put = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${encodeURIComponent(path)}`)).json()).text
const saved = (fn) => until(fn, 10000).catch(() => false)
await fetch(`${B}api/file?path=${encodeURIComponent("Qa csvtables")}`, { method: "DELETE" })
await put(CSV, 'name;pages;note\nLighthouse keeper;300;"long; slow"\nTide tables;100;short\n')

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage()), ui = app(page)
await page.goto(`${B}#file/${encodeURIComponent(CSV)}`)
const view = page.locator("[data-pane] .csv-view").first()
await view.waitFor({ timeout: 15000 }); await ui.idle()
const cell = (row, c) => view.locator(`[data-csv-row="${row}"] td`).nth(c)
await cell(2, 1).dblclick(); await ui.idle()
check("a double-click edits the cell, its text selected", await view.locator("[data-csv-input]").count() === 1
  && await page.evaluate(() => { const t = document.activeElement; return t?.selectionStart === 0 && t?.selectionEnd === t?.value.length }))
await page.keyboard.type("120"); await page.screenshot({ path: `${OUT}/csvtables-edit.png` }); await page.keyboard.press("Enter")
check("Enter writes only that field (its ; and quotes kept) and edits the cell under it", await saved(async () => (await read(CSV)) === 'name;pages;note\nLighthouse keeper;300;"long; slow"\nTide tables;120;short\n'), await read(CSV))
await page.keyboard.press("Escape"); await ui.idle()
await cell(1, 2).dblclick(); await ui.idle()
await page.keyboard.type("long; slower"); await page.keyboard.press("Tab"); await ui.idle()
check("a quoted field stays quoted; Tab goes to the next row's first cell", await saved(async () => (await read(CSV)).includes('Lighthouse keeper;300;"long; slower"\n'))
  && await page.evaluate(() => document.activeElement?.value) === "Tide tables", await read(CSV))
await page.keyboard.type("Nope"); await page.keyboard.press("Escape"); await ui.idle()
check("Escape cancels", !(await read(CSV)).includes("Nope") && await view.locator("[data-csv-input]").count() === 0)
// (after Enter, the next cell edited and left by a click elsewhere is saved too)
await cell(1, 0).dblclick(); await ui.idle()
await page.keyboard.type("Lighthouse keeper"); await page.keyboard.press("Enter"); await ui.idle()
await page.keyboard.type("Tide charts"); await page.locator("h1, [data-pane]").first().click({ position: { x: 5, y: 5 } }); await ui.idle()
check("a cell left by a click after an Enter is saved", await saved(async () => (await read(CSV)).includes("Tide charts;120;short")), await read(CSV))
await view.locator("[data-csv-add-row]").click(); await ui.idle()
await page.keyboard.type("Harbour lights"); await page.keyboard.press("Tab"); await page.keyboard.type("80"); await page.keyboard.press("Enter")
check("Add row: a record at the end, edited from its first cell", await saved(async () => (await read(CSV)).endsWith("Tide charts;120;short\nHarbour lights;80;\n")), await read(CSV))
// (one column: its new record is a blank line, shown and edited all the same)
const ONE = "Qa csvtables/One.csv"
await put(ONE, "name\nAlice Park\n")
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(ONE)}`)
await view.waitFor({ timeout: 15000 }); await ui.idle()
await view.locator("[data-csv-add-row]").click(); await ui.idle()
await page.keyboard.type("Sam"); await page.keyboard.press("Enter")
check("one column: Add row shows the new row to type in", await saved(async () => (await read(ONE)) === "name\nAlice Park\nSam\n"), await read(ONE))
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(CSV)}`); await view.waitFor({ timeout: 15000 })
await page.emulateMedia({ colorScheme: "dark" }); await ui.idle()
await page.screenshot({ path: `${OUT}/csvtables-dark.png` })
await fetch(`${B}api/file?path=${encodeURIComponent("Qa csvtables")}`, { method: "DELETE" })
await done()
