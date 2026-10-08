// The editor's slash menu, [[Note# heading suggestions, and templates: "/" opens the menu, typing narrows it, a heading
// and a block go in, a menu that stays shut in code and mid-word; [[Note# lists the note's headings; "New note from
// template" with no templates offers examples, a person template makes a file in People with {{title}} filled in,
// "Insert template" and the slash menu's template entry put a template into an open note (frontmatter keys added).
// WRITES to the vault: throwaway server only.
//   node web/qa/slash.mjs <base url> <vault path> [out dir]
import { existsSync, readFileSync } from "node:fs"
import { SHOTS, palette, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const read = (p) => readFileSync(`${VAULT}/${p}`, "utf8")
const post = (path, body) => fetch(`${B}api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

await fetch(`${B}api/file?path=${encodeURIComponent("Qa slash/Slash note.md")}`, { method: "DELETE" })
// Templates from an empty folder of its own (a vault, like the sandbox, may have some already): the Templates plugin's
// `folder` setting, put back at the end.
const TPL = "Qa slash/Templates"
await fetch(`${B}api/file?path=${encodeURIComponent(TPL)}`, { method: "DELETE" })
const patchTemplates = (folder) => fetch(`${B}api/config/plugin/templates`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) })
const tplBefore = (await (await fetch(`${B}api/config/plugin/templates`)).json()).folder ?? null
await patchTemplates(TPL)
await post("file", { path: "Qa slash/Slash note.md", text: "---\ntype: note\nkind: note\n---\n\nFirst line.\n" })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const menu = page.locator(".cm-tooltip-autocomplete")
// (Enter picks once the menu shows it and has been open 75 ms, CodeMirror's interactionDelay; before, it's a new line)
const ready = async (name) => { await menu.locator("li[aria-selected]", { hasText: name }).waitFor(); await wait(100) }

await page.goto(`${B}#file/${encodeURIComponent("Qa slash/Slash note.md")}`); await wait(1500)
// Editing: live preview.
if (!(await page.locator(".vau-editor .cm-content[contenteditable=true]").count())) { await page.keyboard.press("ControlOrMeta+e"); await wait(500) }
const toEnd = async () => { await page.locator(".vau-editor .cm-line", { hasText: "First line." }).first().click(); await page.keyboard.press("ControlOrMeta+ArrowDown"); await page.keyboard.press("Enter") }
await toEnd()
await page.keyboard.type("/"); await wait(400)
check("/ at a line's start opens the menu", await menu.isVisible())
const all = await menu.locator("li").allInnerTexts()
check(`it lists basics and blocks (${all.length} entries)`, all.some((t) => t.startsWith("Heading 1")) && all.some((t) => /People due/.test(t)))
await page.screenshot({ path: `${OUT}slash-menu.png` })
await page.keyboard.type("h2"); await wait(300)
check("typing narrows it (h2 -> Heading 2)", (await menu.locator("li[aria-selected]").innerText()).startsWith("Heading 2"))
await page.keyboard.press("Enter"); await page.keyboard.type("Plans"); await page.keyboard.press("Enter"); await wait(300)
await page.keyboard.type("/people d"); await wait(300)
check("a space after the query closes it", !(await menu.isVisible()))
for (let i = 0; i < 9; i++) await page.keyboard.press("Backspace")
await page.keyboard.type("/peopledue"); await ready("People due")
await page.keyboard.press("Enter"); await wait(1200)
await page.keyboard.type("mid/word"); await wait(300)
check("no menu mid-word", !(await menu.isVisible()))
// [[Note# suggests that note's headings, [[# this file's.
await page.keyboard.press("Enter"); await page.keyboard.type("See [[Slash note#"); await wait(600)
check("[[Note# suggests its headings", (await menu.locator("li").allInnerTexts()).includes("Plans"))
await page.keyboard.press("Enter"); await wait(1200)
const text = read("Qa slash/Slash note.md")
check("…and a pick goes in as [[Note#Heading]]", text.includes("See [[Slash note#Plans]]"))
check("the heading was typed as ## ", /## Plans/.test(text))
check("the block went in as a fence", /```block-people-due\n```/.test(text), text)

// Templates: none yet -> examples.
await page.keyboard.press("Escape")
await palette(page, "New note from template", 600)
await page.screenshot({ path: `${OUT}slash-templates-empty.png` })
const empty = await page.getByRole("button", { name: "Add three examples" }).count()
check("no templates: the picker offers examples", empty === 1)
await page.screenshot({ path: `${OUT}slash-templates-empty.png` })
await page.getByRole("button", { name: "Add three examples" }).click(); await wait(1500)
check("examples written to the templates folder", existsSync(`${VAULT}/${TPL}/Person.md`) && existsSync(`${VAULT}/${TPL}/Journal.md`))
await page.keyboard.type("Person"); await wait(300)
await page.screenshot({ path: `${OUT}slash-templates-pick.png` })
await page.keyboard.press("Enter"); await wait(2000)
const hash = decodeURIComponent(await page.evaluate(() => location.hash))
check(`a person template makes a file in People (${hash})`, /People\/Untitled( \d+)?\.md/.test(hash))
const made = hash.replace(/^#file\//, "")
const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
if (existsSync(`${VAULT}/${made}`)) check("its {{date}} was filled in", read(made).includes(`- ${iso} · note · Met`) && /type: person/.test(read(made)))

// Insert template into the note (command), then the slash menu's template.
await page.goto(`${B}#file/${encodeURIComponent("Qa slash/Slash note.md")}`); await wait(1500)
await toEnd()
await palette(page, "Insert template", 600)
await page.keyboard.type("Meeting"); await wait(200); await page.keyboard.press("Enter"); await wait(1800)
let t = read("Qa slash/Slash note.md")
check("Insert template: body at the cursor, new frontmatter keys added, own keys kept", /## Next steps/.test(t) && /tags: \[Meeting\]/.test(t) && /kind: note/.test(t) && !/kind: note\n[\s\S]*kind: note\n---/.test(t))
await page.keyboard.press("ControlOrMeta+ArrowDown"); await page.keyboard.press("Enter")
await page.keyboard.type("/journ"); await wait(400)
check("the slash menu lists templates", (await menu.locator("li[aria-selected]").innerText()).startsWith("Journal"))
await page.keyboard.press("Enter"); await wait(1800)
t = read("Qa slash/Slash note.md")
check("the slash menu's template went in", /## Grateful for/.test(t))
check("the note's own kind stayed", !/kind: journal/.test(t))
noErrors()
await patchTemplates(tplBefore)
await done()
