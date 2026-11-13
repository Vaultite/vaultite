// Obsidian Bases (plugins/core/query) on made-up books and places: a .base's views, small edits, kanban and map, and
// ```base fences and embeds. WRITES a "Qa bases" folder (removed after): throwaway server only.
//   node web/qa/bases.mjs <base url> <vault path> [screenshots dir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fingers, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, VAULT, SHOTS_DIR = "/tmp/vaultite-bases"], browser, check, watch, done } = await qa(import.meta.url)
const OUT = SHOTS_DIR.replace(/\/?$/, "/")
mkdirSync(OUT, { recursive: true })
const api = (method, p, body) => fetch(`${B}api/${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
const put = async (path, text) => { const r = await api("POST", "file", { path, text }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`) }
const read = (p) => readFileSync(`${VAULT}/${p}`, "utf8")

const F = "Qa bases"
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
await put(`${F}/Books/Lighthouse keeper.md`, "---\ntype: qa-book\nstatus: reading\npages: 300\nread: 120\nprice: 12.5\ncover: \"[[cover.svg]]\"\n---\n")
await put(`${F}/Books/Harbour lights.md`, "---\ntype: qa-book\nstatus: want\npages: 200\nread: 0\nprice: 8\ncover: \"#336699\"\n---\n")
await fetch(`${B}api/upload?path=${encodeURIComponent(`${F}/cover.svg`)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" },
  body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#d4a017"/></svg>') })
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
    image: note.cover
    cardSize: 180
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
  + `![[Qa.base#Board]]\n\n` + "```base\nfilters: 'type == \"qa-book\"'\nformulas:\n  left: pages - read\nviews:\n  - type: table\n    name: Qa query\n    order: [file.name, pages, formula.left]\n    summaries:\n      pages: Sum\n      formula.left: Max\n```\n")
const url = (p) => `${B}#file/${encodeURIComponent(p)}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = watch(await ctx.newPage()), ui = app(page)

// The .base in its tab.
await page.goto(url(`${F}/Qa.base`)); await page.locator("[data-pane] [data-base]").first().waitFor(); await ui.idle()
// The file's own view, in its pane (a hover preview of a note embedding it, from the Links panel, has another).
const base = page.locator(`[data-pane] [data-base="${F}/Qa.base"]`)
const tabs = () => base.locator("[data-base-view]").evaluateAll((els) => els.map((e) => e.dataset.baseView))
check("the views are tabs", JSON.stringify(await tabs()) === JSON.stringify(["Books", "Shelf", "Board", "Places", "Gallery"]), await tabs())
const rows = () => base.locator("[data-query-row]").evaluateAll((els) => els.map((e) => e.dataset.queryRow.split("/").pop().replace(".md", "")))
await until(async () => (await rows()).length === 3, 15000).catch(() => {})
check("the first view: its filter, sorted by a formula (desc)", JSON.stringify(await rows()) === JSON.stringify(["Harbour lights", "Lighthouse keeper", "Tide tables"]), await rows())
const heads = await base.locator("thead th").allInnerTexts()
check("columns: display names, formulas", JSON.stringify(heads.map((h) => h.trim())) === JSON.stringify(["Name", "Status", "Pages left", "Cost"]), heads)
const first = await base.locator("[data-query-row] td").evaluateAll((els) => els.slice(0, 4).map((e) => e.innerText.trim()))
check("a formula's values", JSON.stringify(first) === JSON.stringify(["Harbour lights", "want", "200", "$8.00"]), first)
const sums = (await base.locator('[data-query-summaries="all"]').innerText()).replace(/\s+/g, " ").trim()
check("the summary row", sums === "Sum 380", sums)
check("the count", (await base.locator("[data-base-count]").innerText()) === "3 files", await base.locator("[data-base-count]").innerText())
await page.screenshot({ path: `${OUT}base-desktop.png` })
await base.locator('[data-base-view="Shelf"]').click(); await ui.idle()
check("a tab switches the view (cards)", (await base.locator("[data-query=cards] button[data-query-row]").count()) === 3)
const pics = await base.locator("[data-query-card-image]").evaluateAll((els) => els.map((e) => e.querySelector("img")?.naturalWidth > 0 ? "img" : e.style.background ? "color" : "none"))
check("cards: each one's picture, a vault image or a colour, at the view's size", pics.includes("img") && pics.includes("color") && pics.length === 3
  && (await base.locator("[data-query-cards]").evaluate((g) => g.style.gridTemplateColumns.includes("180px"))), pics)
await page.screenshot({ path: `${OUT}base-cards-desktop.png` })
await base.locator('[data-base-view="Gallery"]').click(); await ui.idle()
check("a layout this app doesn't draw: a table, and a note saying so", (await base.locator("[data-query-notes]").innerText()).includes("draws gallery views as a table")
  && (await base.locator("table").count()) === 1, await base.locator("[data-query-notes]").innerText())
// A plugin's layout of that type (an Obsidian plugin's Bases view, through plugin-compat) draws it instead, with its
// rows, and is in the Layout menu; gone again, the table is back.
const off = await page.evaluateHandle(() => globalThis.__vaultite.modules["@vaultite"].registerBaseLayout({ type: "gallery", name: "Qa gallery",
  mount: (el, ctx) => { const draw = (c) => { el.textContent = `${c.name}: ${c.rows.groups.flatMap((g) => g.rows.map((r) => r.title)).sort().join(", ")}` }; draw(ctx); return { update: draw } } }))
const byPlugin = base.locator('[data-base-plugin-layout="gallery"]')
await until(async () => (await byPlugin.count()) === 1, 10000).catch(() => {})
const said = (await byPlugin.count()) ? await byPlugin.innerText() : ""
check("a plugin's layout draws its view with the rows", said.startsWith("Gallery: ") && said.includes("Lighthouse keeper") && said.includes("North pier") && (await base.locator("table").count()) === 0, said)
await ui.menu.open(base.locator("[data-base-menu]"))
await ui.menu.top().getByText("Layout", { exact: true }).hover(); await page.locator("[role=menu]").nth(1).waitFor(); await ui.idle()
const offered = await page.locator("[role=menu]").getByText("Qa gallery", { exact: true }).count()
await page.keyboard.press("Escape"); await page.keyboard.press("Escape")
check("the Layout menu offers it", offered === 1, offered)
await page.evaluate((f) => f(), off)
await until(async () => (await base.locator("table").count()) === 1, 10000).catch(() => {})
check("unregistered, the view is a table again", (await byPlugin.count()) === 0 && (await base.locator("table").count()) === 1)

// Kanban: drag a card to another column; its note's one line changes.
await base.locator('[data-base-view="Board"]').click(); await ui.idle()
const cols = () => base.locator("[data-board-col]").evaluateAll((els) => els.map((e) => [e.dataset.boardCol, [...e.querySelectorAll("[data-query-row]")].map((r) => r.dataset.queryRow.split("/").pop().replace(".md", ""))]))
await until(async () => (await cols()).length > 0, 15000).catch(() => {})
check("kanban: a column per status", JSON.stringify((await cols()).map((c) => c[0])) === JSON.stringify(["done", "reading", "want", ""]), await cols())
const dragTo = async (from, to) => {
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + 20, a.y + 10); await page.mouse.down()
  await page.mouse.move(a.x + 40, a.y + 20, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 8 })
  await ui.idle()
  await page.mouse.up()
}
await ui.sees(`${F}/Books/Tide tables.md`, () => dragTo(base.locator(`[data-query-row="${F}/Books/Tide tables.md"]`), base.locator('[data-board-col="want"]')))
const tide = read(`${F}/Books/Tide tables.md`)
check("kanban: the move writes that one key (groupBy note.status: status)", tide === "---\ntype: qa-book   # keep this\nstatus: want\npages: 100\nread: 100\nprice: 20\n---\n", tide)
await page.screenshot({ path: `${OUT}base-board-desktop.png` })
// A column's +: a new file in it (its status) and in the view (its filter's type), opened in a tab of its own.
await base.locator('[data-board-add="reading"]').click()
const fresh = await until(async () => { const h = decodeURIComponent(await page.evaluate(() => location.hash)); return /Untitled[^/]*\.md$/.test(h) && h.replace(/^#file\//, "") }, 8000).catch(() => null)
let card = ""; try { card = fresh ? read(fresh) : "" } catch {}
check("kanban: a column's + makes a file with its value, opened", !!fresh && card.includes("status: reading") && card.includes("type: qa-book"), [fresh, card])
if (fresh) await api("DELETE", `file?path=${encodeURIComponent(fresh)}`)
await page.goto("about:blank"); await page.goto(url(`${F}/Qa.base`)); await base.waitFor(); await ui.idle()

// Map.
await base.locator('[data-base-view="Places"]').click()
await until(async () => (await base.locator(".nm-pin").count()) === 2, 15000)
const pins = await base.locator(".nm-pin").count()
check("map: a pin per place with coordinates (a list, or text)", pins === 2, pins)
check("map: the one without is listed under it", (await base.locator("[data-query-unplaced]").innerText()).includes("Somewhere"))
const green = await base.locator(`.nm-pin[data-pin="${F}/Places/North pier.md"] .nm-dot`).evaluate((e) => e.style.getPropertyValue("--c"))
check("map: markerColor (an app colour's name: its token)", green === "var(--green)", green)
await page.screenshot({ path: `${OUT}base-map-desktop.png` })

// The table's header and toolbar: each change a small edit to the view in the file, the rows following.
await base.locator('[data-base-view="Books"]').click()
await until(async () => (await base.locator("thead th").count()) === 4, 15000).catch(() => {})
const menuItem = (name) => page.locator("[role=menu]").getByText(name, { exact: true })
const viewText = (t) => t.slice(t.indexOf("name: Books"), t.indexOf("  - type: cards"))
const waitFile = (p, fn) => until(() => fn(read(p)), 8000).catch(() => {})
await base.locator('[data-query-sort="status"]').click(); await menuItem("Sort ascending").click()
await waitFile(`${F}/Qa.base`, (t) => t.includes("property: status"))
let edited = read(`${F}/Qa.base`)
check("header: Sort ascending writes the view's sort, Obsidian's way", edited === BASE.replace("      - property: formula.left\n        direction: DESC", "      - property: status\n        direction: ASC"), viewText(edited))
const byStatus = ["Harbour lights", "Lighthouse keeper", "Tide tables"].map((n) => [/status: (\w+)/.exec(read(`${F}/Books/${n}.md`))[1], n]).sort((a, b) => a[0].localeCompare(b[0])).map((x) => x[1])
await until(async () => JSON.stringify(await rows()) === JSON.stringify(byStatus), 8000).catch(() => {})
check("header: the rows follow", JSON.stringify(await rows()) === JSON.stringify(byStatus), [await rows(), byStatus])
check("header: its arrow shows", (await base.locator('[data-query-sort="status"] svg').count()) === 1)
// Drag a header: the columns' order.
const hb = await base.locator('th[data-query-col="formula.left"]').boundingBox(), sb = await base.locator('th[data-query-col="status"]').boundingBox()
await page.mouse.move(hb.x + 20, hb.y + hb.height / 2); await page.mouse.down()
await page.mouse.move(hb.x + 10, hb.y + hb.height / 2, { steps: 3 }); await page.mouse.move(sb.x + 8, sb.y + sb.height / 2, { steps: 8 })
await ui.idle(); await page.mouse.up()
await waitFile(`${F}/Qa.base`, (t) => t.includes("order: [file.name, formula.left, status"))
check("header: dragged before another, the order changes (flow style kept)", viewText(read(`${F}/Qa.base`)).includes("order: [file.name, formula.left, status, formula.cost]"), viewText(read(`${F}/Qa.base`)))
await until(async () => (await base.locator("thead th").allInnerTexts()).map((h) => h.trim()).join() === "Name,Pages left,Status,Cost", 5000).catch(() => {})
check("header: drawn in the new order", (await base.locator("thead th").allInnerTexts()).map((h) => h.trim()).join() === "Name,Pages left,Status,Cost", await base.locator("thead th").allInnerTexts())
// Resize: the right edge, as columnSize.
const edge = await base.locator('[data-query-resize="status"]').boundingBox()
const before = (await base.locator('th[data-query-col="status"]').boundingBox()).width
await page.mouse.move(edge.x + 3, edge.y + edge.height / 2); await page.mouse.down()
await page.mouse.move(edge.x + 63, edge.y + edge.height / 2, { steps: 6 }); await page.mouse.up()
await waitFile(`${F}/Qa.base`, (t) => t.includes("columnSize"))
const size = Number(/columnSize:\n {6}status: (\d+)/.exec(read(`${F}/Qa.base`))?.[1])
const after = (await base.locator('th[data-query-col="status"]').boundingBox()).width
check("resize: columnSize written once, the column that wide", Math.abs(size - (before + 60)) <= 2 && Math.abs(after - size) <= 2, [before, size, after, viewText(read(`${F}/Qa.base`))])
// Rename and hide from the header's menu.
await base.locator('[data-query-sort="status"]').click(); await menuItem("Rename").click()
await base.locator('[data-query-rename="status"]').fill("State"); await base.locator('[data-query-rename="status"]').press("Enter")
await waitFile(`${F}/Qa.base`, (t) => t.includes("displayName: State"))
check("rename: a display name in properties, the header says it", read(`${F}/Qa.base`).includes("properties:\n  formula.left:\n    displayName: Pages left\n  status:\n    displayName: State\n")
  && (await base.locator('[data-query-sort="status"]').innerText()).trim() === "State", read(`${F}/Qa.base`).slice(0, 400))
await base.locator('[data-query-sort="status"]').click(); await menuItem("Rename").click()
await base.locator('[data-query-rename="status"]').fill("Nope"); await base.locator('[data-query-rename="status"]').press("Escape"); await ui.idle()
check("rename: Escape cancels it", (await base.locator('[data-query-rename="status"]').count()) === 0 && !read(`${F}/Qa.base`).includes("Nope")
  && (await base.locator('[data-query-sort="status"]').innerText()).trim() === "State")
await base.locator('[data-query-sort="formula.cost"]').click(); await menuItem("Hide property").click()
await waitFile(`${F}/Qa.base`, (t) => t.includes("order: [file.name, formula.left, status] "))
check("hide: out of the order, the column gone", viewText(read(`${F}/Qa.base`)).includes("order: [file.name, formula.left, status]") && (await base.locator('th[data-query-col="formula.cost"]').count()) === 0)
// Sort menu: a second key from the palette, then the first removed.
await base.locator('[data-base-button="Sort"]').click()
await page.locator("[data-base-add-sort]").click()
await page.locator("[data-overlay] input[role=combobox]").fill("File name"); await page.keyboard.press("Enter")
await waitFile(`${F}/Qa.base`, (t) => t.includes("property: file.name"))
check("sort menu: a sort added after the first", viewText(read(`${F}/Qa.base`)).includes("sort:\n      - property: status\n        direction: ASC\n      - property: file.name\n        direction: ASC\n"), viewText(read(`${F}/Qa.base`)))
await page.locator('[data-base-sort-key="status"] button[aria-label^="Remove sort"]').click()
await waitFile(`${F}/Qa.base`, (t) => !t.includes("property: status"))
check("sort menu: a sort removed", viewText(read(`${F}/Qa.base`)).includes("sort:\n      - property: file.name\n        direction: ASC\n"), viewText(read(`${F}/Qa.base`)))
await page.screenshot({ path: `${OUT}base-sort-menu-desktop.png` })
await page.keyboard.press("Escape")
// Filter menu: the base's or-group shown as Any, a view's condition added (property, operator, value).
await base.locator('[data-base-button="Filter"]').click()
const pop = page.locator('[data-base-pop="Filter"]')
check("filter menu: the base's filters, an or as Any, its conditions read", (await pop.locator('[data-base-filters-of="all"] [data-base-kind]').first().innerText()) === "Any of the following are true"
  && (await pop.locator('[data-base-filters-of="all"] [data-base-cond-op="inFolder"]').count()) === 2
  && (await pop.locator('[data-base-filters-of="view"] [data-base-cond-prop="type"]').count()) === 1, await pop.innerText())
await pop.locator('[data-base-filters-of="view"] [data-base-add-filter]').click()
const added = pop.locator('[data-base-filters-of="view"] [data-base-cond]').last()
await added.locator("[data-base-cond-prop]").click()
await page.locator("[data-overlay] input[role=combobox]").fill("pages"); await ui.idle()
const picked = () => page.locator("[data-overlay] [role=option][aria-selected=true]").innerText()
check("palette: typing selects the best match, not the row at the current one's place", (await picked()).startsWith("Pages\n"), await picked())
const second = await page.locator("[data-overlay] [role=option]").nth(1).boundingBox()
await page.mouse.move(second.x + 30, second.y + 10, { steps: 3 })
check("palette: a pointer moved over a row selects it", (await picked()).startsWith("Pages left"), await picked())
await page.keyboard.press("ArrowUp"); await page.keyboard.press("Enter")
await added.locator("[data-base-cond-op]").click(); await menuItem("is greater than").click()
await pop.locator('[data-base-filters-of="view"] [data-base-cond]').last().locator("[data-base-cond-value]").fill("150")
await page.keyboard.press("Enter")
await waitFile(`${F}/Qa.base`, (t) => t.includes("pages > 150"))
check("filter menu: the condition written, the view's one filter now an and", viewText(read(`${F}/Qa.base`)).includes("    filters:\n      and:\n        - type == \"qa-book\"\n        - pages > 150\n"), viewText(read(`${F}/Qa.base`)))
await until(async () => (await rows()).length === 2, 8000).catch(() => {})
check("filter menu: the results follow", JSON.stringify(await rows()) === JSON.stringify(["Harbour lights", "Lighthouse keeper"]), await rows())
await page.screenshot({ path: `${OUT}base-filter-menu-desktop.png` })
await pop.locator("[data-base-cond-value]").first().press("Escape")
check("filter menu: Escape in a value closes it", await pop.count() === 0)
// Properties menu: a property shown from the ones the files have.
await base.locator('[data-base-button="Properties"]').click()
await page.locator('[data-base-pop="Properties"] [data-base-prop="pages"] input').click()
await waitFile(`${F}/Qa.base`, (t) => t.includes("note.pages"))
check("properties menu: a property added at the end of the order", viewText(read(`${F}/Qa.base`)).includes("order: [file.name, formula.left, status, pages]")
  && (await base.locator('th[data-query-col="pages"]').count()) === 1, viewText(read(`${F}/Qa.base`)))
await page.screenshot({ path: `${OUT}base-props-menu-desktop.png` })
const find = page.locator('[data-base-pop="Properties"] input[type=search]')
await find.fill("pag"); await find.press("Escape")
check("properties menu: Escape in its search clears it first", (await find.inputValue()) === "" && await page.locator('[data-base-pop="Properties"]').isVisible())
await find.press("Escape")
check("properties menu: Escape in its field closes it", await page.locator('[data-base-pop="Properties"]').count() === 0)
// Properties menu: a formula added (a mistake said, then fixed), shown as a column; then edited.
await base.locator('[data-base-button="Properties"]').click()
await page.locator("[data-base-add-formula]").click()
await page.locator("[data-base-formula-name]").fill("Price doubled")
await page.locator("[data-base-formula-src]").fill("price * ")
await page.locator("[data-base-formula-name]").click()
check("formula: a mistake is said once the formula is left", await page.locator("[data-base-formula-error]").isVisible() && await page.locator("[data-base-formula-save]").isDisabled())
await page.locator("[data-base-formula-src]").fill("price * 2")
await page.screenshot({ path: `${OUT}base-formula-desktop.png` })
await page.locator("[data-base-formula-src]").press("Enter")
await waitFile(`${F}/Qa.base`, (t) => t.includes("price_doubled: price * 2"))
const fb = read(`${F}/Qa.base`)
check("formula: written to formulas, named, and a column of the view", fb.includes("  price_doubled: price * 2\n") && fb.includes("formula.price_doubled:\n    displayName: Price doubled")
  && viewText(fb).includes("formula.price_doubled]"), fb)
await until(async () => (await base.locator('th[data-query-col="formula.price_doubled"]').count()) === 1, 8000).catch(() => {})
check("formula: its column drawn under its name", (await base.locator('th[data-query-col="formula.price_doubled"]').innerText()).trim() === "Price doubled")
await page.locator('[data-base-edit-formula="price_doubled"]').click()
await page.locator("[data-base-formula-src]").fill("price * 3"); await page.locator("[data-base-formula-save]").click()
await waitFile(`${F}/Qa.base`, (t) => t.includes("price_doubled: price * 3"))
check("formula: edited in its place", read(`${F}/Qa.base`).includes("  price_doubled: price * 3\n"))
await page.locator('[data-base-edit-formula="price_doubled"]').click(); await page.locator("[data-base-delete-formula]").click()
await waitFile(`${F}/Qa.base`, (t) => !t.includes("price_doubled"))
check("formula: deleted, with its column and display name", !read(`${F}/Qa.base`).includes("price_doubled"), read(`${F}/Qa.base`))
await page.keyboard.press("Escape")
// Group menu: rows under each status, written as Obsidian's groupBy; removed again.
await base.locator('[data-base-button="Group"]').click()
await page.locator("[data-base-add-group-by]").click()
await page.locator("[data-overlay] input[role=combobox]").fill("status"); await page.keyboard.press("Enter")
await waitFile(`${F}/Qa.base`, (t) => viewText(t).includes("groupBy:"))
const heads2 = () => base.locator("[data-query-group]").evaluateAll((els) => els.map((e) => e.dataset.queryGroup))
await until(async () => (await heads2()).length === 2, 8000).catch(() => {})
check("group menu: groupBy written, a heading per value", viewText(read(`${F}/Qa.base`)).includes("    groupBy:\n      property: status\n      direction: ASC\n")
  && JSON.stringify(await heads2()) === JSON.stringify(["reading", "want"]), [viewText(read(`${F}/Qa.base`)), await heads2()])
await page.locator("[data-base-group-dir]").click(); await menuItem("Z → A").click()
await waitFile(`${F}/Qa.base`, (t) => viewText(t).includes("direction: DESC\n"))
await until(async () => JSON.stringify(await heads2()) === JSON.stringify(["want", "reading"]), 8000).catch(() => {})
check("group menu: the other direction", viewText(read(`${F}/Qa.base`)).includes("direction: DESC\n") && JSON.stringify(await heads2()) === JSON.stringify(["want", "reading"]), await heads2())
await page.screenshot({ path: `${OUT}base-group-menu-desktop.png` })
// Manual (Obsidian's groupOrder): every group listed in the order shown, so nothing moves; then hidden, shown, added.
const order = () => /groupOrder:\n((?: {6}- .*\n)*)/.exec(viewText(read(`${F}/Qa.base`)))?.[1].trim().split(/\n\s*/).map((l) => l.slice(2)).join() ?? null
await page.locator("[data-base-group-dir]").click(); await menuItem("Manual").click()
await waitFile(`${F}/Qa.base`, (t) => viewText(t).includes("groupOrder:"))
check("group menu: manual writes the groups in their order", order() === "want,reading" && JSON.stringify(await heads2()) === JSON.stringify(["want", "reading"]), [order(), await heads2()])
await page.locator('[data-base-group="reading"] input').click()
await waitFile(`${F}/Qa.base`, () => order() === "want")
await until(async () => (await heads2()).length === 1, 8000).catch(() => {})
check("group menu: an unchecked group is hidden", order() === "want" && JSON.stringify(await heads2()) === '["want"]'
  && await page.locator('[data-base-group="reading"]:not([data-shown])').count() === 1, [order(), await heads2()])
await page.locator('[data-base-group="reading"] input').click()
await waitFile(`${F}/Qa.base`, () => order() === "want,reading")
await page.locator("[data-base-add-group]").click()
await page.locator("[data-base-new-group]").fill("paused"); await page.keyboard.press("Enter")
await waitFile(`${F}/Qa.base`, () => order() === "want,reading,paused")
check("group menu: an added group is listed, empty, and not drawn in a table", order() === "want,reading,paused"
  && (await page.locator('[data-base-group="paused"]').innerText()).includes("0") && (await heads2()).length === 2, [order(), await heads2()])
await page.screenshot({ path: `${OUT}base-group-manual-desktop.png` })
await page.locator('[data-base-groups-all="hide"]').click()
await waitFile(`${F}/Qa.base`, (t) => viewText(t).includes("groupOrder: []"))
await until(async () => (await heads2()).length === 0, 8000).catch(() => {})
check("group menu: hide all", (await heads2()).length === 0 && await base.getByText("Every group is hidden").count() === 1, await heads2())
await page.locator('[data-base-groups-all="show"]').click()
await waitFile(`${F}/Qa.base`, () => (order() ?? "").split(",").length === 3)
await until(async () => (await heads2()).length === 2, 8000).catch(() => {})
check("group menu: show all", (await heads2()).length === 2, [order(), await heads2()])
await page.locator("[data-base-group-dir]").click(); await menuItem("Z → A").click()
await waitFile(`${F}/Qa.base`, (t) => !viewText(t).includes("groupOrder"))
check("group menu: back to a direction drops groupOrder", !viewText(read(`${F}/Qa.base`)).includes("groupOrder"))
await page.keyboard.press("Escape")
// A heading folds its group (not written anywhere), and unfolds it.
const wantRows = () => base.locator('[data-query-row*="Harbour lights"]').count()
await base.locator('[data-query-group="want"]').click()
await until(async () => (await wantRows()) === 0, 4000).catch(() => {})
await ui.idle(); await page.screenshot({ path: `${OUT}base-group-folded-desktop.png`, clip: { x: 320, y: 190, width: 620, height: 240 } })
check("a group's heading folds it", (await wantRows()) === 0 && await base.locator('[data-query-group="want"][data-folded]').count() === 1
  && (await base.locator('[data-query-group="want"]').innerText()).includes("1") && !viewText(read(`${F}/Qa.base`)).includes("fold"))
await base.locator('[data-query-group="want"]').click()
await until(async () => (await wantRows()) === 1, 4000).catch(() => {})
check("and unfolds it", (await wantRows()) === 1)
await base.locator('[data-base-button="Group"]').click()
await page.locator('[data-base-group-menu] button[aria-label="Remove grouping"]').click()
await waitFile(`${F}/Qa.base`, (t) => !viewText(t).includes("groupBy:"))
check("group menu: removed", !viewText(read(`${F}/Qa.base`)).includes("groupBy:"))
await page.keyboard.press("Escape")
// Results menu: a limit, and the rows copied as Markdown and saved as a CSV beside the base.
await page.evaluate(() => { window.__copied = []; navigator.clipboard.writeText = async (t) => { window.__copied.push(t) } })
await base.locator('[data-base-button="Results"]').click()
await page.locator("[data-base-copy=markdown]").click()
const copied = await until(() => page.evaluate(() => window.__copied[0]), 4000).catch(() => null)
check("results menu: copied as a Markdown table, files as links", typeof copied === "string" && copied.startsWith("| Name |") && copied.includes("| [[Harbour lights]] |"), copied)
await page.locator("[data-base-save-csv]").click()
await waitFile(`${F}/Books.csv`, () => { try { return read(`${F}/Books.csv`).length > 0 } catch { return false } })
let csv = ""; try { csv = read(`${F}/Books.csv`) } catch {}
check("results menu: saved as Books.csv beside the base", csv.startsWith("Name,") && csv.includes("Harbour lights,"), csv)
await page.locator("[data-base-limit]").fill("1"); await page.keyboard.press("Enter")
await waitFile(`${F}/Qa.base`, (t) => viewText(t).includes("limit: 1"))
await until(async () => (await rows()).length === 1, 8000).catch(() => {})
check("results menu: a limit written, one row shown, the count says so", viewText(read(`${F}/Qa.base`)).includes("    limit: 1\n") && (await rows()).length === 1
  && (await base.locator("[data-base-count]").innerText()) === "1 of 2 files", await base.locator("[data-base-count]").innerText())
await page.screenshot({ path: `${OUT}base-results-menu-desktop.png` })
await page.locator("[data-base-limit]").fill(""); await page.keyboard.press("Enter")
await waitFile(`${F}/Qa.base`, (t) => !viewText(t).includes("limit:"))
check("results menu: no limit removes it", !viewText(read(`${F}/Qa.base`)).includes("limit:"))
await page.keyboard.press("Escape")
// Search: the rows whose shown values have the words typed; Escape clears it, then closes it. The file is unchanged.
const beforeSearch = read(`${F}/Qa.base`)
await base.locator('[data-base-button="Search"]').click()
await page.locator("[data-base-search]").fill("harb")
await until(async () => (await rows()).length === 1, 5000).catch(() => {})
check("search: only the rows whose values match, the count saying so", JSON.stringify(await rows()) === JSON.stringify(["Harbour lights"])
  && (await base.locator("[data-base-count]").innerText()) === "1 of 2 files", [await rows(), await base.locator("[data-base-count]").innerText()])
await page.screenshot({ path: `${OUT}base-search-desktop.png` })
await page.locator("[data-base-search]").fill("want harbour")
check("search: every word, in any of the shown values", JSON.stringify(await rows()) === JSON.stringify(["Harbour lights"]), await rows())
await page.locator("[data-base-search]").fill("zzz")
check("search: nothing matching says so", await base.locator("[data-base-no-match]").isVisible())
await page.locator("[data-base-search]").press("Escape")
check("search: Escape clears it", (await rows()).length === 2 && (await page.locator("[data-base-search]").inputValue()) === "")
await page.locator("[data-base-search]").press("Escape")
check("search: Escape again closes it, the base's file as it was", (await page.locator("[data-base-search]").count()) === 0 && read(`${F}/Qa.base`) === beforeSearch)
// New: a file the view lists (the view's type == "qa-book" filter as its property), opened in a tab of its own.
await base.locator("[data-base-new]").click()
const opened = await until(async () => { const h = decodeURIComponent(await page.evaluate(() => location.hash)); return /Untitled[^/]*\.md$/.test(h) && h.replace(/^#file\//, "") }, 8000).catch(() => null)
let made = ""; try { made = opened ? read(opened) : "" } catch {}
check("new: a file with the view's properties, opened", !!opened && made.includes("type: qa-book"), [opened, made])
if (opened) await api("DELETE", `file?path=${encodeURIComponent(opened)}`)
await page.goto("about:blank"); await page.goto(url(`${F}/Qa.base`)); await base.waitFor(); await ui.idle()
// Keyboard: the table is a grid with a cell cursor (rows: Harbour lights, Lighthouse keeper; Name, Pages left, State,
// Pages). A double-clicked cell edited, Tab saves it and moves the cursor right.
const HL = `${F}/Books/Harbour lights.md`, LK = `${F}/Books/Lighthouse keeper.md`, hlText = read(HL), lkText = read(LK)
const cursor = () => base.locator("table[role=grid]").evaluate((t) => {
  const c = document.getElementById(t.getAttribute("aria-activedescendant") ?? "")
  return c ? `${c.closest("tr").dataset.queryRow.split("/").pop().replace(".md", "")} ${c.cellIndex}${document.activeElement === t ? "" : " (unfocused)"}` : null
})
const key = async (k, want, name) => { await page.keyboard.press(k); await ui.idle(); const c = await cursor(); check(`keyboard: ${name}`, c === want, c) }
await base.locator(`[data-query-row="${HL}"] td`).nth(2).dblclick()
await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("done"); await page.keyboard.press("Tab")
await waitFile(HL, (t) => t.includes("status: done"))
check("keyboard: Tab saves the cell and moves the cursor right", read(HL).includes("status: done") && await cursor() === "Harbour lights 3", await cursor())
await key("ArrowDown", "Lighthouse keeper 3", "ArrowDown moves the cursor down")
await key("ArrowLeft", "Lighthouse keeper 2", "ArrowLeft moves it left")
await key("Home", "Lighthouse keeper 0", "Home goes to the row's first cell")
await key("End", "Lighthouse keeper 3", "End to its last")
await key("ControlOrMeta+ArrowUp", "Harbour lights 3", "Cmd/Ctrl+ArrowUp to the first row")
await page.screenshot({ path: `${OUT}base-cursor-desktop.png` })
await page.emulateMedia({ colorScheme: "dark" }); await page.evaluate(() => document.documentElement.classList.add("dark")); await ui.idle()
await page.screenshot({ path: `${OUT}base-cursor-desktop-dark.png` })
await page.emulateMedia({ colorScheme: "light" }); await page.evaluate(() => document.documentElement.classList.remove("dark")); await ui.idle()
await page.keyboard.type("250")
check("keyboard: typing edits the cell, what's typed replacing its value", await page.evaluate(() => document.activeElement?.value) === "250", await page.evaluate(() => document.activeElement?.value))
await page.keyboard.press("Enter")
await waitFile(HL, (t) => t.includes("pages: 250"))
check("keyboard: Enter writes the file and moves the cursor down", read(HL).includes("pages: 250") && await cursor() === "Lighthouse keeper 3", [await cursor(), read(HL)])
await page.keyboard.type("9"); await page.keyboard.press("Escape"); await ui.idle()
check("keyboard: Escape cancels the edit, the cursor on that cell", read(LK) === lkText && await cursor() === "Lighthouse keeper 3"
  && (await base.locator("td input").count()) === 0, [await cursor(), read(LK)])
await key("ArrowLeft", "Lighthouse keeper 2", "back to State")
await page.keyboard.press("Delete")
await waitFile(LK, (t) => !t.includes("status:"))
check("keyboard: Delete clears the value (the key removed)", !read(LK).includes("status:") && read(LK).includes("pages: 300"), read(LK))
await page.keyboard.press("ControlOrMeta+ArrowLeft"); await page.keyboard.press("Delete"); await ui.idle()
check("keyboard: Delete leaves a value that can't be edited (the name)", (await base.locator(`[data-query-row="${LK}"]`).count()) === 1, await cursor())
await page.keyboard.press("Enter")
await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Lighthouse keeper")), 5000).catch(() => {})
check("keyboard: Enter on a cell that can't be edited opens the row's file", await page.evaluate(() => decodeURIComponent(location.hash).includes("Lighthouse keeper")), await page.evaluate(() => location.hash))
await ui.sees(HL, () => writeFileSync(`${VAULT}/${HL}`, hlText)); await ui.sees(LK, () => writeFileSync(`${VAULT}/${LK}`, lkText))
await page.goto("about:blank"); await page.goto(url(`${F}/Qa.base`)); await base.waitFor(); await ui.idle()
await ui.sees(`${F}/Qa.base`, () => writeFileSync(`${VAULT}/${F}/Qa.base`, BASE))

// The … menu: small edits to the file (its comment and the key this app doesn't know stay).
await base.locator('[data-base-view="Books"]').click(); await ui.idle()
await ui.menu.open(base.locator("[data-base-menu]"))
await ui.sees(`${F}/Qa.base`, () => ui.menu.pick("Layout", "List"))
let text = read(`${F}/Qa.base`)
check("layout: the view's type changes, nothing else", text === BASE.replace("  - type: table\n    name: Books", "  - type: list\n    name: Books"), text)
await ui.menu.open(base.locator("[data-base-menu]"))
await ui.sees(`${F}/Qa.base`, () => ui.menu.pick("New view"))
text = read(`${F}/Qa.base`)
check("new view: added at the end (a table with the view's columns), its tab picked", text.includes("  - type: table\n    name: Table\n    filters: type == \"qa-book\"\n    order:")
  && text.startsWith("# Made-up books, for QA\n") && (await tabs()).at(-1) === "Table"
  && (await base.locator('[data-base-view="Table"]').getAttribute("aria-selected")) === "true", [text, await tabs()])
await ui.menu.open(base.locator("[data-base-menu]"))
await ui.sees(`${F}/Qa.base`, () => ui.menu.pick("Delete view"))
check("delete view: gone from the file", !read(`${F}/Qa.base`).includes("name: Table\n"), read(`${F}/Qa.base`))
await ui.sees(`${F}/Qa.base`, () => page.getByRole("button", { name: "Undo" }).click())
check("delete view: Undo brings it back", read(`${F}/Qa.base`).includes("name: Table\n"))
await page.screenshot({ path: `${OUT}base-edited-desktop.png` })

// A note: the fence, the embed (on its view), a fence's formula and summaries.
await page.goto(url(`${F}/Demo.md`)); await page.locator("section.glass h2", { hasText: "Qa query" }).first().waitFor(); await ui.idle()
const fence = page.locator("section.glass", { has: page.locator("h2", { hasText: "Qa inline" }) }).first()
check("a ```base fence draws its view", await fence.isVisible() && (await fence.locator("[data-query-row]").count()) === 3, await fence.innerText().catch(() => ""))
const embed = page.locator(`[data-format-embed="${F}/Qa.base"]`)
check("![[Qa.base#Board]] shows that view", (await embed.locator('[data-base-view="Board"]').getAttribute("aria-selected")) === "true"
  && (await embed.locator("[data-query-board]").count()) === 1)
const q = page.locator("section.glass", { has: page.locator("h2", { hasText: "Qa query" }) }).first()
const qs = (await q.locator('[data-query-summaries="all"]').innerText()).replace(/\s+/g, " ").trim()
check("a fence: a formula column and summaries", qs === "Sum 600 Max 200", qs)
// A fence's header changes the fence in its note; an embed's toolbar, the .base it shows.
await q.locator('[data-query-sort="pages"]').click(); await menuItem("Sort descending").click()
await waitFile(`${F}/Demo.md`, (t) => t.includes("direction: DESC"))
check("a fence: its sort written in the fence", read(`${F}/Demo.md`).includes("    order: [file.name, pages, formula.left]\n    summaries:\n      pages: Sum\n      formula.left: Max\n    sort:\n      - property: pages\n        direction: DESC\n```"), read(`${F}/Demo.md`))
await embed.locator('[data-base-button="Sort"]').click()
await page.locator("[data-base-add-sort]").click()
await page.locator("[data-overlay] input[role=combobox]").fill("File name"); await page.keyboard.press("Enter")
await waitFile(`${F}/Qa.base`, (t) => t.includes("property: file.name"))
const boardView = (t) => t.slice(t.indexOf("name: Board"), t.indexOf("  - type: map"))
check("an embed: its view's sort written in the .base", boardView(read(`${F}/Qa.base`)).includes("    sort:\n      - property: file.name\n        direction: ASC\n"), boardView(read(`${F}/Qa.base`)))
await page.keyboard.press("Escape")
await page.screenshot({ path: `${OUT}base-note-desktop.png`, fullPage: true })
await page.emulateMedia({ colorScheme: "dark" })
await page.evaluate(() => document.documentElement.classList.add("dark")); await ui.idle()
await page.screenshot({ path: `${OUT}base-note-desktop-dark.png`, fullPage: true })
await page.goto(url(`${F}/Qa.base`)); await base.waitFor(); await ui.idle()
await page.screenshot({ path: `${OUT}base-desktop-dark.png` })
await base.locator('[data-base-view="Shelf"]').click(); await ui.idle()
await base.locator('[data-base-button="Filter"]').click(); await ui.idle()
await page.screenshot({ path: `${OUT}base-filter-menu-desktop-dark.png` })
await page.keyboard.press("Escape")

// Every row (no cap): 700 notes, drawn as they come near the screen, every one reached by scrolling.
// (32 at a time: 700 connections at once overflow macOS's accept queue of 128, and one dropped fails the run)
for (let i = 0; i < 700; i += 32) await Promise.all(Array.from({ length: Math.min(32, 700 - i) }, (_, k) => put(`${F}/Many/Row ${String(i + k + 1).padStart(3, "0")}.md`, `---\ntype: qa-row\nn: ${i + k + 1}\n---\n`)))
await put(`${F}/Many.base`, `filters: file.inFolder("${F}/Many")\nviews:\n  - type: table\n    name: All\n    order: [file.name, n]\n    summaries:\n      n: Sum\n`)
const many = page.locator(`[data-pane] [data-base="${F}/Many.base"]`)
await page.goto(url(`${F}/Many.base`)); await many.locator("[data-query-row]").first().waitFor(); await ui.idle()
const drawn = () => many.locator("[data-query-row]").count()
const firstDrawn = await drawn()
check("every row: the count says all of them; only the first are drawn at once", (await many.locator("[data-base-count]").innerText()) === "700 files" && firstDrawn > 0 && firstDrawn < 700, firstDrawn)
await until(async () => { await many.locator("[data-base-body]").evaluate((e) => { e.scrollTop = e.scrollHeight }); return (await drawn()) === 700 }, 15000, 300).catch(() => {})
const sum = (await many.locator('[data-query-summaries="all"]').innerText().catch(() => "")).replace(/\s+/g, " ").trim()
check("every row: scrolling down reaches the last, the summary under all of them", (await drawn()) === 700 && (await many.locator(`[data-query-row="${F}/Many/Row 700.md"]`).count()) === 1 && /^Sum 245.?350$/.test(sum), [await drawn(), sum])
// The keyboard's row kept drawn: Cmd/Ctrl+ArrowDown on a fresh load goes to the last row, drawn and scrolled to.
await page.goto("about:blank"); await page.goto(url(`${F}/Many.base`)); await many.locator("[data-query-row]").first().waitFor(); await ui.idle()
await many.locator("table[role=grid]").focus(); await page.keyboard.press("ControlOrMeta+ArrowDown"); await ui.idle()
const end = await many.locator("table[role=grid]").evaluate((t) => {
  const c = document.getElementById(t.getAttribute("aria-activedescendant") ?? ""), r = c?.getBoundingClientRect(), s = t.closest("[data-base-body]").getBoundingClientRect()
  return c && { row: c.closest("tr").dataset.queryRow, seen: r.top >= s.top && r.bottom <= s.bottom }
})
check("every row: Cmd/Ctrl+ArrowDown draws the last row and scrolls to it", end?.row === `${F}/Many/Row 700.md` && end.seen, end)

// Phone.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const m = watch(await phone.newPage(), { label: "phone" }), mui = app(m)
for (const p of [`${F}/Qa.base`, `${F}/Demo.md`]) {
  await m.goto(url(p)); await m.locator("[data-query-row]:visible").first().waitFor(); await mui.idle()
  const w = await m.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }))
  check(`390px: ${p} doesn't scroll sideways`, w.doc <= 390 && w.win === 390, w)
  await m.screenshot({ path: `${OUT}base-phone-${p.split("/").pop().replace(/\W+/g, "-")}.png`, fullPage: true })
}

