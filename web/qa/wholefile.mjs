// A note's editor holds its whole file (editor/frontmatter.ts): positions are the file's, the frontmatter behind
// Properties and out of the cursor's reach. WRITES "Qa whole/": throwaway server only.
//   node web/qa/wholefile.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { SHOTS, command, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"

const { args: [B, OUT = SHOTS], browser, check, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json" }
const read = async (path) => (await (await fetch(`${B}api/file?path=${encodeURIComponent(path)}`)).json()).text
const write = async (path, text, base = null) => fetch(`${B}api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path, text, base }) })
const FM = "---\ntype: note\ntags: [Qa]\nqa_stage: draft\n---\n\n"
const BODY = `# Title line\n\nFirst body line with apple.\n\nSecond line apple.\n\n${Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\n${"Filler text that makes the note long enough to scroll. ".repeat(6)}`).join("\n\n")}\n`
const NOTE = "Qa whole/With frontmatter.md", PLAIN = "Qa whole/No frontmatter.md", ONLY = "Qa whole/Only frontmatter.md", BARE = "Qa whole/Bare frontmatter.md"
await write(NOTE, FM + BODY)
await write(PLAIN, "First line, no frontmatter.\n\nAnother apple.\n")
await write(ONLY, "---\ntype: note\n---\n")
await write(BARE, "---\ntype: note\n---")
const hash = (p) => `#file/${encodeURIComponent(p)}`
// (the server keeps some frontmatter itself, origin and updated: bodies are compared, and the keys that matter)
const split = (t) => { const m = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)\n?/.exec(t ?? ""); return m ? [m[0], t.slice(m[0].length)] : ["", t ?? ""] }
const bodyOf = (t) => split(t)[1], fmOf = (t) => split(t)[0]

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage(), ui = app(page)
const errors = []
page.on("pageerror", (e) => errors.push(String(e)))
// The pane's editor, as plugins see it.
const ed = (fn, arg) => page.evaluate(([f, a]) => {
  const el = document.querySelector("#main-scroll .file-view .cm-content")
  const v = el?.cmTile?.root?.view
  return v ? new Function("v", "a", `return (${f})(v, a)`)(v, a) : null
}, [fn.toString(), arg])
const docText = () => ed((v) => v.state.doc.toString())
const head = () => ed((v) => v.state.selection.main.head)
const sel = () => ed((v) => [v.state.selection.main.from, v.state.selection.main.to])
const shown = (text) => page.evaluate((t) => [...document.querySelectorAll("#main-scroll .file-view .cm-line")].some((l) => l.textContent.includes(t)), text)
const open = async (p) => { await page.goto("about:blank"); await page.goto(`${B}${hash(p)}`); await page.locator(`#main-scroll article.file-view[data-path="${p}"] .cm-content`).waitFor(); await ui.idle() }
const viewNow = () => page.evaluate(() => document.querySelector("[role=status] button[aria-label^='Current view']")?.getAttribute("aria-label") ?? "")
const view = async (how) => {
  const from = await viewNow()
  if (how.startsWith("ControlOrMeta")) await page.keyboard.press(how); else await command(page, how, 0)
  await until(async () => await viewNow() !== from); await page.locator("#main-scroll article.file-view:visible").first().waitFor(); await ui.idle()
}
const toTop = async () => {
  const b = await page.locator("#main-scroll").boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, -100_000)
  await until(() => page.evaluate(() => document.getElementById("main-scroll").scrollTop === 0)); await ui.idle()
}
const clickLine = async (text) => {
  const l = page.locator("#main-scroll .file-view .cm-line", { hasText: text }).first()
  const b = await l.boundingBox()
  await page.mouse.click(b.x + b.width - 4, b.y + b.height / 2)
  await ui.idle()
}
const props = page.locator("#main-scroll article section[aria-label=Properties]")
const openProps = async () => { if (await props.locator("button[aria-expanded]").first().getAttribute("aria-expanded") === "false") { await props.locator("button[aria-expanded]").first().click(); await ui.idle() } }

