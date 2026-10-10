// The editor's suggestion lists ([[links, ![[embeds, [[Note#headings, the slash menu): Enter, Tab and a click pick and
// put the cursor after what went in (past the `]]` auto-pair typed, so typing on goes after the link), with auto-pair
// on and off; Escape closes the list, changes nothing, and it stays closed while typing on in that link (Ctrl-Space
// asks again); a canvas card's editor (Escape closes the list before ending editing) and a phone's tap do the same.
// WRITES a "Qa suggest" folder and .vaultite/editor.json (put back): throwaway server only.
//   node web/qa/suggest.mjs <base url> <vault path> [out dir]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const DIR = "Qa suggest", NOTE = `${DIR}/Typing here.md`, BOARD = `${DIR}/Board.canvas`
const put = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, text, base: null }) })
const read = (p) => { try { return readFileSync(`${VAULT}/${p}`, "utf8") } catch { return "" } }
/** Waits (up to 5 s) for the file on disk to pass `test` (the autosave is 600 ms after typing). */
const saved = async (test, p = NOTE) => { for (let i = 0; i < 50; i++) { if (test(read(p))) return true; await wait(100) } return false }
const EDITOR_JSON = `${VAULT}/.vaultite/editor.json`
const editorBefore = existsSync(EDITOR_JSON) ? readFileSync(EDITOR_JSON, "utf8") : null

await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await put(`${DIR}/Kick-off plan.md`, "# Kick-off plan\n\n## Agenda\n\nWho comes.\n\n## Budget\n\nHow much.\n")

/** A fresh page on the note (body `First line.`), editing, the cursor on a new line at its end. */
async function open(ctx, phone = false) {
  await put(NOTE, "First line.\n")
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(1800)
  if (phone) { await page.locator("[data-view-toggle]").click().catch(() => {}); await wait(600) }
  else if (!(await page.locator(".vau-editor .cm-content[contenteditable=true]").count())) { await page.keyboard.press("ControlOrMeta+e"); await wait(500) }
  const first = page.locator(".vau-editor .cm-line", { hasText: "First line." }).first()
  await (phone ? first.tap() : first.click())
  await page.keyboard.press("ControlOrMeta+ArrowDown"); await page.keyboard.press("Enter")
  return page
}
const menuOf = (page) => page.locator(".cm-tooltip-autocomplete")
// (Enter and Tab pick once the list shows it and has been open 75 ms, CodeMirror's interactionDelay)
const ready = async (page, name) => { await menuOf(page).locator("li[aria-selected]", { hasText: name }).waitFor({ timeout: 5000 }); await wait(120) }
const line = (text, s) => text.split("\n").find((l) => l.startsWith(s)) ?? text

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
let page = await open(ctx)
const menu = menuOf(page)

// The bug: [[Start, Enter, typing on went inside the link ([[Start here together. #ideas]]).
await page.keyboard.type("[[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Enter")
await page.keyboard.type(" together. #ideas"); await page.keyboard.press("Enter")
check("Enter: typing on goes after the link", await saved((t) => t.includes("[[Kick-off plan]] together. #ideas\n")), line(read(NOTE), "[[Kick"))
check("…and no list is left open", !(await menu.isVisible()))

await page.keyboard.type("![[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Tab")
await page.keyboard.type(" embedded"); await page.keyboard.press("Enter")
check("Tab picks too (an embed), the cursor after it, nothing indented", await saved((t) => t.includes("\n![[Kick-off plan]] embedded\n")), line(read(NOTE), "![[Kick"))

await page.keyboard.type("See [[Kick-off plan#Bud"); await ready(page, "Budget")
await page.screenshot({ path: `${OUT}suggest-headings.png` })
await menu.locator("li", { hasText: "Budget" }).click()
await page.keyboard.type(" first"); await page.keyboard.press("Enter")
check("a click on a heading: after [[Note#Heading]]", await saved((t) => t.includes("See [[Kick-off plan#Budget]] first\n")), line(read(NOTE), "See"))