// Phone: a header's menu on a tap, the filter menu inside the screen (a fence's table).
await m.goto(url(`${F}/Demo.md`)); await m.locator("[data-query-row]:visible").first().waitFor(); await mui.idle()
const mb = m.locator("section.glass", { has: m.locator("h2", { hasText: "Qa query" }) }).first()
await mb.locator('[data-query-sort="pages"]').waitFor({ timeout: 15000 }).catch(() => {})
await mb.locator('[data-query-sort="pages"]').tap().catch(() => {})
await until(() => m.locator("[role=menu]").isVisible(), 3000).catch(() => {})
check("390px: a tap on a header opens its menu", await m.locator("[role=menu]").isVisible().catch(() => false))
await m.screenshot({ path: `${OUT}base-phone-header-menu.png` })
await m.keyboard.press("Escape"); await mui.idle()
await mb.locator('[data-base-button="Filter"]').tap()
const box = await m.locator('[data-base-pop="Filter"]').boundingBox().catch(() => null)
check("390px: the filter menu fits the screen", !!box && box.x >= 0 && box.x + box.width <= 390, box)
await m.screenshot({ path: `${OUT}base-phone-filter-menu.png` })
await m.keyboard.press("Escape"); await mui.idle()
await mb.locator('[data-base-button="Results"]').tap()
const rbox = await m.locator('[data-base-pop="Results"]').boundingBox().catch(() => null)
check("390px: the results menu fits the screen", !!rbox && rbox.x >= 0 && rbox.x + rbox.width <= 390, rbox)
await m.screenshot({ path: `${OUT}base-phone-results-menu.png` })
await m.keyboard.press("Escape"); await mui.idle()
await mb.locator('[data-base-button="Filter"]').tap(); await mui.idle()
await m.emulateMedia({ colorScheme: "dark" })
await m.evaluate(() => document.documentElement.classList.add("dark")); await mui.idle()
await m.screenshot({ path: `${OUT}base-phone-filter-menu-dark.png` })
await m.emulateMedia({ colorScheme: "light" }); await m.evaluate(() => document.documentElement.classList.remove("dark"))

