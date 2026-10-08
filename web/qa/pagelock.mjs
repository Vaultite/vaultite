// The page held still under the overlays at iPhone size (core/pagelock.ts): a long note scrolled down, then the
// search palette, the command palette from the bar's menu (one overlay handing to the next), and the left drawer, each
// with a vertical swipe on it. While one is up the page doesn't move, and once it's gone the page is where it was.
// WRITES a note (Notes/Qa page lock.md) to the vault: run it against a throwaway server:
//   QA_BASE=http://127.0.0.1:8799/ node web/qa/pagelock.mjs <vault path>
// Desktop Chrome has no iOS keyboard: the scroll iOS does to show a focused field isn't reproduced, only the lock.
import { writeFileSync, mkdirSync } from "node:fs"
import { fingers, qa } from "./lib/qa.mjs"
const B = process.env.QA_BASE ?? "http://127.0.0.1:8799/"
const { args: [VAULT], browser, check, watch, done } = await qa(import.meta.url)
const NOTE = "Notes/Qa page lock.md"
mkdirSync(`${VAULT}/Notes`, { recursive: true })
writeFileSync(`${VAULT}/${NOTE}`, `# Qa page lock\n\n${Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of a long note.\n`).join("\n")}`)

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = watch(await ctx.newPage())
const { swipe } = await fingers(page)
/** Where the page is (its scroll: the lock never moves it) and whether it's locked. */
const at = () => page.evaluate(() => ({ y: scrollY, locked: document.documentElement.style.overflow === "hidden" }))
/** Where a line of the note is on screen: the first one showing below the header, when first asked (the editor draws
 *  only the lines near the screen). */
let shown = null
const line = () => page.evaluate((t) => {
  const ls = [...document.querySelectorAll(".cm-line")].filter((l) => /^Line \d+/.test(l.textContent))
  const l = t ? ls.find((x) => x.textContent === t) : ls.find((x) => x.getBoundingClientRect().top > 120)
  return { text: l?.textContent ?? null, top: l ? Math.round(l.getBoundingClientRect().top) : null }
}, shown).then((r) => { shown ??= r.text; return r.top })

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await page.waitForTimeout(2000)
await page.evaluate(() => scrollTo(0, 600)); await page.waitForTimeout(200)
const y0 = (await at()).y, l0 = await line()
check(`the note scrolls (${y0})`, y0 > 300)
check(`a line of it is on screen (${shown} at ${l0})`, l0 !== null)

// The search palette: held while it's up, through a swipe on its backdrop; back where it was after.
await page.locator("[data-bar=menu]").tap(); await page.waitForTimeout(200)
await page.locator("[data-bar-menu=search]").tap(); await page.waitForTimeout(400)
let s = await at()
check(`search: the page is held at ${y0} (${JSON.stringify(s)})`, s.locked && s.y === y0)
await swipe(200, 750, 200, 300); await page.waitForTimeout(300)
check("search: a swipe doesn't move the page under it", (await line()) === l0)
await page.keyboard.press("Escape"); await page.waitForTimeout(400)
s = await at()
check(`search closed: the page is back at ${y0} (${JSON.stringify(s)})`, !s.locked && s.y === y0)

// The bar's menu, then Commands from it: the menu closes as the palette opens, and the page stays held throughout.
await page.locator("[data-bar=menu]").tap(); await page.waitForTimeout(300)
s = await at()
check(`menu: held (${JSON.stringify(s)})`, s.locked && s.y === y0)
await page.locator("#bar-menu [role=menuitem]", { hasText: "Commands" }).tap(); await page.waitForTimeout(400)
s = await at()
check(`commands: held (${JSON.stringify(s)})`, s.locked && s.y === y0 && (await page.locator("[role=dialog][aria-label='Command palette']").count()) === 1)
await page.keyboard.press("Escape"); await page.waitForTimeout(400)
s = await at()
check(`commands closed: back at ${y0} (${JSON.stringify(s)})`, !s.locked && s.y === y0)

// The left drawer: a vertical swipe on the shade beside it doesn't scroll the page.
await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await page.waitForTimeout(500)
s = await at()
check(`drawer: held (${JSON.stringify(s)})`, s.locked && s.y === y0)
await swipe(375, 700, 378, 250); await page.waitForTimeout(300)
check("drawer: a swipe on the shade doesn't move the page", (await at()).y === y0)
await page.keyboard.press("Escape"); await page.waitForTimeout(500)
s = await at()
check(`drawer closed: back at ${y0} (${JSON.stringify(s)})`, !s.locked && s.y === y0 && (await line()) === l0)

await done()
