// Phones: what acts at the caret acts where you're reading, and the caret stays in sight (core/sight.ts, editor/sight.ts).
// Scrolled while reading, the caret follows; Ask from reading opens editing on that line, the line read held still; with
// the keyboard up (a made-up one: the visual viewport cut short) the caret stays clear of the keys over it, as it's typed
// on too. iOS's own scrolling isn't in Chrome: check that on an iPhone. WRITES a note: throwaway server only.
//   node web/qa/keyboardsight.mjs <base url> <vault path>
import { unlinkSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

// (one of its own per run: a note opens where it was left)
const NOTE = `Notes/Qa keyboard sight ${Date.now() % 100000}.md`
const para = (i) => `Paragraph ${i}: ${"words to make the note long enough to scroll on a phone. ".repeat(4)}`
// (with the fields the server stamps on a note's first save: stamped mid-run, they'd move every line down)
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

/** The caret: its line, where it's drawn, and what of the screen shows the text (under the header, over the bars). */
const state = () => page.evaluate(() => {
  const v = globalThis.__vaultite.modules["@vaultite"].currentEditor().view, head = v.state.selection.main.head
  const c = v.coordsAtPos(head), r = (s) => document.querySelector(s)?.getBoundingClientRect()
  const top = r("[data-phone-header]")?.bottom ?? 0, keys = r("[data-key-bar]")
  const bottom = keys?.height ? keys.top : Math.min(visualViewport.height, r("[data-phone-bar]")?.top ?? innerHeight)
  return { line: v.state.doc.lineAt(head).number, top: c && Math.round(c.top), bottom: c && Math.round(c.bottom), seen: [Math.round(top), Math.round(bottom)],
    editable: v.contentDOM.contentEditable === "true", focus: v.hasFocus, text: v.state.doc.toString() }
})
const inSight = (s) => !!s.top && s.top >= s.seen[0] - 1 && s.bottom <= s.seen[1] + 1
/** Where a line's top is drawn. */
const yOf = (n) => page.evaluate((n) => { const v = globalThis.__vaultite.modules["@vaultite"].currentEditor().view; return Math.round(v.documentTop + v.lineBlockAt(v.state.doc.line(n).from).top) }, n)

check("a phone opens the note for reading", !(await state()).editable)
await page.evaluate(() => scrollTo(0, 2400))
const read = await until(async () => { const s = await state(); return inSight(s) && s }, 3000)
check("scrolled while reading, the caret follows to the first line in sight", !!read, await state())

// Ask from reading: the question's line where you are, into editing on it, the line read where it was.
const at = await yOf(read.line)
await page.evaluate(() => globalThis.__vaultite.modules["@vaultite"].runCommandById("companion:ask"))
const asked = await until(async () => { const s = await state(); return s.editable && /@\w+ $/m.test(s.text) && s }, 4000)
const mention = asked ? asked.text.split("\n").findIndex((l) => /^@\w+ $/.test(l)) + 1 : -1
check("Ask writes its line next to the one read", mention > 0 && Math.abs(mention - read.line) <= 2, { mention, read: read.line })
check("…in editing, the caret after it", !!asked && asked.line === mention, asked && asked.line)
// (held while the editor settles: 3 s at most)
await wait(3000)
check("…the line read held where it was", Math.abs((await yOf(read.line)) - at) <= 12, { was: at, now: await yOf(read.line) })

// The keyboard comes up over the caret: it's kept above the keys.
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
