// Companion proposals: a placeholder breathes where a change will land, then the proposal shows as tracked changes in
// the agent's colour (what goes struck through, what comes under it) with one card in the margin; none of it is in the
// file. The cursor in a change brings a bar (Accept Tab, Reject Esc, which of how many); ⌥] steps to the next; Tab
// takes it as the agent's (Review names it), Esc leaves it; Accept all takes the rest and its agent hears it once.
// WRITES "QA proposals/", the plugin's data.json and plugins.json: throwaway server only.
//   node web/qa/proposals.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/proposals-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const text = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return "" } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
/** An op as the companion's agent calls it (vau run by Claude Code). */
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const asUser = (id, params) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/web" }, body: JSON.stringify(params) }).then((r) => r.json())
const enc = encodeURIComponent

const plugins = JSON.parse(text(".vaultite/plugins.json") || "{}")
const want = ["companion", "activity"].filter((id) => !(plugins.enabled ?? []).includes(id))
if (want.length) {
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), ...want] }, null, 2))
  await wait(1500)
}
await api("PATCH", "config/plugin/companion", { mode: "quiet", comments: null })
await op("plugin.grant", { id: "activity", allow: false })
const DIR = "QA proposals", NOTE = `${DIR}/Trip plan.md`
rmSync(file(DIR), { recursive: true, force: true })
const BEFORE = "# Trip plan\n\nWe fly to Lisbon on Friday.\nThe hotel is near the river.\n\n## Budget\n\nAbout 900 euros.\n\n## Risks\n"
await api("PUT", "file", { path: NOTE, text: BEFORE })
await asUser("review.keep", { all: true })
await op("companion.next", { timeout: 0 })
await op("companion.clear")

const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("vaultite.prefs") || "{}"), rightSidebar: false })) } catch { /* private */ } })
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(`${B}/#file/${enc(NOTE)}`)
const editor = page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)
await editor.waitFor({ timeout: 10000 })
await wait(1200)

// A placeholder first: where the change will land, its agent and what it's writing.
let r = await op("companion.propose", { path: NOTE, pending: "Risks: checking the forecast", find: "## Risks" })
const pid = r.id
const pending = page.locator(".cm-companion-pending")
await pending.waitFor({ timeout: 4000 })
check("placeholder: under the line it comes after, with its agent and intent", /Claude\s+Risks: checking the forecast/.test(await pending.innerText()), await pending.innerText())
const card = page.locator(`[data-companion-note="${pid}"]`)
await card.waitFor({ timeout: 3000 })
check("placeholder: its card says it's writing", /is writing/.test(await card.innerText()), await card.innerText())
await page.screenshot({ path: `${OUT}pending.png` })

// Filled: tracked changes, one card; the file as it was.
const was = text(NOTE)
const AFTER = "# Trip plan\n\nWe fly to Lisbon on Thursday evening.\nThe hotel is near the river.\n\n## Budget\n\nAbout 1,100 euros, with the train to Sintra.\nFlights are paid.\n\n## Risks\n\n- Rain on Saturday: museums first.\n- The Sintra train fills up: book it ahead.\n"
r = await op("companion.propose", { id: pid, path: NOTE, text: AFTER, why: "Thursday flight, budget and risks" })
check("propose: filled with its id, three changes", r.id === pid && r.changes?.length === 3, r)
await until(async () => !(await pending.count()), 3000)
await page.locator(".cm-companion-coming").first().waitFor({ timeout: 3000 })
check("propose: what goes struck through in the line, what comes beside it", (await page.locator(".cm-companion-del").first().innerText()) === "Friday" && /Thursday evening/.test(await page.locator(".cm-companion-ins").first().innerText()))
check("propose: added lines under the line above, removed ones struck", (await page.locator(".cm-companion-coming").count()) === 2 && (await page.locator(".cm-companion-gone").count()) === 1 &&
  /Rain on Saturday/.test(await page.locator(".cm-companion-coming").last().innerText()), await page.locator(".cm-companion-coming").allInnerTexts())
check("propose: one card, proposes 3 changes, its why", /proposes[\s\S]*3 changes/.test(await card.innerText()) && /Thursday flight/.test(await card.innerText()), await card.innerText())
check("propose: none of it is in the file", text(NOTE) === was, text(NOTE))
check("propose: nothing on screen but the changes until the cursor is in one", !(await page.locator(".cm-companion-review").count()))
await page.screenshot({ path: `${OUT}proposal.png` })

// The cursor in a change: a bar, which of how many; Tab takes it.
await editor.getByText("We fly to Lisbon").click()
const bar = page.locator(".cm-companion-review")
await bar.waitFor({ timeout: 2000 })
check("bar: by the change the cursor is in: who, 1 of 3, Accept and Reject", /Claude · 1 of 3/.test(await bar.innerText()) && /Accept/.test(await bar.innerText()) && /Reject/.test(await bar.innerText()), await bar.innerText())
await page.screenshot({ path: `${OUT}bar.png` })
await page.keyboard.press("Tab")
await until(() => text(NOTE).includes("Thursday evening"), 5000)
check("Tab: takes it, saved; the others still proposed", text(NOTE).includes("We fly to Lisbon on Thursday evening.") && !text(NOTE).includes("Sintra") && /2 of 3 left/.test(await card.innerText()), [text(NOTE), await card.innerText()])
check("Tab: the editor's text is the note's (no Tab typed)", !(await editor.innerText()).includes("\t"))

