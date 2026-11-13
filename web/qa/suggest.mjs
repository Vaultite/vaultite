// The editor's suggestion lists ([[links, ![[embeds, #headings, #tags, the slash menu): picking puts the cursor after what
// went in, with auto-pair on and off; Escape. The graph's query fields' and Properties' too. WRITES "Qa suggest/", .vaultite/editor.json and
// the graph's settings (put back): throwaway only.
//   node web/qa/suggest.mjs <base url> <vault path> [out dir]
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const DIR = "Qa suggest", NOTE = `${DIR}/Typing here.md`, BOARD = `${DIR}/Board.canvas`
const put = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, text, base: null }) })
const read = (p) => { try { return readFileSync(`${VAULT}/${p}`, "utf8") } catch { return "" } }
/** Waits (up to 5 s) for the file on disk to pass `test` (the autosave is 600 ms after typing). */
const saved = async (test, p = NOTE) => !!(await until(() => test(read(p)), 5000))
const known = (p) => until(async () => (await fetch(`${B}api/state`).then((r) => r.text(), () => "")).includes(p), 5000)
const EDITOR_JSON = `${VAULT}/.vaultite/editor.json`
const editorBefore = existsSync(EDITOR_JSON) ? readFileSync(EDITOR_JSON, "utf8") : null

await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await put(`${DIR}/Kick-off plan.md`, "# Kick-off plan\n\n## Agenda\n\nWho comes.\n\n## Budget\n\nHow much.\n")

/** A fresh page on the note (body `First line.`), editing, the cursor on a new line at its end. */
async function open(ctx, phone = false) {
  await put(NOTE, "First line.\n")
  const page = watch(await ctx.newPage()), ui = app(page)
  const editable = page.locator(".vau-editor .cm-content[contenteditable=true]"), first = page.locator(".vau-editor .cm-line", { hasText: "First line." }).first()
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await first.waitFor(); await ui.idle()
  if (phone) await page.locator("[data-view-toggle]").click().catch(() => {})
  else if (!(await editable.count())) await page.keyboard.press("ControlOrMeta+e")
  await editable.waitFor(); await ui.idle()
  await (phone ? first.tap() : first.click())
  await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.press("Enter")
  return { page, ui }
}
const menuOf = (page) => page.locator(".cm-tooltip-autocomplete")
// (Enter and Tab pick once the list shows it and has been open 75 ms, CodeMirror's interactionDelay)
const pastInteractionDelay = () => wait(120)
const ready = async (page, name) => { await menuOf(page).locator("li[aria-selected]", { hasText: name }).waitFor({ timeout: 5000 }); await pastInteractionDelay() }
const line = (text, s) => text.split("\n").find((l) => l.startsWith(s)) ?? text

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
let { page, ui } = await open(ctx)
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
await page.keyboard.press("Escape"); await ui.idle()
check("Escape closes the list", !(await menu.isVisible()))
check("…changing nothing", await saved((t) => t.endsWith("\n[[Kick]]\n") || t.endsWith("\n[[Kick]]")), JSON.stringify(read(NOTE).slice(-40)))
check("…and the editor kept the focus", await page.evaluate(() => !!document.activeElement?.closest(".cm-content")))
await page.keyboard.type("-of"); await ui.idle()
check("typing on in that link doesn't bring it back", !(await menu.isVisible()))
await page.keyboard.press("Control+Space"); await menu.waitFor().catch(() => {})
check("Ctrl-Space asks again", await menu.isVisible())
if (await menu.isVisible()) {
  await ready(page, "Kick-off plan"); await page.keyboard.press("Enter")
  await page.keyboard.type(" again"); await page.keyboard.press("Enter")
  check("…and a pick from it lands after the link", await saved((t) => t.includes("\n[[Kick-off plan]] again\n")), line(read(NOTE), "[[Kick-off plan]] a"))
}
await page.keyboard.type("Next [[Kick"); await menu.waitFor().catch(() => {})
check("a new [[ suggests again", await menu.isVisible())
await page.keyboard.press("Escape"); await ui.idle()
await page.keyboard.press("End"); await page.keyboard.press("Enter")

