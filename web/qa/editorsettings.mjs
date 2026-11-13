// The editor as Obsidian's: live preview's Markdown under the cursor only, Settings > Editor (editor.json, defaults
// never written), aliases, ⌘E. WRITES a "Qa editor" folder and editor.json: throwaway server only.
//   node web/qa/editorsettings.mjs <base url> <vault path>
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { palette, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const json = { "Content-Type": "application/json" }
const write = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path, text, base: null }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${encodeURIComponent(path)}`)).json()).text
const EDITOR_JSON = `${VAULT}/.vaultite/editor.json`
const editorJson = () => (existsSync(EDITOR_JSON) ? JSON.parse(readFileSync(EDITOR_JSON, "utf8")) : null)
rmSync(EDITOR_JSON, { force: true })
// A fresh desk: workspaces are the server's, so a last run's split would still be open.
const freshDesk = () => fetch(`${B}api/workspaces/1`, { method: "DELETE" }).catch(() => {})
await freshDesk()

const NOTE = "Qa editor/Reveal.md", OTHER = "Qa editor/Linked note.md", TYPING = "Qa editor/Typing.md"
const INLINE = "Some **bold** and *em* then [[Linked note]] and `code` and [site](https://example.com) end."
await write(OTHER, "---\ntype: note\naliases: [Linky]\n---\n\nThe other note.\n")
await write(NOTE, `---\ntype: note\nstage: draft\n---\n\n# Heading one\n\n${INLINE}\n\n- item one with **strong**\n- [ ] task here\n\n> quoted **x** here\n`)
await write(TYPING, "---\ntype: note\n---\n\n")

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
await ctx.addInitScript(() => { try { localStorage.removeItem("vaultite.tabViews") } catch { /* about:blank */ } })
const page = watch(await ctx.newPage()), ui = app(page)
const ed = () => globalThis.__vaultite.modules["@vaultite"].currentEditor()
const open = async (path) => {
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(path)}`)
  await page.locator(".file-view .cm-content").first().waitFor({ timeout: 60000 }); await ui.idle()
}
const viewNow = () => page.evaluate(() => document.querySelector("[role=status] button[aria-label^='Current view']")?.getAttribute("aria-label") ?? "")
const flip = async () => {
  const from = await viewNow()
  await page.keyboard.press("ControlOrMeta+e")
  await until(async () => await viewNow() !== from); await page.locator("article.file-view:visible").first().waitFor(); await ui.idle()
}
const docText = () => page.evaluate(() => globalThis.__vaultite.modules["@vaultite"].currentEditor().view.state.doc.toString())
/** Put the cursor (or a selection) at the first `find` (+ `off`), focused. */
const cursor = async (find, off = 0, len = 0) => {
  await page.evaluate(([find, off, len]) => {
    const { view } = globalThis.__vaultite.modules["@vaultite"].currentEditor()
    const at = view.state.doc.toString().indexOf(find) + off
    view.focus()
    view.dispatch({ selection: { anchor: at, head: at + len } })
  }, [find, off, len]); await ui.idle()
}
const lineText = (has) => page.evaluate((has) => {
  const l = [...document.querySelectorAll(".file-view .cm-line")].find((x) => x.textContent.includes(has))
  return l ? l.textContent : null
}, has)
const lineHas = (has, sel) => page.evaluate(([has, sel]) => {
  const l = [...document.querySelectorAll(".file-view .cm-line")].find((x) => x.textContent.includes(has))
  return !!l?.querySelector(sel)
}, [has, sel])
void ed

// ---------- live preview: only the element under the cursor ----------
await open(NOTE)
const DRAWN = "Some bold and em then Linked note and code and site end."
await cursor("end.", 1)
check("cursor on the line, in no element: nothing shown", await lineText("then") === DRAWN, await lineText("then"))
await cursor("bold", 2)
check("in bold: only its ** show", await lineText("then") === "Some **bold** and em then Linked note and code and site end.", await lineText("then"))
await cursor("bold**", 6)
check("just after bold's closing **: shown (its edge)", (await lineText("then")).startsWith("Some **bold**"), await lineText("then"))
await cursor(" and *em", 1)
check("one character past it: hidden again", await lineText("then") === DRAWN, await lineText("then"))
await cursor("Linked note]]", 3)
check("in a [[link]]: only its brackets", await lineText("then") === "Some bold and em then [[Linked note]] and code and site end.", await lineText("then"))
await cursor("code`", 1)
check("in `code`: only its backticks", await lineText("then") === "Some bold and em then Linked note and `code` and site end.", await lineText("then"))
await cursor("site]", 1)
check("in a [link](url): its Markdown", await lineText("then") === "Some bold and em then Linked note and code and [site](https://example.com) end.", await lineText("then"))
await cursor("bold", 0, "bold** and *em* then [[Li".length)
check("a selection over several: each of them shows, not the rest", await lineText("then") === "Some **bold** and *em* then [[Linked note]] and code and site end.", await lineText("then"))
await cursor("Heading one", 3)
check("a heading: its # show anywhere on its line", await lineText("Heading one") === "# Heading one", await lineText("Heading one"))
await cursor("end.", 1)
check("off the heading: drawn", await lineText("Heading one") === "Heading one", await lineText("Heading one"))
await cursor("item one", 2)
check("typing a list item: its bullet stays drawn", await lineHas("item one", ".cm-bullet") && !(await lineText("item one")).startsWith("-"), await lineText("item one"))
check("…and its bold stays drawn", !(await lineText("item one")).includes("**"), await lineText("item one"))
await cursor("task here", 2)
check("typing a task: its checkbox stays", await lineHas("task here", "input.cm-task"), await lineText("task here"))
await cursor("- item one", 0, 4)
check("a selection over a bullet: its - shows", (await lineText("item one")).startsWith("- item"), await lineText("item one"))
await cursor("quoted", 2)
check("a quote line: its > shows, its bold stays drawn", (await lineText("quoted")).startsWith("> quoted x"), await lineText("quoted"))
await page.evaluate(() => document.activeElement.blur()); await ui.idle()
check("unfocused: everything drawn", await lineText("then") === DRAWN && await lineText("Heading one") === "Heading one")
await page.screenshot({ path: "/tmp/editorsettings-reveal.png" })

