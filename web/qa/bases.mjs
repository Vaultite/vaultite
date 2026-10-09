// Obsidian Bases (plugins/core/query: BaseView.tsx, bases.ts, expr.ts): a "Qa bases" folder of made-up books and
// places and a .base with formulas, display names, summaries and four views (a table, cards, a kanban, a map, plus a
// layout this app doesn't draw). The .base opens as its views (tabs; a formula's values, the summary row, the note for
// the unknown layout), the … menu changes the file as small edits (a view's layout, a new view, a view deleted and
// Undo: comments and unknown keys stay), a card dragged on the kanban writes its note, the map draws a pin per place.
// A note with a ```base fence and `![[Qa.base#Board]]` draws both (the embed on its view), and a ```block-query with a
// formula and summaries. At 390px nothing scrolls sideways. Screenshots in the scratch folder given as the third
// argument (or /tmp/vaultite-bases/), light and dark, desktop and phone.
// WRITES a "Qa bases" folder (removed after): throwaway server only.
//   node web/qa/bases.mjs <base url> <vault path> [screenshots dir]
import { mkdirSync, readFileSync } from "node:fs"
import { qa, until } from "./lib/qa.mjs"
const { args: [B, VAULT, SHOTS_DIR = "/tmp/vaultite-bases"], browser, check, watch, done } = await qa(import.meta.url)
const OUT = SHOTS_DIR.replace(/\/?$/, "/")
mkdirSync(OUT, { recursive: true })
const api = (method, p, body) => fetch(`${B}api/${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
const put = async (path, text) => { const r = await api("POST", "file", { path, text }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`) }
const read = (p) => readFileSync(`${VAULT}/${p}`, "utf8")

const F = "Qa bases"
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
await put(`${F}/Books/Lighthouse keeper.md`, "---\ntype: qa-book\nstatus: reading\npages: 300\nread: 120\nprice: 12.5\n---\n")
await put(`${F}/Books/Harbour lights.md`, "---\ntype: qa-book\nstatus: want\npages: 200\nread: 0\nprice: 8\n---\n")
await put(`${F}/Books/Tide tables.md`, "---\ntype: qa-book   # keep this\nstatus: done\npages: 100\nread: 100\nprice: 20\n---\n")
await put(`${F}/Places/North pier.md`, "---\ntype: qa-place\ncoordinates: [38.70, -9.14]\ncolor: green\n---\n")
await put(`${F}/Places/Old lighthouse.md`, "---\ntype: qa-place\ncoordinates: \"51.5, -0.12\"\n---\n")
await put(`${F}/Places/Somewhere.md`, "---\ntype: qa-place\n---\n")
const BASE = `# Made-up books, for QA
filters:
  or:
    - file.inFolder("${F}/Books")
    - file.inFolder("${F}/Places")
formulas:
  left: pages - read
  cost: if(price, "$" + price.toFixed(2), "")
properties:
  formula.left:
    displayName: Pages left
views:
  - type: table
    name: Books
    filters: 'type == "qa-book"'
    order: [file.name, status, formula.left, formula.cost]
    sort:
      - property: formula.left
        direction: DESC
    summaries:
      formula.left: Sum
      pages: Average
    rowHeight: medium
  - type: cards
    name: Shelf
    filters: 'type == "qa-book"'
    order: [file.name, status]
  - type: kanban
    name: Board
    filters: 'type == "qa-book"'
    groupBy:
      property: note.status
    order: [file.name, formula.left]
  - type: map
    name: Places
    filters: file.inFolder("${F}/Places")
    coordinates: note.coordinates
    markerColor: note.color
  - type: gallery
    name: Gallery
`
await put(`${F}/Qa.base`, BASE)
await put(`${F}/Demo.md`, "---\ntype: note\n---\n\nInline:\n\n```base\nfilters: file.inFolder(\"" + F + "/Places\")\nviews:\n  - type: table\n    name: Qa inline\n    order: [file.name, coordinates]\n```\n\n"
  + `![[Qa.base#Board]]\n\n` + "```block-query\ntitle: Qa query\ntype: qa-book\nformulas:\n  left: pages - read\ncolumns: [file, pages, formula.left]\nsummaries:\n  pages: Sum\n  formula.left: Max\n```\n")
