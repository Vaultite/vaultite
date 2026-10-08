// Database views (```block-query): Design.md's examples drawn; a "Qa query" folder of made-up people and a note with a
// query: sorting by a heading (asc, desc, back), a row opens its file, double-click edits a value (one frontmatter line
// changes on disk, the table follows), cards and list views, a bad where says why, and at 390px the table scrolls in its
// card without widening the page. Boards: columns in order, a card dragged to another column (one line on disk, no
// flicker back), its … menu, phone (menu, the board scrolls in its card). Calendars: the month grid, today, prev/next,
// an item dragged to another day, the phone's agenda. Screenshots in the scratch folder given as the third argument (or /tmp/vaultite-query/).
// WRITES a "Qa query" folder (removed after): throwaway server only.
//   node web/qa/query.mjs <base url> <vault path> [screenshots dir]
import { mkdirSync, readFileSync } from "node:fs"
import { qa } from "./lib/qa.mjs"
import { pagePath } from "./subjects.mjs"
const { args: [B, VAULT, SHOTS_DIR = "/tmp/vaultite-query"], browser, check, watch, done } = await qa(import.meta.url)
const OUT = SHOTS_DIR.replace(/\/?$/, "/")
mkdirSync(OUT, { recursive: true })
const api = (method, p, body) => fetch(`${B}api/${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
const put = async (path, text) => { const r = await api("POST", "file", { path, text }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`) }

const F = "Qa query"
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
await put(`${F}/Alice Park.md`, "---\ntype: qa-person\nrelation: friend\nlocation: Austin, TX\nevery_days: 30\ntags: [University, AI]\n---\n")
await put(`${F}/Bob Lee.md`, "---\ntype: qa-person\nrelation: friend   # from running club\nlocation: Denver, CO\nevery_days: 7\n---\n\nLikes tea.\n")
await put(`${F}/Lee Park.md`, "---\ntype: qa-person\nrelation: mentor\nlocation: Boston, MA with a long name that goes on and on to make the table wider than a phone\nevery_days: 60\nwith: '[[Alice Park]]'\n---\n")
const block = (o) => "```block-query\n" + o + "\n```\n"
const pad = (n) => String(n).padStart(2, "0")
const now = new Date(), MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, TODAY = `${MONTH}-${pad(now.getDate())}`
const DAY1 = `${MONTH}-03`, DAY2 = `${MONTH}-${now.getDate() === 20 ? "21" : "20"}`
await put(`${F}/Tasks/Write docs.md`, `---\ntype: qa-task   # keep this\nstatus: idea\ndue: ${DAY1}\n---\n\nNotes.\n`)
await put(`${F}/Tasks/Fix map.md`, `---\ntype: qa-task\nstatus: doing\ndue: ${DAY1} 18:00\n---\n`)
await put(`${F}/Tasks/Ship app.md`, `---\ntype: qa-task\nstatus: done\ndue: ${TODAY}\n---\n`)
await put(`${F}/Board.md`, block("title: Qa board\nfrom: Qa query/Tasks/\ntype: qa-task\nview: board\ngroup: status\ngroups: [idea, doing, done]\ncolumns: [file, due]\nwide: true") + "\n"
  + block("title: Qa calendar\nfrom: Qa query/Tasks/\ntype: qa-task\nview: calendar\ndate: due\nwide: true"))
await put(`${F}/Views.md`, block("title: Qa people\nfrom: Qa query/\ntype: qa-person\ncolumns: [file, relation, location, every_days, tags, with]\nsort: file") + "\n"
  + block("title: Qa cards\nfrom: Qa query/\ntype: qa-person\nview: cards\ncolumns: [file, relation, every_days]") + "\n"
  + block("title: Qa list\nfrom: Qa query/\ntype: qa-person\nview: list\ngroup: relation\ncolumns: [file, location]") + "\n"
  + block("title: Qa bad\nwhere: \"relation =\""))
const url = (p) => `${B}#file/${encodeURIComponent(p)}`
const DESIGN = await pagePath(B, "Design") // (Dashboards/, or where the vault keeps its pages)

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = watch(await ctx.newPage())

// Design.md's examples.
await page.goto(url(DESIGN)); await page.waitForTimeout(2000)
const design = page.locator("section.glass", { has: page.locator("[data-query]") }).first()
await design.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
check("Design.md draws a query block", await design.isVisible() && (await design.locator("[data-query-row]").count()) > 0)
await design.screenshot({ path: `${OUT}query-desktop.png` })

await page.goto(url(`${F}/Views.md`)); await page.waitForTimeout(2000)
const card = (title) => page.locator("section.glass", { has: page.locator("h2", { hasText: title }) }).first()
const table = card("Qa people")
const rows = () => table.locator("[data-query-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-query-row").split("/").pop()))
check("the table lists the files, sorted by the query", JSON.stringify(await rows()) === JSON.stringify(["Alice Park.md", "Bob Lee.md", "Lee Park.md"]), await rows())
check("the count", (await table.locator("h2 + div").innerText()).includes("3 files"), await table.locator("h2 + div").innerText())
check("a list is chips, a link a link", (await table.locator("[data-query-row] span.rounded-\\[5px\\]").count()) === 2
  && (await table.locator("[data-query-row] button", { hasText: "Alice Park" }).count()) === 1)