// --- a note with frontmatter, live preview
await open(NOTE)
const text0 = await read(NOTE)
check("the editor holds the whole file, frontmatter too", await docText() === text0, (await docText())?.slice(0, 80))
check("the frontmatter isn't drawn in the text", !(await shown("qa_stage")) && !(await shown("type: note")))
check("Properties are drawn above it", await props.count() === 1)
check("the first line drawn is the body's", await page.evaluate(() => document.querySelector("#main-scroll .file-view .cm-line")?.textContent.includes("Title line")))
await page.screenshot({ path: `${OUT}/wholefile-live.png` })
await openProps()
await page.screenshot({ path: `${OUT}/wholefile-live-props.png` })

// The cursor never goes into the frontmatter: top of the document, select all, Backspace at the body's top.
const start = text0.indexOf("# Title line")
await clickLine("First body line")
await page.keyboard.press("ControlOrMeta+Home"); await ui.idle()
check(`top of the document: the body's start (${await head()} = ${start})`, await head() === start)
for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp")
await page.keyboard.press("Home")
check("arrows up and Home stay in the body", await head() === start)
await page.keyboard.type("X"); await ui.idle()
check("typed at the body's top: saved there, frontmatter intact", bodyOf(await read(NOTE)) === "X" + BODY && fmOf(await read(NOTE)).includes("qa_stage: draft"))
await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await ui.idle()
check("Backspace at the body's top doesn't eat into the frontmatter", bodyOf(await read(NOTE)) === BODY && fmOf(await read(NOTE)).includes("qa_stage: draft") && await docText() === await read(NOTE))
await page.keyboard.press("ControlOrMeta+a"); await ui.idle()
const [sa, sb] = await sel()
check(`select all selects the body (${sa}-${sb})`, sa === start && sb === (await docText()).length)
await page.keyboard.type("Replaced body"); await ui.idle()
check("select all and typing replaces the body only", bodyOf(await read(NOTE)) === "Replaced body" && fmOf(await read(NOTE)).includes("qa_stage: draft"))
await page.keyboard.press("ControlOrMeta+z"); await ui.idle()
check("undo brings the body back", bodyOf(await read(NOTE)) === BODY && await docText() === await read(NOTE))

// A property edited, undone and redone, through the editor's history.
const stage = props.locator("input[value=draft]").first()
await stage.click(); await stage.fill("final"); await page.keyboard.press("Enter"); await ui.idle()
const text1 = await read(NOTE)
check("a property edited: in the file and in the editor's text", text1.includes("qa_stage: final") && await docText() === text1 && !(await shown("qa_stage")))
await clickLine("Second line apple")
await page.keyboard.press("ControlOrMeta+z"); await ui.idle()
check("undo puts the property back", (await read(NOTE)).includes("qa_stage: draft") && await props.locator("input[value=draft]").count() === 1)
await page.keyboard.press("ControlOrMeta+Shift+z"); await ui.idle()
check("redo sets it again", (await read(NOTE)).includes("qa_stage: final") && await props.locator("input[value=final]").count() === 1)
// Changed on disk: the editor follows, the cursor where it was.
await clickLine("Second line apple")
const at = await head(), now = await read(NOTE)
await ui.sees(NOTE, () => write(NOTE, now.replace("qa_stage: final\n", "qa_stage: final\nfrom_disk: elsewhere\n"), now))
const after = await docText()
check(`a frontmatter change on disk comes in, hidden, Properties showing it (${JSON.stringify(fmOf(after))})`, after.includes("from_disk: elsewhere") && !(await shown("from_disk")) && await props.locator("input[value=elsewhere]").count() === 1)
check(`the cursor stays on its text (${at} -> ${await head()})`, await ed((v) => v.state.doc.lineAt(v.state.selection.main.head).text) === "Second line apple.")