// The slash menu: Tab picks, Escape closes it with the "/" kept.
await page.keyboard.type("/h2"); await ready(page, "Heading 2")
await page.keyboard.press("Tab"); await page.keyboard.type("Plans"); await page.keyboard.press("Enter")
check("slash menu: Tab picks, the cursor after the mark", await saved((t) => t.includes("\n## Plans\n")), line(read(NOTE), "##"))
await page.keyboard.type("/quo"); await menu.waitFor().catch(() => {})
await page.keyboard.press("Escape"); await ui.idle()
check("slash menu: Escape closes it", !(await menu.isVisible()))
check("…keeping what was typed", await saved((t) => t.includes("\n/quo")))
await ui.sees(".vaultite/editor.json", () => writeFileSync(EDITOR_JSON, JSON.stringify({ ...(editorBefore ? JSON.parse(editorBefore) : {}), autoPairBrackets: false }, null, 2) + "\n"))
await page.close()

// Auto-pair off: [[ has no ]] after it; a pick still ends after the link.
;({ page, ui } = await open(ctx))
await page.keyboard.type("[[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Enter"); await page.keyboard.type(" unpaired")
check("auto-pair off: after the link too", await saved((t) => t.includes("\n[[Kick-off plan]] unpaired")), line(read(NOTE), "[[Kick"))
await ui.sees(".vaultite/editor.json", () => { if (editorBefore === null) rmSync(EDITOR_JSON, { force: true }); else writeFileSync(EDITOR_JSON, editorBefore) })
await page.close()

// A canvas card's editor (NoteEditor, its list drawn over the page): Escape closes the list, then ends editing.
await put(BOARD, JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Card text.", x: 0, y: 0, width: 320, height: 160 }], edges: [] }))
page = watch(await ctx.newPage()); ui = app(page)
const card = page.locator('[data-canvas-node="a"]')
await page.goto(`${B}#file/${encodeURIComponent(BOARD)}`); await card.waitFor(); await ui.idle()
await card.dblclick()
await page.waitForSelector('[data-canvas-node="a"][data-editing] .cm-content')
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.type(" [[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Enter"); await page.keyboard.type(" here")
await page.keyboard.type(" [[Kick"); await ready(page, "Kick-off plan")
await page.keyboard.press("Escape"); await ui.idle()
check("card: Escape closes the list", !(await menuOf(page).isVisible()))
check("…and leaves the card editing", await card.evaluate((e) => e.hasAttribute("data-editing")))
await page.keyboard.press("Escape"); await ui.idle()
check("…the next Escape ends editing", !(await card.evaluate((e) => e.hasAttribute("data-editing"))))
check("card: the pick went in, typing on after it", await saved((t) => t.includes("Card text. [[Kick-off plan]] here [[Kick]]"), BOARD), read(BOARD))
await page.close()
await ctx.close()

// A phone: a tap on a suggestion.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const { page } = await open(ctx, true)
  await page.keyboard.type("[[Kick"); await ready(page, "Kick-off plan")
  await page.screenshot({ path: `${OUT}suggest-phone.png` })
  await menuOf(page).locator("li", { hasText: "Kick-off plan" }).tap()
  await page.keyboard.type(" tapped")
  check("phone: a tap picks, typing on goes after the link", await saved((t) => t.includes("\n[[Kick-off plan]] tapped")), line(read(NOTE), "[[Kick"))
  await ctx.close()
}