const url = (p) => `${B}#file/${encodeURIComponent(p)}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = watch(await ctx.newPage())

// The .base in its tab.
await page.goto(url(`${F}/Qa.base`)); await page.waitForTimeout(2500)
// The file's own view, in its pane (a hover preview of a note embedding it, from the Links panel, has another).
const base = page.locator(`[data-pane] [data-base="${F}/Qa.base"]`)
const tabs = () => base.locator("[data-base-view]").evaluateAll((els) => els.map((e) => e.dataset.baseView))
check("the views are tabs", JSON.stringify(await tabs()) === JSON.stringify(["Books", "Shelf", "Board", "Places", "Gallery"]), await tabs())
const rows = () => base.locator("[data-query-row]").evaluateAll((els) => els.map((e) => e.dataset.queryRow.split("/").pop().replace(".md", "")))
check("the first view: its filter, sorted by a formula (desc)", JSON.stringify(await rows()) === JSON.stringify(["Harbour lights", "Lighthouse keeper", "Tide tables"]), await rows())
const heads = await base.locator("thead th").allInnerTexts()
check("columns: display names, formulas", JSON.stringify(heads.map((h) => h.trim())) === JSON.stringify(["Name", "Status", "Pages left", "Cost"]), heads)
const first = await base.locator("[data-query-row] td").evaluateAll((els) => els.slice(0, 4).map((e) => e.innerText.trim()))
check("a formula's values", JSON.stringify(first) === JSON.stringify(["Harbour lights", "want", "200", "$8.00"]), first)
const sums = (await base.locator('[data-query-summaries="all"]').innerText()).replace(/\s+/g, " ").trim()
check("the summary row", sums === "Sum 380", sums)
check("the count", (await base.locator("[data-base-count]").innerText()) === "3 files", await base.locator("[data-base-count]").innerText())
await page.screenshot({ path: `${OUT}base-desktop.png` })
await base.locator('[data-base-view="Shelf"]').click(); await page.waitForTimeout(1200)
check("a tab switches the view (cards)", (await base.locator("[data-query=cards] button[data-query-row]").count()) === 3)
await base.locator('[data-base-view="Gallery"]').click(); await page.waitForTimeout(1200)
check("a layout this app doesn't draw: a table, and a note saying so", (await base.locator("[data-query-notes]").innerText()).includes("draws gallery views as a table")
  && (await base.locator("table").count()) === 1, await base.locator("[data-query-notes]").innerText())

// Kanban: drag a card to another column; its note's one line changes.
await base.locator('[data-base-view="Board"]').click(); await page.waitForTimeout(1200)
const cols = () => base.locator("[data-board-col]").evaluateAll((els) => els.map((e) => [e.dataset.boardCol, [...e.querySelectorAll("[data-query-row]")].map((r) => r.dataset.queryRow.split("/").pop().replace(".md", ""))]))
check("kanban: a column per status", JSON.stringify((await cols()).map((c) => c[0])) === JSON.stringify(["done", "reading", "want", ""]), await cols())
const dragTo = async (from, to) => {
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + 20, a.y + 10); await page.mouse.down()
  await page.mouse.move(a.x + 40, a.y + 20, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 8 })
  await page.waitForTimeout(100)
  await page.mouse.up()
}
await dragTo(base.locator(`[data-query-row="${F}/Books/Tide tables.md"]`), base.locator('[data-board-col="want"]'))
await page.waitForTimeout(1500)
const tide = read(`${F}/Books/Tide tables.md`)
check("kanban: the move writes that one key (groupBy note.status: status)", tide === "---\ntype: qa-book   # keep this\nstatus: want\npages: 100\nread: 100\nprice: 20\n---\n", tide)
await page.screenshot({ path: `${OUT}base-board-desktop.png` })

// Map.
await base.locator('[data-base-view="Places"]').click()
await until(async () => (await base.locator(".nm-pin").count()) === 2, 15000)
const pins = await base.locator(".nm-pin").count()
check("map: a pin per place with coordinates (a list, or text)", pins === 2, pins)
check("map: the one without is listed under it", (await base.locator("[data-query-unplaced]").innerText()).includes("Somewhere"))
const green = await base.locator(`.nm-pin[data-pin="${F}/Places/North pier.md"] .nm-dot`).evaluate((e) => e.style.getPropertyValue("--c"))
check("map: markerColor (an app colour's name: its token)", green === "var(--green)", green)
await page.screenshot({ path: `${OUT}base-map-desktop.png` })

// The … menu: small edits to the file (its comment and the key this app doesn't know stay).
await base.locator('[data-base-view="Books"]').click(); await page.waitForTimeout(800)
await base.locator("[data-base-menu]").click(); await page.waitForTimeout(200)
await page.getByText("Layout", { exact: true }).hover(); await page.waitForTimeout(300)
await page.getByText("List", { exact: true }).click(); await page.waitForTimeout(1500)
let text = read(`${F}/Qa.base`)
check("layout: the view's type changes, nothing else", text === BASE.replace("  - type: table\n    name: Books", "  - type: list\n    name: Books"), text)
await base.locator("[data-base-menu]").click(); await page.waitForTimeout(200)
await page.getByText("New view", { exact: true }).click(); await page.waitForTimeout(1500)
text = read(`${F}/Qa.base`)
check("new view: added at the end (a table with the view's columns), its tab picked", text.includes("  - type: table\n    name: Table\n    filters: type == \"qa-book\"\n    order:")
  && text.startsWith("# Made-up books, for QA\n") && (await tabs()).at(-1) === "Table"
  && (await base.locator('[data-base-view="Table"]').getAttribute("aria-selected")) === "true", [text, await tabs()])
await base.locator("[data-base-menu]").click(); await page.waitForTimeout(200)
await page.getByText("Delete view", { exact: true }).click(); await page.waitForTimeout(1500)
check("delete view: gone from the file", !read(`${F}/Qa.base`).includes("name: Table\n"), read(`${F}/Qa.base`))
await page.getByRole("button", { name: "Undo" }).click(); await page.waitForTimeout(1500)
check("delete view: Undo brings it back", read(`${F}/Qa.base`).includes("name: Table\n"))
await page.screenshot({ path: `${OUT}base-edited-desktop.png` })

// A note: the fence, the embed (on its view), a query's formula and summaries.
await page.goto(url(`${F}/Demo.md`)); await page.waitForTimeout(3000)
const fence = page.locator("section.glass", { has: page.locator("h2", { hasText: "Qa inline" }) }).first()
check("a ```base fence draws its view", await fence.isVisible() && (await fence.locator("[data-query-row]").count()) === 3, await fence.innerText().catch(() => ""))
const embed = page.locator(`[data-format-embed="${F}/Qa.base"]`)
check("![[Qa.base#Board]] shows that view", (await embed.locator('[data-base-view="Board"]').getAttribute("aria-selected")) === "true"
  && (await embed.locator("[data-query-board]").count()) === 1)