await table.locator("[data-query-sort=every_days]").click(); await page.waitForTimeout(150)
check("a heading sorts ascending", JSON.stringify(await rows()) === JSON.stringify(["Bob Lee.md", "Alice Park.md", "Lee Park.md"]), await rows())
await table.locator("[data-query-sort=every_days]").click(); await page.waitForTimeout(150)
check("again: descending", JSON.stringify(await rows()) === JSON.stringify(["Lee Park.md", "Alice Park.md", "Bob Lee.md"]), await rows())
await table.locator("[data-query-sort=every_days]").click(); await page.waitForTimeout(150)
check("again: the query's order", JSON.stringify(await rows()) === JSON.stringify(["Alice Park.md", "Bob Lee.md", "Lee Park.md"]), await rows())

// Double-click a value: one line changes on disk (the comment on relation stays), the table follows.
const samDays = table.locator(`[data-query-row="${F}/Bob Lee.md"] td`).nth(3)
await samDays.dblclick(); await page.waitForTimeout(150)
const input = table.locator("input")
check("double-click edits a value (and doesn't open the file)", await input.isVisible() && (await page.evaluate(() => location.hash)).includes("Views.md"))
await input.fill("10"); await input.press("Enter"); await page.waitForTimeout(1200)
const sam = readFileSync(`${VAULT}/${F}/Bob Lee.md`, "utf8")
check("the edit writes that one key, as a number", sam === "---\ntype: qa-person\nrelation: friend   # from running club\nlocation: Denver, CO\nevery_days: 10\n---\n\nLikes tea.\n", sam)
check("the table shows it", (await samDays.innerText()).trim() === "10", await samDays.innerText())
await page.screenshot({ path: `${OUT}query-views-desktop.png`, fullPage: true })

check("cards view", (await card("Qa cards").locator("button[data-query-row]").count()) === 3)
const groups = await card("Qa list").locator("[data-query-group]").allInnerTexts()
check("list view with groups", groups.length === 2 && groups[0].startsWith("friend") && groups[1].startsWith("mentor"), groups)
check("a bad where says why", (await card("Qa bad").innerText()).includes("expected a value"), await card("Qa bad").innerText())

// A row opens its file.
await table.locator(`[data-query-row="${F}/Lee Park.md"] td`).first().click(); await page.waitForTimeout(800)
check("a row click opens its file", (await page.evaluate(() => decodeURIComponent(location.hash))).endsWith(`${F}/Lee Park.md`), await page.evaluate(() => location.hash))

// Boards.
await page.goto(url(`${F}/Board.md`)); await page.waitForTimeout(2000)
const bcard = card("Qa board")
const cols = () => bcard.locator("[data-board-col]").evaluateAll((els) => els.map((e) => [e.dataset.boardCol, [...e.querySelectorAll("[data-query-row]")].map((r) => r.dataset.queryRow.split("/").pop().replace(".md", ""))]))
check("board: columns in the listed order, no value last", JSON.stringify(await cols()) === JSON.stringify([["idea", ["Write docs"]], ["doing", ["Fix map"]], ["done", ["Ship app"]], ["", []]]), await cols())
const dragTo = async (from, to) => {
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + 20, a.y + 10); await page.mouse.down()
  await page.mouse.move(a.x + 40, a.y + 20, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 8 })
  await page.waitForTimeout(100)
  const lit = await to.evaluate((e) => e.className.includes("ring-primary"))
  await page.mouse.up()
  return lit
}
const lit = await dragTo(bcard.locator(`[data-query-row="${F}/Tasks/Write docs.md"]`), bcard.locator('[data-board-col="done"]'))
check("board: the column under a dragged card lights up", lit)
await page.waitForTimeout(100)
check("board: the card is in its new column at once, in the query's order", JSON.stringify((await cols())[2]) === JSON.stringify(["done", ["Ship app", "Write docs"]]), await cols())
await page.waitForTimeout(1500)
const wd = readFileSync(`${VAULT}/${F}/Tasks/Write docs.md`, "utf8")
check("board: the move writes that one key (the rest stays)", wd === `---\ntype: qa-task   # keep this\nstatus: done\ndue: ${DAY1}\n---\n\nNotes.\n`, wd)
check("board: and stays there", JSON.stringify((await cols())[2]) === JSON.stringify(["done", ["Ship app", "Write docs"]]) && (await page.evaluate(() => location.hash)).includes("Board.md"), await cols())
await bcard.locator(`[data-query-row="${F}/Tasks/Fix map.md"]`).hover()
await bcard.locator(`[data-query-row="${F}/Tasks/Fix map.md"] [data-query-move]`).click(); await page.waitForTimeout(200)
await page.getByText("Move to No value").click(); await page.waitForTimeout(1500)
const fm = readFileSync(`${VAULT}/${F}/Tasks/Fix map.md`, "utf8")
check("board: the … menu moves it; No value removes the key", !fm.includes("status:") && JSON.stringify((await cols())[3]) === JSON.stringify(["", ["Fix map"]]), [fm, await cols()])
await bcard.screenshot({ path: `${OUT}query-board-desktop.png` })
// Calendars.
const ccard = card("Qa calendar")
const chips = (d) => ccard.locator(`[data-cal-grid] [data-cal-day="${d}"] [data-query-row]`).allInnerTexts()
check("calendar: this month, items on their days, today lit", (await ccard.locator("[data-cal-grid]").isVisible())
  && JSON.stringify(await chips(DAY1)) === JSON.stringify(["Write docs", "Fix map"]) && JSON.stringify(await chips(TODAY)) === JSON.stringify(["Ship app"])
  && (await ccard.locator(`[data-cal-day="${TODAY}"] [data-cal-today]`).count()) === 1, [await chips(DAY1), await chips(TODAY)])