// Phone: a heading held, then dragged past another, moves its column (a tap still opens its menu: above).
await put(`${F}/Touch.base`, `filters: 'type == "qa-book"'\nviews:\n  - type: table\n    name: Touch\n    order: [file.name, status, pages]\n`)
await m.goto("about:blank"); await m.goto(url(`${F}/Touch.base`))
const th = (k) => m.locator(`thead th[data-query-col="${k}"]:visible`).first()
await th("file").waitFor({ timeout: 15000 })
const { touch } = await fingers(m)
const finger = async (from, to, during) => {
  await m.evaluate(() => { window.qaHeld = new Promise((r) => addEventListener("contextmenu", () => r(), { once: true, capture: true })) })
  await touch("touchStart", from.x, from.y); await m.evaluate(() => window.qaHeld)
  for (let i = 1; i <= 10; i++) { await touch("touchMove", from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10); await m.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))) }
  await mui.idle()
  const seen = await during()
  await touch("touchEnd", to.x, to.y); await mui.idle()
  return seen
}
const nb = await th("file").boundingBox(), pb = await th("pages").boundingBox()
const held = await finger({ x: nb.x + 20, y: nb.y + nb.height / 2 }, { x: pb.x + pb.width - 4, y: nb.y + nb.height / 2 }, async () => {
  await m.screenshot({ path: `${OUT}touch-base-heading-drag.png` })
  return { menus: await m.locator("[role=menu]").count(), lifted: await m.locator("[data-drag-ghost]").count() }
})
check("390px: a heading held and dragged lifts it, its menu gone", held.menus === 0 && held.lifted === 1, held)
await waitFile(`${F}/Touch.base`, (t) => t.includes("order: [status, pages, file.name]"))
check("390px: let go past the last, its column moves to the end", read(`${F}/Touch.base`).includes("order: [status, pages, file.name]"), read(`${F}/Touch.base`))
await m.screenshot({ path: `${OUT}touch-base-heading-after.png` })

await browser.close()
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
await done()