// A plugin rewriting the whole text through the editor (Obsidian's Linter does): file positions, frontmatter included.
const before = await docText()
await ed((v, t) => v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } }), before.replace("from_disk: elsewhere", "from_disk: linted").replace("Second line apple.", "Second line apple, linted."))
await ui.idle()
const linted = await read(NOTE)
check("a plugin's whole-text edit: saved, the frontmatter hidden, Properties following", linted.includes("from_disk: linted") && linted.includes("apple, linted.") && !(await shown("from_disk")) && await props.locator("input[value=linted]").count() === 1)
const fmEnd = linted.indexOf("# Title line")
check("a plugin's offsets are the file's", await ed((v, at) => v.state.sliceDoc(at, at + 12), fmEnd) === "# Title line")

// Find skips the hidden frontmatter.
await page.keyboard.press("ControlOrMeta+f"); await page.locator("[data-find-bar]").waitFor(); await ui.idle()
await page.keyboard.type("qa_stage"); await ui.idle()
const bar = () => page.evaluate(() => document.querySelector("[data-find-bar]")?.textContent ?? "")
check(`find: nothing in the frontmatter (${await bar()})`, /No results/.test(await bar()))
await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("apple"); await ui.idle()
check(`find: the body's matches only (${await bar()})`, /of 2|2 results/.test(await bar()))
await page.keyboard.press("Escape"); await ui.idle()