// #tags: the vault's, most used first; a whole tag typed leaves Enter to end the line.
await put(`${DIR}/Harbor plan.md`, "---\ntype: project\n---\n\nThe plan. #qaharbor #qaharbor/launch\n")
await put(`${DIR}/Harbor notes.md`, "Notes. #qaharbor\n")
await put(`${DIR}/Reading.md`, "Books. #qareading\n")
await known(`${DIR}/Reading.md`)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
  const { page, ui } = await open(ctx), menu = menuOf(page)
  await page.keyboard.type("About #qa"); await ready(page, "#qaharbor")
  const labels = await menu.locator("li .cm-completionLabel").allTextContents()
  check("#tags: the vault's, most used first", labels[0] === "#qaharbor" && labels.includes("#qareading") && labels.includes("#qaharbor/launch"), labels)
  await page.screenshot({ path: `${OUT}suggest-tags.png` })
  await page.keyboard.type("re"); await ready(page, "#qareading"); await page.keyboard.press("Enter")
  await page.keyboard.type("done")
  check("#tags: a pick goes in with a space after it", await saved((t) => t.includes("About #qareading done")), line(read(NOTE), "About"))
  await page.keyboard.press("Enter"); await page.keyboard.type("Whole #qaharbor"); await ui.idle()
  check("#tags: a whole tag typed shows no list", !(await menu.isVisible()))
  await page.keyboard.press("Enter"); await page.keyboard.type("next")
  check("…so Enter ends the line", await saved((t) => t.includes("Whole #qaharbor\nnext")), line(read(NOTE), "Whole"))

  // The graph's filter box: operators, then a type: or tag:'s values.
  const GRAPH_JSON = `${VAULT}/.vaultite/plugins/graph/data.json`
  const graphBefore = existsSync(GRAPH_JSON) ? readFileSync(GRAPH_JSON, "utf8") : null
  await page.goto("about:blank"); await page.goto(`${B}#view/graph`)
  const box = page.locator("[data-graph-search]"), sugg = page.locator("[data-suggestions] [role=option]")
  await box.waitFor(); await box.click(); await box.fill("")
  await sugg.first().waitFor({ timeout: 5000 }).catch(() => {})
  const ops = await sugg.allTextContents()
  check("graph: the empty filter box offers the operators", ops[0]?.startsWith("tag:") && ops.some((o) => o.startsWith("type:")), ops)
  await page.keyboard.press("ArrowDown")
  check("graph: an arrow moves the choice", !!(await until(async () => (await sugg.nth(1).getAttribute("aria-selected")) === "true", 2000)))
  await page.keyboard.type("t")
  check("...typing on starts it again at the first", !!(await until(async () => (await sugg.first().getAttribute("aria-selected")) === "true", 2000)), await sugg.allTextContents())
  await page.keyboard.press("Backspace")
  await page.keyboard.type("ty"); await page.keyboard.press("Enter"); await ui.idle()
  const types = await sugg.allTextContents()
  check("graph: picking type: lists the vault's types", await box.inputValue() === "type:" && types.some((t) => t.startsWith("project")), [await box.inputValue(), types])
  await page.keyboard.type("proj"); await ui.idle()
  await page.screenshot({ path: `${OUT}suggest-graph.png` })
  await page.keyboard.press("Enter"); await ui.idle()
  check("graph: a picked type goes in, the list gone", await box.inputValue() === "type:project " && !(await sugg.count()), await box.inputValue())
  await box.fill(""); await page.keyboard.type("-tag:#qah"); await ui.idle()
  const tagged = await sugg.allTextContents()
  check("graph: tag: lists tags with how many files have them, after a -", /^#qaharbor\d+$/.test(tagged[0] ?? ""), tagged)
  await page.keyboard.press("Escape"); await ui.idle()
  check("graph: Escape closes the list, keeping the text", !(await sugg.count()) && await box.inputValue() === "-tag:#qah", await box.inputValue())
  await box.fill(""); await ui.idle()
  // A group's search, its list over the panel.
  await page.locator("[data-graph-filters]").click(); await page.locator("[data-graph-add-group]").click()
  const field = page.locator("[data-graph-group-query]").last()
  await field.waitFor(); await page.keyboard.type("folder:Qa"); await ui.idle()
  const folders = await sugg.allTextContents()
  check("graph group: its search suggests folders", folders[0]?.startsWith("Qa suggest"), folders)
  await page.keyboard.press("Enter"); await ui.idle()
  check("graph group: the pick quoted for its space", await field.inputValue() === 'folder:"Qa suggest" ', await field.inputValue())
  await page.keyboard.press("Enter"); await ui.idle()
  const groupsSaved = () => { try { return JSON.parse(readFileSync(GRAPH_JSON, "utf8")).groups } catch { return null } }
  const groups = (await until(() => groupsSaved()?.some((g) => g.query === 'folder:"Qa suggest"') && groupsSaved())) || groupsSaved()
  check("graph group: Enter saves it", groups?.some((g) => g.query === 'folder:"Qa suggest"'), groups)
  if (graphBefore === null) rmSync(GRAPH_JSON, { force: true }); else writeFileSync(GRAPH_JSON, graphBefore)

  // Properties: a new property's name, then its values elsewhere; a tags list's chips from the vault's tags.
  const PROPS = `${DIR}/Props.md`
  await put(`${DIR}/Stage one.md`, "---\nqastage: shaping\n---\n\nOne.\n")
  await put(`${DIR}/Stage two.md`, "---\nqastage: shaping\n---\n\nTwo.\n")
  await put(`${DIR}/Stage three.md`, "---\nqastage: done\n---\n\nThree.\n")
  await put(PROPS, "---\ntype: note\n---\n\nBody.\n"); await known(`${DIR}/Stage three.md`); await known(PROPS)
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(PROPS)}`)
  await page.locator("[aria-label=Properties]").first().waitFor()
  const section = page.locator("[aria-label=Properties]").first()
  if (!(await section.locator("[role=table]").count())) await section.getByRole("button", { name: /Properties/ }).click()
  await section.getByRole("button", { name: "Add property" }).click()
  await page.keyboard.type("qast"); await ui.idle()
  const keys = await sugg.allTextContents()
  check("properties: a new name suggests the vault's names", keys[0] === "qastage3", keys)
  await page.keyboard.press("Enter")
  await sugg.first().waitFor({ timeout: 5000 }).catch(() => {})
  const vals = await sugg.allTextContents()
  check("properties: its value field, focused, lists the values it has elsewhere", vals.join() === "shaping2,done1", vals)
  await page.screenshot({ path: `${OUT}suggest-properties.png` })
  await page.keyboard.type("sh"); await ui.idle(); await page.keyboard.press("Enter")
  check("properties: Enter picks the value it completes", await saved((t) => /\nqastage: shaping\n/.test(t), PROPS), read(PROPS))
  const inputs = section.locator("input")
  for (let i = 0; i < await inputs.count(); i++) if (await inputs.nth(i).inputValue() === "shaping") { await inputs.nth(i).click(); break }
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("one"); await ui.idle()
  check("properties: a value that only has what's typed in it is listed, not picked", (await sugg.allTextContents()).join() === "done1" && await sugg.first().getAttribute("aria-selected") === "false")
  await page.keyboard.press("Enter")
  check("…so Enter keeps the new value", await saved((t) => /\nqastage: one\n/.test(t), PROPS), read(PROPS))
  await section.getByRole("button", { name: "Add property" }).click()
  await page.keyboard.type("tags"); await page.keyboard.press("Enter"); await ui.idle()
  await section.locator("[aria-label='Add an item']").click(); await page.keyboard.type("qah"); await ui.idle()
  const chips = await sugg.allTextContents()
  check("properties: a tags list suggests the vault's tags", chips[0]?.startsWith("qaharbor"), chips)
  await page.keyboard.press("Enter")
  check("…and a pick is its new item", await saved((t) => /tags:[\s\S]*qaharbor[\s\S]*---/.test(t), PROPS), read(PROPS))
  await ctx.close()
}

noErrors()
await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await done()
