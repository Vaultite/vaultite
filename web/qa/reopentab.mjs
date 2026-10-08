// Reopen closed tab (⌘⇧T in the desktop app; the command palette on the web: core/workspace.ts reopenTab): the tab
// closed last comes back where it was, with its history; several in a row come back in order; Close other tabs is
// undone tab by tab; a blank tab left by closing the last one makes way; a deleted file's tab isn't reopened; the
// command is hidden with nothing to reopen. WRITES (deletes a note): throwaway only.
//   node web/qa/reopentab.mjs <base url> <vault path>
import { readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const notes = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 4).map((f) => `Notes/${f}`)
if (notes.length < 4) { console.error("the vault needs four notes in Notes/"); process.exit(2) }
const [a, b, c, d] = notes
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
await page.goto(B)
await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
const ws = () => page.evaluate(() => JSON.parse(localStorage.getItem("vaultite.tabs")))
const groupOf = (w) => (function walk(n) { return n.tabs ? n : walk(n.kids[0]) })(w.root)
/** The focused pane's tabs, as their files ("new" for a blank one), and the active one. */
const tabs = async () => { const g = groupOf(await ws()); return { tabs: g.tabs.map((t) => t.to.replace(/^file:/, "")), active: g.tabs.find((t) => t.id === g.active)?.to.replace(/^file:/, "") } }
const open = async (f) => { await command(page, "Open new tab"); await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`); await until(async () => (await tabs()).active === f) }

await command(page, "Close all other tabs")
await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(a)}`)
await until(async () => (await tabs()).active === a)
for (const f of [b, c, d]) await open(f)
check("four tabs open", same((await tabs()).tabs, [a, b, c, d]), await tabs())
// b's history: it went to a's place and back.
check("nothing to reopen yet: the command isn't listed", !(await command(page, "Reopen closed tab")))

// One tab, from the middle: back where it was.
await page.click(`[data-tab-id] >> text=${path.basename(b, ".md")}`)
await command(page, "Close current tab")
check("closed", same((await tabs()).tabs, [a, c, d]), await tabs())
check("reopened", await command(page, "Reopen closed tab"))
check("back in its place, active", await until(async () => same(await tabs(), { tabs: [a, b, c, d], active: b })), await tabs())

// Several in a row: last closed first.
await page.click(`[data-tab-id] >> text=${path.basename(d, ".md")}`); await command(page, "Close current tab")
await page.click(`[data-tab-id] >> text=${path.basename(a, ".md")}`); await command(page, "Close current tab")
check("two closed", same((await tabs()).tabs, [b, c]), await tabs())
await command(page, "Reopen closed tab")
check("the last closed first", same(await tabs(), { tabs: [a, b, c], active: a }), await tabs())
await command(page, "Reopen closed tab")
check("then the one before", same(await tabs(), { tabs: [a, b, c, d], active: d }), await tabs())

// Close other tabs, undone tab by tab, in order.
await page.click(`[data-tab-id] >> text=${path.basename(b, ".md")}`); await command(page, "Close all other tabs")
check("others closed", same((await tabs()).tabs, [b]), await tabs())
for (let i = 0; i < 3; i++) await command(page, "Reopen closed tab")
check("all back, in order", same((await tabs()).tabs, [a, b, c, d]), await tabs())

// The last tab closed leaves a blank one; reopening replaces it.
await page.click(`[data-tab-id] >> text=${path.basename(a, ".md")}`); await command(page, "Close all other tabs"); await command(page, "Close current tab")
check("a blank tab left", same((await tabs()).tabs, ["new"]), await tabs())
await command(page, "Reopen closed tab")
check("the blank tab made way", same((await tabs()).tabs, [a]), await tabs())

// A file deleted after its tab closed: skipped.
await open(d); await command(page, "Close current tab")
rmSync(path.join(VAULT, d))
await wait(1500)
await command(page, "Reopen closed tab")
check("a deleted file's tab isn't reopened", !(await tabs()).tabs.includes(d), await tabs())
await done()