// Views keep the place; reading hides the frontmatter too, source shows it.
const heading = (n) => page.evaluate((n) => {
  const box = document.getElementById("main-scroll")
  const line = [...box.querySelectorAll(".cm-line")].find((l) => l.textContent.replace(/^#+\s*/, "") === `Section ${n}`)
  return line ? Math.round(line.getBoundingClientRect().top - box.getBoundingClientRect().top) : null
}, n)
await page.evaluate(() => { document.getElementById("main-scroll").scrollTop = 3000 }); await ui.idle()
const n = await page.evaluate(() => {
  const box = document.getElementById("main-scroll"), top = box.getBoundingClientRect().top + 120
  const l = [...box.querySelectorAll(".cm-line")].find((l) => /Section \d+/.test(l.textContent) && l.getBoundingClientRect().top > top)
  return Number(/Section (\d+)/.exec(l.textContent)[1])
})
const was = await heading(n)
for (const [how, name] of [["ControlOrMeta+e", "reading"], ["ControlOrMeta+e", "live preview"], ["Switch to source mode", "source"], ["Switch to live preview", "live preview again"]]) {
  await view(how)
  const h = await heading(n)
  check(`switched to ${name}: Section ${n} stays where it was (${was} -> ${h})`, h !== null && Math.abs(h - was) <= 3)
  if (name === "reading") check("reading: the frontmatter isn't drawn", await docText() === await read(NOTE) && !(await page.evaluate(() => document.querySelector("#main-scroll .file-view .cm-content")?.textContent.includes("qa_stage"))))
}
await view("Switch to source mode")
await toTop()
check("source: the frontmatter is text", await page.evaluate(() => document.querySelector("#main-scroll .file-view .cm-content")?.textContent.includes("qa_stage")))
await page.screenshot({ path: `${OUT}/wholefile-source.png` })
await view("Switch to live preview")
await toTop()
await view("ControlOrMeta+e")
await page.screenshot({ path: `${OUT}/wholefile-reading.png` })
await view("ControlOrMeta+e")

// Line numbers count the body's lines.
await ui.sees(".vaultite/appearance.json", () => fetch(`${B}api/config/appearance`, { method: "PATCH", headers: json, body: JSON.stringify({ lineNumbers: true }) }))
await page.locator("#main-scroll .vau-editor.has-numbers .cm-lineNumbers .cm-gutterElement:visible").first().waitFor(); await ui.idle()
const firstNumber = await page.evaluate(() => [...document.querySelectorAll("#main-scroll .cm-lineNumbers .cm-gutterElement")].filter((e) => getComputedStyle(e).visibility !== "hidden" && e.textContent).map((e) => e.textContent)[0])
check(`line numbers start at the body (${firstNumber})`, firstNumber === "1")
await page.screenshot({ path: `${OUT}/wholefile-numbers.png` })
await ui.sees(".vaultite/appearance.json", () => fetch(`${B}api/config/appearance`, { method: "PATCH", headers: json, body: JSON.stringify({ lineNumbers: null }) }))

// --- no frontmatter: adding the first property, then removing it
await open(PLAIN)
check("no frontmatter: the editor holds the file", await docText() === await read(PLAIN))
await clickLine("First line"); await page.keyboard.press("ControlOrMeta+Home"); await page.keyboard.type("Top: "); await ui.idle()
check("typed at the top", bodyOf(await read(PLAIN)).startsWith("Top: First line"))
await openProps()
await props.getByText("Add property").click(); await ui.idle()
await page.keyboard.type("status"); await page.keyboard.press("Enter"); await ui.idle()
await page.keyboard.type("open"); await page.keyboard.press("Enter"); await ui.idle()
const p1 = await read(PLAIN)
check(`the first property: frontmatter made, hidden (${JSON.stringify(p1.slice(0, 40))})`, /\nstatus: open\n/.test(fmOf(p1)) && await docText() === p1 && !(await shown("status: open")) && await shown("Top: First line"))
await page.screenshot({ path: `${OUT}/wholefile-first-property.png` })
await props.locator("[aria-label='Remove status']").click({ force: true }); await ui.idle()
const p2 = await read(PLAIN)
check(`the property removed (${JSON.stringify(p2.slice(0, 30))})`, !fmOf(p2).includes("status") && bodyOf(p2).startsWith("Top: First line") && await docText() === p2)
await clickLine("Another apple"); await page.keyboard.press("ControlOrMeta+z"); await ui.idle()
check("undo brings the property back", fmOf(await read(PLAIN)).includes("status: open"))

// A plugin adding frontmatter to a note without one: hidden at once, Properties showing it.
await ed((v) => v.dispatch({ changes: { from: 0, insert: "---\nadded_by: plugin\n---\n" } }))
await ui.idle()
check("a plugin adding frontmatter: hidden, in Properties", fmOf(await read(PLAIN)).includes("added_by: plugin") && !(await shown("added_by")) && await props.locator("input[value=plugin]").count() === 1)

// --- only frontmatter: the body's placeholder, typing after it (with and without a line break at the end)
for (const [p, label] of [[ONLY, "ending in a line break"], [BARE, "without one"]]) {
  await open(p)
  check(`only frontmatter, ${label}: "Start writing" shown`, await page.locator("#main-scroll .file-view .cm-placeholder").count() === 1)
  await page.locator("#main-scroll .file-view .cm-content").click(); await ui.idle()
  await page.keyboard.type("Hello"); await ui.idle()
  check(`only frontmatter, ${label}: typed into the body (${JSON.stringify(bodyOf(await read(p)))})`, bodyOf(await read(p)) === "Hello" && fmOf(await read(p)).includes("type: note"))
}
await page.screenshot({ path: `${OUT}/wholefile-only-frontmatter.png` })

// --- a phone
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" })
const pp = await phone.newPage(), phoneUi = app(pp)
await pp.goto(`${B}${hash(NOTE)}`); await pp.locator(".file-view .cm-content").first().waitFor(); await phoneUi.idle()
check("phone: the frontmatter isn't drawn", !(await pp.evaluate(() => document.querySelector(".file-view .cm-content")?.textContent.includes("qa_stage"))))
await pp.screenshot({ path: `${OUT}/wholefile-phone.png` })
await phone.close()

check(`no page errors (${errors.slice(0, 2).join(" | ")})`, errors.length === 0)
await ctx.close()
await done()