// ⌥] to the next one; Esc leaves it.
await page.keyboard.press("Alt+]")
await wait(300)
check("⌥]: the cursor steps to the next change (the budget)", /2 of 3|1 of 2/.test(await bar.innerText()) && (await page.evaluate(() => getSelection()?.focusNode?.parentElement?.closest(".cm-line")?.textContent ?? "")).includes("900"),
  await bar.innerText())
await page.keyboard.press("Escape")
await until(async () => /1 of 3 left/.test(await card.innerText()), 3000)
check("Esc: leaves it, the text as it was", text(NOTE).includes("About 900 euros.") && /1 of 3 left/.test(await card.innerText()), [text(NOTE), await card.innerText()])

// Accept all on the card: the rest taken, it closes, its agent hears it once.
await card.click()
await card.getByRole("button", { name: "Accept all" }).click()
await until(() => text(NOTE).includes("book it ahead"), 5000)
await card.waitFor({ state: "detached", timeout: 3000 })
check("Accept all: the rest is in the note, the card gone", text(NOTE).includes("- Rain on Saturday: museums first.") && text(NOTE).includes("About 900 euros."), text(NOTE))
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.item === pid) ? x : null }, 5000)
check("Accept all: its agent hears what was taken, once", r?.moments.filter((m) => m.item === pid).length === 1 && /took 2 of 3 changes/.test(r.moments.find((m) => m.item === pid).text), r?.moments)

// What it took is the agent's: Review names Claude.
const rev = await until(async () => (await api("GET", "review")).files?.find((f) => f.path === NOTE && f.by.includes("Claude")), 8000)
check("taken changes are Claude's in Review", !!rev, (await api("GET", "review")).files?.filter((f) => f.path === NOTE))
await page.screenshot({ path: `${OUT}taken.png` })

// A big edit comes as a proposal; ⌘Z isn't needed to undo what never landed.
await wait(1500)
const now = text(NOTE)
r = await op("companion.edit", { path: NOTE, find: now.slice(now.indexOf("We fly"), now.indexOf("## Risks")), text: "One short paragraph.\n\n" })
check("edit: more than 6 lines replaced comes as a proposal", r.how === "proposed" && text(NOTE) === now, r)
await page.locator(`[data-companion-note="${r.id}"]`).waitFor({ timeout: 3000 })
await page.locator(`[data-companion-note="${r.id}"]`).getByRole("button", { name: "Reject all" }).click()
await page.locator(`[data-companion-note="${r.id}"]`).waitFor({ state: "detached", timeout: 3000 })
await until(async () => !(await page.locator(".cm-companion-gone, .cm-companion-coming").count()), 2000)
check("Reject all: gone, the note as it was", text(NOTE) === now && !(await page.locator(".cm-companion-gone, .cm-companion-coming").count()), { same: text(NOTE) === now, drawn: await page.locator(".cm-companion-gone, .cm-companion-coming").allInnerTexts() })

// A table's change, cell by cell under the table: old struck, new in its colour; its own Accept.
const TABLE = `${DIR}/Packing.md`
await api("PUT", "file", { path: TABLE, text: "# Packing\n\n| Item | Who | Done |\n| --- | --- | --- |\n| Tent | Alice | no |\n| Stove | Ben | yes |\n\nThat's it.\n" })
await page.goto(`${B}/#file/${enc(TABLE)}`)
await page.locator(`.file-view[data-path="${TABLE}"]:visible .cm-content`).waitFor({ timeout: 10000 })
await wait(1000)
const tableWas = text(TABLE)
r = await op("companion.propose", { path: TABLE, text: "# Packing\n\n| Item | Who | Done |\n| --- | --- | --- |\n| Tent | Alice | yes |\n| Stove | Ben | yes |\n| Maps | Chloe | no |\n\nThat's it.\n", why: "Tent packed, maps added" })
check("table: proposed, two changes (a cell, a row)", r.changes?.length === 2, r)
const cells = page.locator(".cm-companion-cells")
await cells.first().waitFor({ timeout: 3000 })
const [cell, row] = [cells.nth(0), cells.nth(1)]
check("table: under the table, the changed cell old struck and new in its colour; the new row in its colour",
  (await cell.locator("del").allInnerTexts()).join() === "no" && (await cell.locator("ins").allInnerTexts()).join() === "yes" &&
  /Maps\s+Chloe\s+no/.test(await row.locator(".cm-companion-row-come").innerText()) && (await cell.locator("th").allInnerTexts()).join() === "Item,Who,Done", await cells.allInnerTexts())
check("table: a changed row's other cells stay plain; the row it was found by isn't drawn; the file as it was",
  /Tent\s+Alice/.test(await cell.locator("tbody tr").innerText()) && (await row.locator("tbody tr").count()) === 1 && text(TABLE) === tableWas, await cells.allInnerTexts())
await page.screenshot({ path: `${OUT}table.png` })
await cell.getByRole("button", { name: "Accept" }).click()
await until(() => text(TABLE).includes("| Tent | Alice | yes |"), 5000)
await until(async () => (await cells.count()) === 1, 3000)
await cells.first().getByRole("button", { name: "Accept" }).click()
await until(() => text(TABLE).includes("| Maps | Chloe | no |"), 5000)
check("table: Accept takes each, the table as proposed", text(TABLE).includes("| Tent | Alice | yes |\n| Stove | Ben | yes |\n| Maps | Chloe | no |"), text(TABLE))
await until(async () => !(await cells.count()), 3000)
check("table: its block goes", !(await cells.count()))

await ctx.close()
await op("companion.clear")
rmSync(file(DIR), { recursive: true, force: true })
for (const fn of restore) fn()
await done()
