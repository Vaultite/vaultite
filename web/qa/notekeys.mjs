// Phones: the keys over the keyboard, a note's (bold, undo, indent, Hide keyboard) and a terminal's, on a made-up
// keyboard (the visual viewport cut short). Writes and starts a shell: throwaway servers.
//   node web/qa/notekeys.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fingers, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/notekeys-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const KB = 300
const W = `wander${Date.now() % 100000}` // (a word of this run's: the note keeps earlier runs' lines)
const page = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
// The keyboard: while `__kb`, the visual viewport is KB short of the window.
await page.addInitScript((kb) => {
  const vv = window.visualViewport, h = Object.getOwnPropertyDescriptor(VisualViewport.prototype, "height").get
  Object.defineProperty(vv, "height", { get: () => h.call(vv) - (window.__kb ? kb : 0) })
  window.__keyboard = (on) => { window.__kb = on; vv.dispatchEvent(new Event("resize")) }
}, KB)
const { touch } = await fingers(page)
const tap = async (loc) => {
  // (the row scrolls sideways: the key brought into it first)
  await loc.evaluate((e) => e.scrollIntoView({ inline: "nearest", block: "nearest" })); await wait(100)
  const b = await loc.boundingBox()
  await touch("touchStart", b.x + b.width / 2, b.y + b.height / 2); await wait(40); await touch("touchEnd", b.x + b.width / 2, b.y + b.height / 2); await wait(250)
}
const text = () => page.evaluate(() => globalThis.__vaultite.modules["@vaultite"].currentEditor()?.view.state.doc.toString() ?? "")
const bar = page.locator("[role=toolbar][aria-label='Editing keys']")
const key = (name) => bar.locator(`button[aria-label='${name}']`)

await page.goto(`${B}#file/${encodeURIComponent("Notes/Lisbon trip.md")}`)
const content = page.locator(".file-view .cm-content").first()
await content.waitFor({ timeout: 30000 })
check("no keys before typing", !(await bar.count()))

// Typing at the end of the note, the keyboard up.
// (a phone opens a note for reading: the pencil makes it editable)
if (await page.locator("[data-view-toggle=read]").count()) { await tap(page.locator("[data-view-toggle=read]").first()); await wait(500) }
await content.click()
// (the note's body made one line of this run's, the cursor after it; then typed, as a phone would)
await page.evaluate(() => {
  const { view, start } = globalThis.__vaultite.modules["@vaultite"].currentEditor()
  const from = start(view.state)
  view.dispatch({ changes: { from, to: view.state.doc.length, insert: "Plans\n\n" }, selection: { anchor: from + 7 } })
})
await page.keyboard.type(`- ${W}`)
await page.evaluate(() => window.__keyboard(true)); await wait(300)
check("the keys come up with the keyboard", await bar.count() === 1)
const box = await bar.boundingBox()
check("over the keyboard, at the visible part's foot", !!box && Math.abs(box.y + box.height - (844 - KB)) <= 2, box)
const names = await bar.locator("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")))
check("the default keys, then Hide keyboard", names.join() === "Undo,Redo,Link,Task,Unindent,Indent,Bold,Italic,Highlight,Bullet list,Photo,Hide keyboard", names)
await page.screenshot({ path: path.join(OUT, "keys.png") })

await tap(key("Bold"))
check("Bold: the word at the cursor", (await text()).includes(`- **${W}**`), (await text()).split("\n").filter((l) => l.includes(W)))
check("the editor kept the keyboard", await page.evaluate(() => document.activeElement?.classList.contains("cm-content")))
await tap(key("Undo"))
check("Undo: bold gone", !(await text()).includes(`**${W}**`), (await text()).split("\n").filter((l) => l.includes(W)))
await tap(key("Redo"))
check("Redo: bold back", (await text()).includes(`- **${W}**`))
await tap(key("Indent"))
check("Indent: the item one level in (a tab, the editor's default)", (await text()).includes(`\n\t- **${W}**`), (await text()).split("\n").filter((l) => l.includes(W)))
await tap(key("Unindent"))
check("Unindent: back out", (await text()).includes(`\n- **${W}**`), (await text()).split("\n").filter((l) => l.includes(W)))
await tap(key("Task"))
check("Task: a checkbox", (await text()).includes(`\n- [ ] **${W}**`), (await text()).split("\n").filter((l) => l.includes(W)))

await tap(bar.locator("button[aria-label='Hide keyboard']"))
await page.evaluate(() => window.__keyboard(false))
check("Hide keyboard: the editor lets go, the keys go", !!await until(async () => !(await bar.count()), 2000)
  && !(await page.evaluate(() => document.activeElement?.classList.contains("cm-content"))))
// The terminal's keys are the same bar: esc to paste, then Hide keyboard.
await page.goto(`${B}#view/terminal%2Fnotekeys-${Date.now()}`)
const term = page.locator("[data-terminal] .xterm-helper-textarea")
await term.waitFor({ state: "attached", timeout: 30000 })
await tap(page.locator("[data-terminal]")); await term.focus()
await page.evaluate(() => window.__keyboard(true)); await wait(400)
const tkeys = await page.locator("[role=toolbar][aria-label='Terminal keys'] button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")))
check("terminal: its keys over the keyboard", tkeys.join() === "Escape,Tab,Shift Tab,Control C,Left,Up,Down,Right,Paste,Hide keyboard", tkeys)
await page.screenshot({ path: path.join(OUT, "terminal.png") })
await page.close()

// A computer never shows them.
const desk = watch(await browser.newPage({ viewport: { width: 1400, height: 900 } }))
await desk.goto(`${B}#file/${encodeURIComponent("Notes/Lisbon trip.md")}`)
await desk.locator(".file-view .cm-content").first().click()
await wait(400)
check("desktop: no keys", !(await desk.locator("[role=toolbar][aria-label='Editing keys']").count()))
await desk.close()
console.log(`\nshots in ${OUT}`)
await done()