// ---------- Properties: folded until opened, then open for that file while reading too ----------
const props = page.locator(".file-view section[aria-label='Properties']")
check("properties folded by default", await props.count() === 1 && await props.locator("button[aria-expanded=false]").count() === 1)
await props.locator("button[aria-expanded]").click()
check("…open on a click", await until(async () => await props.locator("button[aria-expanded=true]").count() === 1))
await page.keyboard.press("ControlOrMeta+e"); await until(async () => !(await page.locator(".file-view .cm-content[contenteditable=true]").count()))
check("reading view shows the properties, read-only", await props.count() === 1 && await props.locator("input, textarea").count() === 0 && (await props.textContent()).includes("draft"))
await flip()

// ---------- Settings > Editor ----------
/** A click in Settings from outside its rows: a row's preview card (aimed at, as a jumping pointer seems to) would be
 *  over the next row. */
const tap = async (loc) => { await page.mouse.move(2, 2); await until(async () => !(await page.locator("[data-setting-preview] .preview-card:visible").count())); await loc.click() }
const set = (loc) => ui.sees(".vaultite/editor.json", () => tap(loc))
const settings = async () => { await page.goto("about:blank"); await page.goto(`${B}#settings`); await page.locator('[data-settings-nav="editor"]').click(); await page.locator("[data-settings-row=spellcheck]").waitFor({ timeout: 15000 }); await ui.idle() }
await settings()
check("Settings has an Editor panel", await page.getByText("Editor", { exact: true }).count() >= 1)
check("nothing written before a change", editorJson() === null, editorJson())
await page.screenshot({ path: "/tmp/editorsettings-panel.png", fullPage: true })

