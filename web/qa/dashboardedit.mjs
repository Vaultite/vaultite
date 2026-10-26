// A dashboard edited as it's read (Dashboards' editGrid): editing keeps the reading width, title and two columns; text
// between blocks is typed in place; a block's </> edits its options in its card; a card dragged moves its fence; Add a
// block puts one in; remove and Full width write the file; source mode is its Markdown and back. Then on a phone: one
// column, the bars showing, text typed and a card moved with a held finger. The file on disk is checked after each
// step. A dashboard with nothing side by side reads at a note's width. WRITES to the vault: throwaway server only.
//   node web/qa/dashboardedit.mjs <base url> [out dir]
import { SHOTS, fingers, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const enc = encodeURIComponent
const PAGE = "Qa dashboard edit/Grid.md"
const FM = "---\ntype: dashboard\n---\n\n"
const START = `${FM}A line about the page.\n\n\`\`\`block-agenda\n\`\`\`\n\n\`\`\`block-week-goals\n\`\`\`\n\n\`\`\`block-people-wants\nstack: true\n\`\`\`\n\n## Notes\n\n| Thing | Value |\n| --- | --- |\n| One | 1 |\n\n\`\`\`block-inbox\n\`\`\`\n`
const disk = async () => (await (await fetch(`${B}api/file?path=${enc(PAGE)}`)).json()).text
const write = (text) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: PAGE, text }) })
/** The file once it's what `want` says (a string, or a test of the text), within a few seconds. */
const saved = async (want) => (await until(async () => { const t = await disk(); return (typeof want === "string" ? t === want : want(t)) ? t : null }, 6000)) ?? await disk()
const fences = (t) => [...t.matchAll(/```block-([\w-]+)/g)].map((m) => m[1]).join(",")

await fetch(`${B}api/file?path=${enc(PAGE)}`, { method: "DELETE" })
await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: PAGE, text: START }) })
await wait(600)

// (tall enough for the whole page: a card is dragged from its end to its start)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const editing = async () => (await page.locator(".file-view .cm-content[contenteditable=true]").count()) > 0
const box = async (sel) => (await page.locator(sel).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
const card = (name) => page.locator(`[data-card="${name}"]`).first()

await page.goto(`${B}#file/${enc(PAGE)}`); await wait(2000)
if (await editing()) await palette(page, "Switch to reading view")
const readWidth = (await box(".file-view")).width, readTitle = await box(".file-view h1, .file-view textarea[aria-label='File name']")
const readAgenda = await box('[data-block="agenda"] > *')
await palette(page, "Switch to live preview", 1500)
check("into editing", await editing())
const editWidth = (await box(".file-view")).width, editTitle = await box(".file-view textarea[aria-label='File name']")
check(`editing is as wide as reading (${readWidth} / ${editWidth})`, Math.abs(readWidth - editWidth) < 2)
check(`the title doesn't move (${readTitle.x},${readTitle.y} / ${editTitle.x},${editTitle.y})`, Math.abs(readTitle.x - editTitle.x) < 2 && Math.abs(readTitle.y - editTitle.y) < 2)
const a = await box('[data-card="agenda"]'), w = await box('[data-card="week-goals"]'), bk = await box('[data-card="people-wants"]')
check("blocks side by side while editing", Math.abs(a.y - w.y) < 2 && w.x > a.x + 200 && Math.abs(a.width - readAgenda.width) < 40)
check("a stacked block goes under the one before", Math.abs(bk.x - w.x) < 2 && bk.y > w.y + 20)
check("the text between blocks is the editor's", (await page.locator(".cm-content > .cm-line", { hasText: "A line about the page." }).count()) === 1)
await page.screenshot({ path: `${OUT}dashboardedit-desktop.png` })

// Text in its row, typed as in a note: saved, the cursor kept through the save and the file read again.
await page.locator(".cm-content > .cm-line", { hasText: "A line about the page." }).click()
await page.keyboard.press("End"); await page.keyboard.type(" More.")
let t = await saved((x) => x.includes("A line about the page. More."))
check("typed text is saved in its row", t === START.replace("the page.", "the page. More."), t)
await wait(1200)
await page.keyboard.type(" Again.")
t = await saved((x) => x.includes("More. Again."))
check("typing goes on where it was after the save", t === START.replace("the page.", "the page. More. Again."), t)
check("the keyboard is still in the text", await page.evaluate(() => !!document.activeElement?.closest(".cm-content")))
const base = t

// A block's </>: its options in its card, written into its fence; the editor's undo takes it back.
await card("week-goals").hover(); await card("week-goals").getByRole("button", { name: "Edit source" }).click(); await wait(300)
const field = card("week-goals").locator(".cm-card-source textarea")
check("</> opens its source in its card", await field.isVisible() && await field.evaluate((e) => e === document.activeElement))
await page.keyboard.type("title: Qa goals")
t = await saved((x) => x.includes("title: Qa goals"))
check("typing in it writes its fence", t === base.replace("```block-week-goals\n```", "```block-week-goals\ntitle: Qa goals\n```"), t)
await page.screenshot({ path: `${OUT}dashboardedit-source.png` })
await page.keyboard.press("ControlOrMeta+z")
t = await saved(base)
check("⌘Z in it is the file's undo", t === base, t)
await card("week-goals").getByRole("button", { name: "Done" }).click(); await wait(200)
check("Done closes it", !(await field.count()))

// Dragged by its grip: inbox before agenda (a stacked block goes along with the one it's under).
await card("inbox").hover()
const grip = await card("inbox").getByRole("button", { name: "Move", exact: true }).boundingBox()
const target = await box('[data-cell] [data-card="agenda"]')
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down()
for (let i = 1; i <= 12; i++) { await page.mouse.move(grip.x + (target.x + 20 - grip.x) * i / 12, grip.y + (target.y + target.height / 2 - grip.y) * i / 12); await wait(30) }
await page.screenshot({ path: `${OUT}dashboardedit-drag.png` })
await page.mouse.up()
t = await saved((x) => fences(x).startsWith("inbox"))
check(`a card dragged moves its fence (${fences(t)})`, fences(t) === "inbox,agenda,week-goals,people-wants" && t.replace(/\s+/g, "") === base.replace("```block-inbox\n```\n", "").replace("```block-agenda", "```block-inbox\n```\n\n```block-agenda").replace(/\s+/g, ""), t)
await page.mouse.move(10, 10)
const moved = t
// …and back after week-goals' cell: people-wants (stacked under it) stays with it.
const grip2 = await card("inbox").getByRole("button", { name: "Move", exact: true }).boundingBox().catch(() => null)
await card("inbox").hover()
const g = await card("inbox").getByRole("button", { name: "Move", exact: true }).boundingBox(), wk = await box('[data-card="week-goals"]')
await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down()
for (let i = 1; i <= 12; i++) { await page.mouse.move(g.x + (wk.x + wk.width - 20 - g.x) * i / 12, g.y + (wk.y + 30 - g.y) * i / 12); await wait(30) }
await page.mouse.up()
t = await saved((x) => fences(x).startsWith("agenda"))
check(`dropped beside a cell, it goes after the blocks stacked in it (${fences(t)})`, !!grip2 && fences(t) === "agenda,week-goals,people-wants,inbox" && t !== moved, t)
await page.mouse.move(10, 10)

// Add a block: picked from the list, its fence goes after the run.
const before = await disk()
await page.locator("[data-add-block]").first().click(); await wait(400)
await page.keyboard.type("errors"); await wait(300)
check("Add a block lists the blocks", await page.locator("[role=option]", { hasText: "Errors" }).count() > 0)
await page.keyboard.press("Enter")
t = await saved((x) => x.includes("```block-errors"))
check(`the block picked is put after the run (${fences(t)})`, t === before.replace("```block-inbox\n```", "```block-inbox\n```\n\n```block-errors\n```"), t)

// Remove, and its Undo; Full width.
await card("errors").hover(); await card("errors").getByRole("button", { name: "Remove" }).click()
t = await saved((x) => !x.includes("block-errors"))
check("Remove takes its fence out", t === before, t)
await page.locator("[data-sonner-toast] button", { hasText: "Undo" }).first().click().catch(() => {})
t = await saved((x) => x.includes("block-errors"))
check("its Undo puts it back", t.includes("```block-errors"))
await card("agenda").hover(); await card("agenda").getByRole("button", { name: "Full width" }).click()
t = await saved((x) => x.includes("```block-agenda\nwide: true\n```"))
check("Full width writes wide: true", t.includes("```block-agenda\nwide: true\n```"), t)
await wait(400)
const wa = await box('[data-card="agenda"]'), ww = await box('[data-card="week-goals"]')
check("…and it takes the row", wa.width > ww.width * 1.6 && ww.y > wa.y + 20)

// A fence a plugin draws (its body the plugin's own, a chart's JSON): Full width and Under the one before go in its info
// line, its body untouched.
const CHART = '{"type": "bar", "data": [{"week": "W1", "pages": 120}, {"week": "W2", "pages": 80}]}'
const withChart = (await disk()).replace("```block-inbox\n```", `\`\`\`block-inbox\n\`\`\`\n\n\`\`\`chart\n${CHART}\n\`\`\``)
await write(withChart); await wait(1200)
const chart = card("```chart")
await chart.hover(); await chart.getByRole("button", { name: "Full width" }).click()
t = await saved((x) => x.includes("```chart wide\n"))
check("a chart's Full width: ```chart wide, its body as it was", t === withChart.replace("```chart\n", "```chart wide\n"), t)
await wait(400)
const wc = await box('[data-card="```chart"]'), wi = await box('[data-card="inbox"]')
check("…and it takes the row", wc.width > wi.width * 1.6 && wc.y > wi.y + 20)
await chart.hover(); await chart.getByRole("button", { name: "Stacked" }).click()
t = await saved((x) => x.includes("```chart wide stack\n"))
await chart.hover(); await chart.getByRole("button", { name: "Full width" }).click()
t = await saved((x) => x.includes("```chart stack\n"))
check("Stacked, then not wide: ```chart stack, its body as it was", t === withChart.replace("```chart\n", "```chart stack\n"), t)
await chart.hover(); await chart.getByRole("button", { name: "Remove" }).click()
t = await saved((x) => !x.includes("```chart"))

// Source mode is the file's Markdown; back to the grid.
const was = await disk()
await palette(page, "Switch to source mode", 1200)
check("source mode shows the fences as text, no grid", !(await page.locator(".cm-grid [data-card]").count()) && await page.locator(".cm-line", { hasText: "```block-agenda" }).count() > 0)
await page.screenshot({ path: `${OUT}dashboardedit-sourcemode.png` })
await palette(page, "Switch to live preview", 1500)
check("back to the grid", await page.locator(".cm-grid [data-card]").count() >= 4)
check("switching views changed nothing on disk", (await disk()) === was)
await ctx.close()

// Nothing side by side (one block between text): read and edited at a note's width, centred, the card as wide as the
// text; a callout after a table keeps its gap.
await write(`${FM}A line about the page.\n\n\`\`\`block-agenda\n\`\`\`\n\n## Notes\n\n| Thing | Value |\n| --- | --- |\n| One | 1 |\n\n> [!note] After the table\n\nA last line.\n`); await wait(800)
const lone = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 })
const lp = watch(await lone.newPage(), { label: "lone" })
const lbox = async (sel) => (await lp.locator(sel).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
await lp.goto(`${B}#file/${enc(PAGE)}`); await wait(2000)
if ((await lp.locator(".file-view .cm-content[contenteditable=true]").count()) > 0) await palette(lp, "Switch to reading view")
const lv = await lbox(".file-view"), lpane = await lp.locator(".file-view").first().evaluate((e) => { const r = e.parentElement.getBoundingClientRect(); return { x: r.x, width: r.width } })
const lc = await lbox('.file-view [data-line]:has([data-block="agenda"])'), lt = await lbox(".dash-prose")
check(`lone block: a note's width, centred (${Math.round(lv.x)}+${Math.round(lv.width)} in ${Math.round(lpane.x)}+${Math.round(lpane.width)})`,
  lv.width < 760 && Math.abs((lv.x - lpane.x) - (lpane.x + lpane.width - lv.x - lv.width)) < 4)
check(`lone block: the card as wide as the text (${Math.round(lc.width)} / ${Math.round(lt.width)})`, Math.abs(lc.width - lt.width) < 2 && Math.abs(lc.x - lt.x) < 2)
const gap = await lp.locator(".dash-prose .callout").first().evaluate((e) => e.getBoundingClientRect().top - e.previousElementSibling.getBoundingClientRect().bottom)
check(`a callout after a table keeps its gap (${gap})`, gap >= 8)
await lp.screenshot({ path: `${OUT}dashboardedit-lone.png` })
await palette(lp, "Switch to live preview", 1500)
const le = await lbox(".file-view"), lec = await lbox('[data-card="agenda"]')
check(`lone block: editing keeps the width and the card's (${Math.round(le.width)}, ${Math.round(lec.width)} / ${Math.round(lc.width)})`, Math.abs(le.width - lv.width) < 2 && Math.abs(lec.width - lc.width) < 40)
await lone.close()

// A phone: one column, bars showing at a finger's size, text typed, a card moved with a held finger.
await write(START); await wait(800)
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = watch(await phone.newPage(), { label: "phone" })
await pp.goto(`${B}#file/${enc(PAGE)}`); await wait(2200)
if (!(await pp.locator(".file-view .cm-content[contenteditable=true]").count())) { await pp.locator("[data-view-toggle]").first().tap(); await wait(1500) }
check("phone: into editing", (await pp.locator(".file-view .cm-content[contenteditable=true]").count()) > 0)
const pa = await pp.locator('[data-card="agenda"]').boundingBox(), pw = await pp.locator('[data-card="week-goals"]').boundingBox()
check("phone: one column", pa && pw && Math.abs(pa.x - pw.x) < 2 && pw.y > pa.y + 20)
const pbtn = await pp.locator('[data-card="agenda"] button[aria-label="Move"]').boundingBox()
check(`phone: the bar shows, its buttons a finger's size (${pbtn?.width}x${pbtn?.height})`, pbtn && pbtn.width >= 44 && pbtn.height >= 44
  && await pp.locator('[data-card="agenda"] .cm-block-bar').evaluate((e) => getComputedStyle(e).opacity === "1"))
await pp.screenshot({ path: `${OUT}dashboardedit-phone.png` })
await pp.locator(".cm-content > .cm-line", { hasText: "A line about the page." }).tap(); await wait(300)
await pp.keyboard.press("End"); await pp.keyboard.type(" Phone.")
t = await saved((x) => x.includes("Phone."))
check("phone: text typed in its row is saved", t === START.replace("the page.", "the page. Phone."), t)
// (people-wants, stacked under week-goals, held by its grip and dragged onto agenda's upper half: its own cell before it)
const { touch } = await fingers(pp)
await pp.evaluate(() => document.querySelector('[data-card="week-goals"]')?.scrollIntoView({ block: "center" })); await wait(400)
const from = await pp.locator('[data-card="people-wants"] button[aria-label="Move"]').boundingBox(), to = await pp.locator('[data-cell] [data-card="agenda"]').boundingBox()
if (from && to) {
  const x = from.x + 22, y0 = from.y + 22, y1 = Math.max(to.y + to.height * 0.3, 120)
  await touch("touchStart", x, y0); await wait(700)
  for (let i = 1; i <= 14; i++) { await touch("touchMove", x + (to.x + 60 - x) * i / 14, y0 + (y1 - y0) * i / 14); await wait(30) }
  await pp.screenshot({ path: `${OUT}dashboardedit-phone-drag.png` })
  await touch("touchEnd")
}
t = await saved((x) => fences(x).startsWith("people-wants"))
check(`phone: a card held and dragged moves its fence, no longer stacked (${fences(t)})`, fences(t) === "people-wants,agenda,week-goals,inbox"
  && t.includes("```block-people-wants\n```\n\n```block-agenda") && t.includes("A line about the page. Phone."), t)
check("phone: holding the grip opens no menu", !(await pp.locator("[role=menu]").count()))
await phone.close()
await fetch(`${B}api/file?path=${enc(PAGE)}`, { method: "DELETE" })
await done()
