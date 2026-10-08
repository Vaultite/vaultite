// Stacked tabs (components/Workspace.tsx Stacked; Toggle stacked tabs, the tab menu's Stack tabs): a
// pane's tabs side by side, each with its title on a spine; the active one in full view (scrolled to when another tab
// is picked in the bar), and the one the keyboard and commands act on (#main-scroll); a click in another makes it the
// active one; the setting survives a reload; Unstack puts them back. WRITES nothing.
//   node web/qa/stacked.mjs <base url> <vault path> [out dir]
import { mkdirSync, readdirSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/stacked-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const notes = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 4).map((f) => `Notes/${f}`)
const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }))
await page.goto(B)
await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
await command(page, "Close all other tabs")
await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(notes[0])}`); await wait(400)
for (const f of notes.slice(1)) { await command(page, "Open new tab"); await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`); await wait(400) }

check("Toggle stacked tabs", await command(page, "Toggle stacked tabs"))
const cols = page.locator("[data-stacked-tab]")
check("every tab drawn, side by side", await until(async () => (await cols.count()) === notes.length), await cols.count())
check("a spine for each, with its title", (await page.locator("[data-stack-spine]").count()) === notes.length)
const box = async (i) => cols.nth(i).boundingBox()
const pane = await page.locator("[data-stack]").boundingBox()
// In full view: inside the pane, and the next tab (sliding over it) not over it.
const full = async (i) => {
  const b = await box(i), next = i + 1 < notes.length ? await box(i + 1) : null
  return b.x >= pane.x - 1 && b.x + b.width <= pane.x + pane.width + 1 && (!next || next.x >= b.x + b.width - 1)
}
check("the active one (the last) in full view", await until(() => full(notes.length - 1)), [await box(notes.length - 1), pane, await page.evaluate(() => document.querySelector("[data-stack]").scrollLeft)])
check("its editor is the pane's (#main-scroll)", await page.evaluate(() => !!document.querySelector(`#main-scroll`)?.closest("[data-stacked-tab]")))
await page.screenshot({ path: path.join(OUT, "stacked-last.png") })

// The first, from the bar: scrolled back to it.
await page.click(`[data-tab-id] >> nth=0`)
check("picking the first tab scrolls it into full view", await until(() => full(0)), await box(0))
check("the spines of the others wait at the right", await page.evaluate(() => {
  const s = [...document.querySelectorAll("[data-stack-spine]")].map((e) => e.getBoundingClientRect())
  const p = document.querySelector("[data-stack]").getBoundingClientRect()
  return s.slice(1).every((r) => r.right <= p.right + 1 && r.left >= p.left)
}))
await page.screenshot({ path: path.join(OUT, "stacked-first.png") })

// A click in a spine makes that tab the active one.
await page.click(`[data-stack-spine] >> nth=2`)
const active = () => page.evaluate(() => { const w = JSON.parse(localStorage.getItem("vaultite.tabs")); const g = (function walk(n) { return n.tabs ? n : walk(n.kids[0]) })(w.root); return g.tabs.findIndex((t) => t.id === g.active) })
check("a spine's click: its tab active", await until(async () => (await active()) === 2), await active())

await page.reload(); await page.waitForSelector("[data-stacked-tab]", { timeout: 15000 })
check("still stacked after a reload", (await cols.count()) === notes.length)
await page.click(`[data-tab-id] >> nth=0`, { button: "right" })
await page.click("[role=menu] >> text=Unstack tabs")
check("Unstack tabs: one tab shown again", await until(async () => (await cols.count()) === 0 && (await page.locator("[data-pane] .cm-content, [data-pane] article").count()) > 0))
await done()