// Defaults: spellcheck on, Tab is a tab, brackets pair, readable lines.
await open(TYPING)
check("spellcheck on by default", await page.locator(".file-view .cm-content").first().getAttribute("spellcheck") === "true")
const article = page.locator("article.file-view").first()
const w0 = (await article.boundingBox()).width
check(`readable line length: the column stops at 700px (${w0})`, w0 <= 701, w0)
const body = async () => (await docText()).replace(/^---\n[\s\S]*?\n---\n\n?/, "")
const fresh = async () => { await page.evaluate(() => { const { view, start } = globalThis.__vaultite.modules["@vaultite"].currentEditor(); view.focus(); view.dispatch({ changes: { from: start(view.state), to: view.state.doc.length, insert: "" } }) }); await ui.idle() }
await fresh(); await page.keyboard.type("- a"); await page.keyboard.press("Enter"); await page.keyboard.press("Tab"); await page.keyboard.type("b")
check("Tab indents with a tab", (await body()) === "- a\n\t- b", await body())
await fresh(); await page.keyboard.type("(x")
check("( closes itself", (await body()) === "(x)", await body())
await fresh(); await page.keyboard.type("[[Lin")
await page.locator(".cm-tooltip-autocomplete li", { hasText: "Linky" }).first().waitFor({ timeout: 4000 }).catch(() => {})
await page.locator(".cm-tooltip-autocomplete li", { hasText: "Linky" }).first().click().catch(() => {}); await ui.idle()
check("an alias picked after [[ links its file", (await body()) === "[[Linked note|Linky]]", await body())
await fresh(); await page.keyboard.type("one word")
await page.keyboard.press("Shift+ArrowLeft"); await page.keyboard.press("Shift+ArrowLeft"); await page.keyboard.press("Shift+ArrowLeft"); await page.keyboard.press("Shift+ArrowLeft")
await page.keyboard.type("*")
check("* over a selection wraps it", (await body()) === "one *word*", await body())
await page.keyboard.type("*")
check("again: bold", (await body()) === "one **word**", await body())
await fresh(); await page.keyboard.type("a `b")
check("` closes itself", (await body()) === "a `b`", await body())
await fresh(); await page.keyboard.type("```")
const fence = await body()
check(`typing a fence (\`\`\`) leaves a usable fence (${JSON.stringify(fence)})`, fence.startsWith("```") && !fence.startsWith("````"), fence)
await fresh(); await page.keyboard.type("don't 2 * 3")
check("quotes and * don't pair inside words or arithmetic", (await body()) === "don't 2 * 3", await body())
await fresh()