// Escape: closed, nothing changed, and closed while typing on in the same link.
await page.keyboard.type("[[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Escape"); await wait(200)
check("Escape closes the list", !(await menu.isVisible()))
check("…changing nothing", await saved((t) => t.endsWith("\n[[Kick]]\n") || t.endsWith("\n[[Kick]]")), JSON.stringify(read(NOTE).slice(-40)))
check("…and the editor kept the focus", await page.evaluate(() => !!document.activeElement?.closest(".cm-content")))
await page.keyboard.type("-of"); await wait(500)
check("typing on in that link doesn't bring it back", !(await menu.isVisible()))
await page.keyboard.press("Control+Space"); await wait(400)
check("Ctrl-Space asks again", await menu.isVisible())
if (await menu.isVisible()) {
  await ready(page, "Kick-off plan"); await page.keyboard.press("Enter")
  await page.keyboard.type(" again"); await page.keyboard.press("Enter")
  check("…and a pick from it lands after the link", await saved((t) => t.includes("\n[[Kick-off plan]] again\n")), line(read(NOTE), "[[Kick-off plan]] a"))
}
await page.keyboard.type("Next [[Kick"); await wait(500)
check("a new [[ suggests again", await menu.isVisible())
await page.keyboard.press("Escape"); await wait(200)
await page.keyboard.press("End"); await page.keyboard.press("Enter")

// The slash menu: Tab picks, Escape closes it with the "/" kept.
await page.keyboard.type("/h2"); await ready(page, "Heading 2")
await page.keyboard.press("Tab"); await page.keyboard.type("Plans"); await page.keyboard.press("Enter")
check("slash menu: Tab picks, the cursor after the mark", await saved((t) => t.includes("\n## Plans\n")), line(read(NOTE), "##"))
await page.keyboard.type("/quo"); await wait(400)
await page.keyboard.press("Escape"); await wait(200)
check("slash menu: Escape closes it", !(await menu.isVisible()))
check("…keeping what was typed", await saved((t) => t.includes("\n/quo")))
await page.close()

// Auto-pair off: [[ has no ]] after it; a pick still ends after the link.
writeFileSync(EDITOR_JSON, JSON.stringify({ ...(editorBefore ? JSON.parse(editorBefore) : {}), autoPairBrackets: false }, null, 2) + "\n"); await wait(800)
page = await open(ctx)
await page.keyboard.type("[[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Enter"); await page.keyboard.type(" unpaired")
check("auto-pair off: after the link too", await saved((t) => t.includes("\n[[Kick-off plan]] unpaired")), line(read(NOTE), "[[Kick"))
await page.close()
if (editorBefore === null) rmSync(EDITOR_JSON, { force: true }); else writeFileSync(EDITOR_JSON, editorBefore)
await wait(800)

// A canvas card's editor (NoteEditor, its list drawn over the page): Escape closes the list, then ends editing.
await put(BOARD, JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Card text.", x: 0, y: 0, width: 320, height: 160 }], edges: [] }))
page = watch(await ctx.newPage())
await page.goto(`${B}#file/${encodeURIComponent(BOARD)}`); await wait(1800)
const card = page.locator('[data-canvas-node="a"]')
await card.dblclick()
await page.waitForSelector('[data-canvas-node="a"][data-editing] .cm-content')
await page.keyboard.press("ControlOrMeta+ArrowDown")
await page.keyboard.type(" [[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Enter"); await page.keyboard.type(" here")
await page.keyboard.type(" [[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Escape"); await wait(200)
check("card: Escape closes the list", !(await menuOf(page).isVisible()))
check("…and leaves the card editing", await card.evaluate((e) => e.hasAttribute("data-editing")))
await page.keyboard.press("Escape"); await wait(300)
check("…the next Escape ends editing", !(await card.evaluate((e) => e.hasAttribute("data-editing"))))
check("card: the pick went in, typing on after it", await saved((t) => t.includes("Card text. [[Kick-off plan]] here [[Kick]]"), BOARD), read(BOARD))
await page.close()
await ctx.close()

// A phone: a tap on a suggestion.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await open(ctx, true)
  await page.keyboard.type("[[Kick"); await ready(page, "Kick-off plan")
  await page.screenshot({ path: `${OUT}suggest-phone.png` })
  await menuOf(page).locator("li", { hasText: "Kick-off plan" }).tap()
  await page.keyboard.type(" tapped")
  check("phone: a tap picks, typing on goes after the link", await saved((t) => t.includes("\n[[Kick-off plan]] tapped")), line(read(NOTE), "[[Kick"))
  await ctx.close()
}

noErrors()
await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await done()