const m0 = await ccard.locator("[data-cal-month]").innerText()
await ccard.locator("[data-cal-next]").click(); await page.waitForTimeout(800)
check("calendar: next month", (await ccard.locator("[data-cal-month]").innerText()) !== m0 && (await ccard.locator("[data-cal-grid] [data-query-row]").count()) === 0, await ccard.locator("[data-cal-month]").innerText())
await ccard.getByText("Today", { exact: true }).click(); await page.waitForTimeout(800)
check("calendar: Today goes back", (await ccard.locator("[data-cal-month]").innerText()) === m0)
await dragTo(ccard.locator(`[data-cal-grid] [data-cal-day="${DAY1}"] [data-query-row="${F}/Tasks/Fix map.md"]`), ccard.locator(`[data-cal-grid] [data-cal-day="${DAY2}"]`))
await page.waitForTimeout(100)
check("calendar: a dragged item shows on its new day at once", JSON.stringify(await chips(DAY2)) === JSON.stringify(["Fix map"]), await chips(DAY2))
await page.waitForTimeout(1500)
const fm2 = readFileSync(`${VAULT}/${F}/Tasks/Fix map.md`, "utf8")
check("calendar: its date is rewritten, the time kept", fm2.includes(`due: ${DAY2} 18:00`) && JSON.stringify(await chips(DAY2)) === JSON.stringify(["Fix map"]), fm2)
await ccard.screenshot({ path: `${OUT}query-calendar-desktop.png` })

// Phone: the table scrolls inside its card, the page doesn't widen.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const m = watch(await phone.newPage(), { label: "phone" })
for (const p of [`${F}/Views.md`, `${F}/Board.md`, DESIGN]) {
  await m.goto(url(p)); await m.waitForTimeout(2000)
  // (A phone's layout viewport grows with what overflows: 390 is the width it must keep.)
  const w = await m.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }))
  check(`390px: ${p} doesn't scroll sideways`, w.doc <= 390 && w.win === 390, w)
}
await m.goto(url(`${F}/Views.md`)); await m.waitForTimeout(2000)
const scroll = await m.locator("[data-query-scroll]").first().evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
check("390px: the table scrolls inside its card", scroll.sw > scroll.cw, scroll)
await m.screenshot({ path: `${OUT}query-views-phone.png`, fullPage: true })
await m.goto(url(`${F}/Board.md`)); await m.waitForTimeout(2000)
const mb = m.locator("[data-query-board]").first()
const bs = await mb.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
check("390px: the board scrolls inside its card", bs.sw > bs.cw, bs)
const mv = m.locator(`[data-query-row="${F}/Tasks/Ship app.md"] [data-query-move]`)
// (Chrome's emulation says pointer: coarse only in a browser whose first context was a phone's: then check the class.)
const op = await mv.evaluate((e) => ({ opacity: getComputedStyle(e).opacity, coarse: matchMedia("(pointer: coarse)").matches, cls: e.className.includes("pointer-coarse:opacity-100") }))
check("390px: a card's … is shown without hover", op.coarse ? op.opacity === "1" : op.cls, op)
await mv.tap(); await m.waitForTimeout(300)
await m.getByText("Move to idea").tap(); await m.waitForTimeout(1500)
check("390px: the … menu moves a card", readFileSync(`${VAULT}/${F}/Tasks/Ship app.md`, "utf8").includes("status: idea"))
const ag = m.locator("[data-cal-agenda]").first()
check("390px: the calendar is an agenda", await ag.isVisible() && !(await m.locator("[data-cal-grid]").first().isVisible())
  && (await ag.innerText()).includes("Write docs") && (await ag.innerText()).includes("Today"), await ag.innerText())
await m.screenshot({ path: `${OUT}query-board-phone.png`, fullPage: true })
await m.goto(url(DESIGN)); await m.waitForTimeout(2000)
const pd = m.locator("section.glass", { has: m.locator("[data-query]") }).first()
await pd.scrollIntoViewIfNeeded(); await m.waitForTimeout(300)
await pd.screenshot({ path: `${OUT}query-phone.png` })

await browser.close()
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
await done()
