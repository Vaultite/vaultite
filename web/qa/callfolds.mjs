// Foldable callouts in the editor (editor/livePreview.ts, core/heights.ts): one opened stays open when the note is
// left and opened again, and is drawn at the height of how it's folded, never held at the other's (an empty gap).
// Writes Qa folds/: throwaway server only.
//   node web/qa/callfolds.mjs <base url> <vault path>
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const DIR = "Qa folds", NOTE = `${DIR}/Report.md`, OTHER = `${DIR}/Other.md`, enc = encodeURIComponent
const section = (n) => `> [!note]- Section ${n}\n${Array.from({ length: 30 }, (_, i) => `> - Line ${i + 1} of section ${n}, long enough to wrap a little in a pane.`).join("\n")}\n`
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
writeFileSync(`${VAULT}/${NOTE}`, `# Report\n\nThe top.\n\n${[1, 2, 3, 4].map(section).join("\nBetween.\n\n")}\n${Array.from({ length: 120 }, (_, i) => `Filler ${i}.\n`).join("\n")}`)
writeFileSync(`${VAULT}/${OTHER}`, "# Other\n\nSomewhere else.\n")

const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
const page = watch(await ctx.newPage())
const go = async (p) => { await page.evaluate((h) => { location.hash = h }, `#file/${enc(p)}`); await page.waitForSelector(`[data-pane] .cm-content`, { timeout: 15000 }) }
// The first callout: whether it's open, its height and its content's (more than its content: held at a stale height).
const first = () => page.evaluate(() => {
  const el = document.querySelector("[data-pane] .cm-block-callout"), body = el?.querySelector(".cm-block-body"), d = el?.querySelector("details")
  return el && body && d ? { open: d.open, h: Math.round(el.getBoundingClientRect().height), content: Math.round(body.getBoundingClientRect().height) } : null
})
const settled = async (open) => until(async () => { const f = await first(); return f && f.open === open && Math.abs(f.h - f.content) < 12 ? f : null }, 1500)
const toggle = async () => { await page.locator("[data-pane] .cm-block-callout summary").first().click(); await wait(700) }
const comeBack = async () => { await go(OTHER); await wait(300); await go(NOTE); await until(first, 5000) }

await page.goto(`${B}#file/${enc(NOTE)}`)
await page.waitForSelector("[data-pane] .cm-block-callout details", { timeout: 15000 })
await wait(800)
const shut = await first()
check("drawn shut, as written", shut && !shut.open && shut.h < 120, shut)
await toggle()
const opened = await first()
check("opened: as tall as all its lines", opened?.open && opened.h > 500 && Math.abs(opened.h - opened.content) < 12, opened)

await comeBack()
check("left and opened again: still open, at its open height", await settled(true), await first())
await toggle()
check("shut again", await settled(false), await first())
await comeBack()
// (before: the height kept was the open one's, whatever its fold; drawn shut, it was held that tall for up to 4 s)
const back = await first()
check("left shut and opened again: shut, no empty room held below it", back && !back.open && Math.abs(back.h - back.content) < 12, back)

await toggle()
await page.reload()
await page.waitForSelector("[data-pane] .cm-block-callout details", { timeout: 15000 })
const fresh = await first()
check("reloaded (drawn as written): shut, not held at the open height", fresh && !fresh.open && Math.abs(fresh.h - fresh.content) < 12, fresh)

rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
await done()