const q = page.locator("section.glass", { has: page.locator("h2", { hasText: "Qa query" }) }).first()
const qs = (await q.locator('[data-query-summaries="all"]').innerText()).replace(/\s+/g, " ").trim()
check("block-query: a formula column and summaries", qs === "Sum 600 Max 200", qs)
await page.screenshot({ path: `${OUT}base-note-desktop.png`, fullPage: true })
await page.emulateMedia({ colorScheme: "dark" })
await page.evaluate(() => document.documentElement.classList.add("dark")); await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}base-note-desktop-dark.png`, fullPage: true })
await page.goto(url(`${F}/Qa.base`)); await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}base-desktop-dark.png` })

// Every row (no cap): 700 notes, drawn as they come near the screen, every one reached by scrolling.
await Promise.all(Array.from({ length: 700 }, (_, i) => put(`${F}/Many/Row ${String(i + 1).padStart(3, "0")}.md`, `---\ntype: qa-row\nn: ${i + 1}\n---\n`)))
await put(`${F}/Many.base`, `filters: file.inFolder("${F}/Many")\nviews:\n  - type: table\n    name: All\n    order: [file.name, n]\n    summaries:\n      n: Sum\n`)
await page.goto(url(`${F}/Many.base`)); await page.waitForTimeout(2500)
const many = page.locator(`[data-pane] [data-base="${F}/Many.base"]`)
const drawn = () => many.locator("[data-query-row]").count()
const firstDrawn = await drawn()
check("every row: the count says all of them; only the first are drawn at once", (await many.locator("[data-base-count]").innerText()) === "700 files" && firstDrawn > 0 && firstDrawn < 700, firstDrawn)
await until(async () => { await many.locator("[data-base-body]").evaluate((e) => { e.scrollTop = e.scrollHeight }); return (await drawn()) === 700 }, 15000, 300).catch(() => {})
const sum = (await many.locator('[data-query-summaries="all"]').innerText().catch(() => "")).replace(/\s+/g, " ").trim()
check("every row: scrolling down reaches the last, the summary under all of them", (await drawn()) === 700 && (await many.locator(`[data-query-row="${F}/Many/Row 700.md"]`).count()) === 1 && /^Sum 245.?350$/.test(sum), [await drawn(), sum])

// Phone.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const m = watch(await phone.newPage(), { label: "phone" })
for (const p of [`${F}/Qa.base`, `${F}/Demo.md`]) {
  await m.goto(url(p)); await m.waitForTimeout(2500)
  const w = await m.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }))
  check(`390px: ${p} doesn't scroll sideways`, w.doc <= 390 && w.win === 390, w)
  await m.screenshot({ path: `${OUT}base-phone-${p.split("/").pop().replace(/\W+/g, "-")}.png`, fullPage: true })
}

await browser.close()
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
await done()