// Changed in Settings: written key by key; the editor follows.
await settings()
await set(page.locator("[data-settings-row=spellcheck] [role=switch]"))
await set(page.locator("[data-settings-row=indent] [role=radio]", { hasText: "2 spaces" }))
await set(page.locator("[data-settings-row=auto-pair-brackets] [role=switch]"))
await set(page.locator("[data-settings-row=readable-line-length] [role=switch]"))
await set(page.locator("[data-settings-row=properties-in-document] [role=radio]", { hasText: "Hidden" }))
check("only what changed is written", JSON.stringify(editorJson()) === JSON.stringify({ spellcheck: false, useTab: false, tabSize: 2, autoPairBrackets: false, readableLineLength: false, propertiesInDocument: "hidden" }), editorJson())
await open(TYPING)
check("spellcheck off", await page.locator(".file-view .cm-content").first().getAttribute("spellcheck") === "false")
check(`readable line length off: the pane's width (${(await article.boundingBox()).width})`, (await article.boundingBox()).width > w0 + 100)
await fresh(); await page.keyboard.type("- a"); await page.keyboard.press("Enter"); await page.keyboard.press("Tab"); await page.keyboard.type("b")
check("Tab indents with 2 spaces", (await body()) === "- a\n  - b", await body())
// A note already indented keeps its own indent, as VS Code does: the setting is for one that isn't.
for (const [indent, name] of [["    ", "4 spaces"], ["\t", "a tab"]]) {
  const OWN = `Qa editor/Own indent ${name}.md`
  await write(OWN, `---\ntype: note\ntags:\n  - x\n---\n\n- a\n${indent}- b\n- c\n`)
  await open(OWN); await cursor("- c", 0); await page.keyboard.press("Tab")
  check(`a note indented with ${name} keeps it`, (await body()).endsWith(`${indent}- c\n`), await body())
}
await open(TYPING)
await fresh(); await page.keyboard.type("(x")
check("( doesn't close itself", (await body()) === "(x", await body())
await fresh()
await open(NOTE)
check("properties hidden while editing", await props.count() === 0)
await flip()
check("…and reading", await props.count() === 0)
await flip()
await settings()
await set(page.locator("[data-settings-row=properties-in-document] [role=radio]", { hasText: "As text" }))
await open(NOTE)
check("properties as source: the frontmatter in the text", await props.count() === 0 && (await page.locator(".file-view .cm-content").first().textContent()).includes("stage: draft"))
await cursor("stage: draft", 12); await page.keyboard.type("y"); await ui.idle()
check("…typed into, saved as the file's frontmatter", /\nstage: drafty\n[\s\S]*---\n\n# Heading one/.test(await read(NOTE)), (await read(NOTE)).slice(0, 60))
await settings()
for (const row of ["spellcheck", "indent", "auto-pair-brackets", "readable-line-length", "properties-in-document"]) {
  await set(page.locator(`[data-settings-row=${row}] [data-reset-default]`))
}
check("reset takes the keys out again", JSON.stringify(editorJson() ?? {}) === "{}", editorJson())

// ---------- ⌘E: only the tab in front ----------
await open(NOTE)
const panes = page.locator("[data-pane] article.file-view")
await page.keyboard.press("ControlOrMeta+Alt+\\"); await panes.nth(1).waitFor(); await ui.idle()
check("split: two panes on the note", await panes.count() === 2)
await flip()
const modes = await page.evaluate(() => [...document.querySelectorAll("[data-pane]")].map((p) => !!p.querySelector(".cm-content[contenteditable=true]")))
check("⌘E switched only the focused pane to reading", modes.filter((x) => !x).length === 1 && modes.filter(Boolean).length === 1, modes)
await page.screenshot({ path: "/tmp/editorsettings-panes.png" })

// ---------- Default view and editing mode: Settings', for every device; each tab its own after ----------
await freshDesk()
// (in the focused pane: the split above may still be there)
const sourceShown = async () => (await page.locator("[data-focused] .file-view:not([data-kept] *) .vau-editor.is-source").count()) > 0
const editing = async () => (await page.locator("[data-focused] .file-view:not([data-kept] *) .cm-content[contenteditable=true]").count()) > 0
await settings()
await set(page.locator("[data-settings-row=editing-mode] [role=radio]", { hasText: "Source mode" }))
check("default editing mode: source mode, in editor.json", editorJson()?.editingMode === "source", editorJson())
await open(OTHER)
check("a new tab opens in source mode", await sourceShown())
await flip()
check("…⌘E reads", !(await editing()))
await flip()
check("…and goes back to source mode", await sourceShown())
await palette(page, "Create new note", 0)
check("a new note opens in source mode", await until(async () => (await page.locator(".file-view .vau-editor.is-source").count()) > 0 && /Untitled/.test(await page.evaluate(() => location.hash))), await page.evaluate(() => location.hash))
await page.keyboard.press("Escape")
await settings()
await set(page.locator("[data-settings-row=default-view] [role=radio]", { hasText: "Reading" }))
await open(NOTE).catch(() => {})
check("default view reading: a new tab reads", !(await editing()))
await flip()
check("…⌘E edits in the default editing mode", await sourceShown())
await settings()
for (const row of ["default-view", "editing-mode"]) { await set(page.locator(`[data-settings-row=${row}] [data-reset-default]`)) }
check("…reset takes them out again", JSON.stringify(editorJson() ?? {}) === "{}", editorJson())
// Unset here, Obsidian's: livePreview false is source mode.
const hadObsidian = existsSync(`${VAULT}/.obsidian`)
mkdirSync(`${VAULT}/.obsidian`, { recursive: true })
const appJson = `${VAULT}/.obsidian/app.json`, hadApp = existsSync(appJson) ? readFileSync(appJson, "utf8") : null
writeFileSync(appJson, JSON.stringify({ livePreview: false }))
await until(async () => (await fetch(`${B}api/state`).then((r) => r.json())).obsidian?.editingMode === "source", 5000); await open(NOTE)
check("Obsidian's livePreview: false opens in source mode", await sourceShown())
if (hadApp !== null) writeFileSync(appJson, hadApp); else if (hadObsidian) rmSync(appJson); else rmSync(`${VAULT}/.obsidian`, { recursive: true, force: true })

await freshDesk()
done()
