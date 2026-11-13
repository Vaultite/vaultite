// On a phone the caret stays in sight and what acts at it acts where you read, a made-up keyboard up too.
// WRITES a note: throwaway server only.
//   node web/qa/keyboardsight.mjs <base url> <vault path>
// Paths: core/sight.ts, editor/sight.ts
import { unlinkSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const NOTE = `Notes/Qa keyboard sight ${Date.now() % 100000}.md`
const para = (i) => `Paragraph ${i}: ${"words to make the note long enough to scroll on a phone. ".repeat(4)}`
writeFileSync(`${VAULT}/${NOTE}`, `---\ntype: note\nid: note-qa-keyboard-sight\ncreated: '2026-01-01 09:00:00'\nupdated: '2026-01-01 09:00:00'\n---\n\n${Array.from({ length: 30 }, (_, i) => `## Part ${i}\n\n${para(i)}`).join("\n\n")}\n`)

const KB = 320
const page = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
await page.addInitScript((kb) => {
  const vv = window.visualViewport, h = Object.getOwnPropertyDescriptor(VisualViewport.prototype, "height").get
  Object.defineProperty(vv, "height", { get: () => h.call(vv) - (window.__kb ? kb : 0) })
  window.__keyboard = (on) => { window.__kb = on; vv.dispatchEvent(new Event("resize")) }
}, KB)
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.locator(".file-view .cm-content").first().waitFor({ timeout: 30000 })
await wait(1200)

const state = () => page.evaluate(() => {
  const v = globalThis.__vaultite.modules["@vaultite"].currentEditor().view, head = v.state.selection.main.head
  const c = v.coordsAtPos(head), r = (s) => document.querySelector(s)?.getBoundingClientRect()
  const top = r("[data-phone-header]")?.bottom ?? 0, keys = r("[data-key-bar]")
  const bottom = keys?.height ? keys.top : Math.min(visualViewport.height, r("[data-phone-bar]")?.top ?? innerHeight)
  return { line: v.state.doc.lineAt(head).number, top: c && Math.round(c.top), bottom: c && Math.round(c.bottom), seen: [Math.round(top), Math.round(bottom)],
    editable: v.contentDOM.contentEditable === "true", focus: v.hasFocus, text: v.state.doc.toString() }
})
const inSight = (s) => !!s.top && s.top >= s.seen[0] - 1 && s.bottom <= s.seen[1] + 1
const yOf = (n) => page.evaluate((n) => { const v = globalThis.__vaultite.modules["@vaultite"].currentEditor().view; return Math.round(v.documentTop + v.lineBlockAt(v.state.doc.line(n).from).top) }, n)

check("a phone opens the note for reading", !(await state()).editable)
await page.evaluate(() => scrollTo(0, 2400))
const read = await until(async () => { const s = await state(); return inSight(s) && s }, 3000)
check("scrolled while reading, the caret follows to the first line in sight", !!read, await state())

const at = await yOf(read.line)
await page.evaluate(() => globalThis.__vaultite.modules["@vaultite"].runCommandById("companion:ask"))
const card = page.locator("[data-companion-note=draft]")
const field = card.locator("input, textarea").first()
check("Ask opens a card to write in, @ the companion", !!(await until(async () => /^@\w+/.test(await field.inputValue().catch(() => "")) && field.evaluate((e) => e === document.activeElement), 4000)))
check("…on the line read", !!(await until(() => page.evaluate((n) => {
  const v = globalThis.__vaultite.modules["@vaultite"].currentEditor().view
  return v.state.doc.lineAt(v.state.selection.main.head).number === n
}, read.line), 2000)))
await wait(3000) // (the editor settles within 3 s)
check("…the line read held where it was", Math.abs((await yOf(read.line)) - at) <= 12, { was: at, now: await yOf(read.line) })
await page.keyboard.press("Escape")
await until(async () => !(await card.count()), 2000)
await page.locator("[data-view-toggle]").first().tap()
await until(async () => (await state()).editable, 4000)

const low = await page.evaluate(() => {
  const v = globalThis.__vaultite.modules["@vaultite"].currentEditor().view
  const pos = v.posAtCoords({ x: 60, y: 700 })
  v.dispatch({ selection: { anchor: pos } })
  return pos
})
check("a line low on the screen has the caret", low !== null)
await page.evaluate(() => window.__keyboard(true))
await until(() => page.locator("[data-key-bar]").count(), 2000)
check("keyboard up: the caret is moved above the keys", !!(await until(async () => inSight(await state()), 2000)), await state())
const before = (await state()).top
for (let i = 0; i < 6; i++) { await page.keyboard.press("Enter"); await wait(60) }
await wait(300)
check("typing new lines, the caret stays above the keys", inSight(await state()), { before, now: await state() })

await page.evaluate(() => window.__keyboard(false))
unlinkSync(`${VAULT}/${NOTE}`)
await done()
