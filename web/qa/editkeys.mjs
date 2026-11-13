// The editing keys and commands: the app's keys win over the editor's, file tree row keys too; several cursors, pasting.
// WRITES notes: throwaway server.
//   node web/qa/editkeys.mjs <base url> <vault path>
// Paths: plugins/core/editing, web/src/editor/cursors.ts, web/src/editor/paste.ts, core/htmlmd.ts
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, command, qa, until, wait } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const NOTE = "Notes/Editing keys.md"
const file = path.join(VAULT, NOTE)
writeFileSync(file, "alpha\nbeta\ngamma\ndelta\n")
const disk = () => readFileSync(file, "utf8")
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 30000 })
await wait(800)
await page.click("[data-pane] .cm-content")
const line = async (n) => { await page.keyboard.press("ControlOrMeta+Home"); for (let i = 1; i < n; i++) await page.keyboard.press("ArrowDown"); await page.keyboard.press("Home") }
const lines = () => disk().split("\n")
const saved = (n, want) => until(() => lines()[n - 1] === want, 4000)

await line(1)
await page.keyboard.press("ControlOrMeta+L")
check("⌘L: a task", await saved(1, "- [ ] alpha"), lines()[0])
await page.keyboard.press("ControlOrMeta+L")
check("⌘L again: ticked", await saved(1, "- [x] alpha"), lines()[0])
await page.keyboard.press("ControlOrMeta+L")
check("⌘L again: unticked", await saved(1, "- [ ] alpha"), lines()[0])

await line(2); await page.keyboard.press("ArrowRight")
await page.keyboard.press("ControlOrMeta+B")
check("⌘B with the cursor in a word: the word", await saved(2, "**beta**"), lines()[1])
await page.keyboard.press("ControlOrMeta+B")
check("⌘B again: off", await saved(2, "beta"), lines()[1])
await page.keyboard.press("ControlOrMeta+I")
await page.keyboard.press("ControlOrMeta+B")
check("⌘I then ⌘B: both", await saved(2, "***beta***"), lines()[1])
await page.keyboard.press("ControlOrMeta+I")
check("⌘I off: still bold", await saved(2, "**beta**"), lines()[1])
await page.keyboard.press("ControlOrMeta+B")
await command(page, "Toggle highlight")
check("Toggle highlight", await saved(2, "==beta=="), lines()[1])
await command(page, "Toggle highlight")

await line(2); await page.keyboard.press("Shift+End")
await page.keyboard.press("ControlOrMeta+K")
await page.keyboard.type("https://example.com")
check("⌘K: the selection as a link, the cursor where the address goes", await saved(2, "[beta](https://example.com)"), lines()[1])
check("⌘K in a note doesn't open the quick switcher", !(await page.$('[role="dialog"][aria-label="Search"]')))

await line(3)
await page.keyboard.press("ControlOrMeta+Shift+Backspace")
check("⌘⇧⌫: the line deleted", await until(() => !disk().includes("gamma")) && lines()[2] === "delta", lines())

await line(3)
await command(page, "Set as heading 2")
check("Set as heading 2", await saved(3, "## delta"), lines()[2])
await command(page, "Remove heading")
check("Remove heading", await saved(3, "delta"), lines()[2])
await command(page, "Toggle bullet list")
check("Toggle bullet list", await saved(3, "- delta"), lines()[2])
await command(page, "Toggle numbered list")
check("Toggle numbered list: the bullet becomes a number", await saved(3, "1. delta"), lines()[2])
await command(page, "Toggle numbered list")
check("Toggle numbered list again: plain", await saved(3, "delta"), lines()[2])

await page.keyboard.press("End")
await command(page, "Insert callout")
check("Insert callout: on lines of its own after the line", await until(() => disk().includes("delta\n\n> [!note]\n> ")), disk())
await page.keyboard.type("hi")
check("the cursor in the callout", await until(() => disk().includes("> [!note]\n> hi")), disk())
await page.keyboard.press("Enter"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter")
await command(page, "Insert current date")
const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
check("Insert current date", await until(() => disk().includes(ymd)), disk())

await page.click("[data-pane] .cm-content")
await line(3); await page.keyboard.press("ArrowRight")
for (const [keys, want, what] of [["Shift+X", "~~delta~~", "strikethrough"], ["Shift+H", "==delta==", "highlight"], ["Shift+C", "`delta`", "code"]]) {
  await page.keyboard.press(`ControlOrMeta+${keys}`)
  check(`⌘${keys.replace("Shift+", "⇧")}: ${what}`, await saved(3, want), lines()[2])
  await page.keyboard.press(`ControlOrMeta+${keys}`)
  await saved(3, "delta")
}
await page.keyboard.press("ControlOrMeta+Alt+2")
check("⌘⌥2: heading 2", await saved(3, "## delta"), lines()[2])
await page.keyboard.press("ControlOrMeta+Alt+0")
check("⌘⌥0: no heading", await saved(3, "delta"), lines()[2])
for (const [n, want, what] of [["8", "- delta", "bullet"], ["7", "1. delta", "numbered"], ["9", "- [ ] delta", "task"]]) {
  await page.keyboard.press(`ControlOrMeta+Shift+${n}`)
  check(`⌘⇧${n}: ${what} list`, await saved(3, want), lines()[2])
  await page.keyboard.press(`ControlOrMeta+Shift+${n}`)
  await saved(3, "delta")
}
const second = lines()[1]
await page.keyboard.press("Alt+ArrowUp")
check("⌥↑: the line moves up", await saved(2, "delta") && lines()[2] === second, lines())
await page.keyboard.press("Alt+ArrowDown")
check("⌥↓: and back down", await saved(3, "delta"), lines())

const before = disk()
const row = `[data-sidebar-body] [data-tree-path="${NOTE}"] > button`
await until(() => page.$(row))
await page.focus(row)
await page.keyboard.press("F2")
check("F2 on a tree row: its name to type", !!(await until(() => page.$('[data-sidebar-body] input[aria-label="New name"]'))))
await page.keyboard.press("Escape")
await until(() => page.evaluate((r) => document.activeElement === document.querySelector(r), row))
await page.keyboard.press("ControlOrMeta+D")
const copy = file.replace(/\.md$/, " 1.md")
check("⌘D on a tree row: the file duplicated", await until(() => existsSync(copy)), copy)
check("⌘D on a tree row: the note left alone", disk() === before, disk())
await until(() => page.evaluate((p) => decodeURIComponent(location.hash) === `#file/${p}` && !!document.activeElement?.closest("[data-pane]"), NOTE.replace(/\.md$/, " 1.md")), 8000)
await page.focus(row)
await page.keyboard.press("Shift+/")
check("? opens the hotkeys", !!(await until(() => page.$("[data-hotkeys]"))))
await page.keyboard.press("Escape"); await wait(300)
if (existsSync(copy)) unlinkSync(copy)
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 30000 })

await page.keyboard.press("ControlOrMeta+O")
check("⌘O opens the quick switcher", !!(await until(() => page.$('[role="dialog"][aria-label="Search"]'))))
await page.keyboard.press("Escape"); await wait(300)
await page.click("[data-pane] .cm-content")
await page.keyboard.press("ControlOrMeta+G")
check("⌘G from inside the editor opens the graph", await until(() => page.evaluate(() => location.hash.startsWith("#view/graph"))), await page.evaluate(() => location.hash))

const CURSORS = "Qa cursors/Cursors.md"
const api = { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }
const post = (path, text) => fetch(`${B}api/file`, { method: "POST", headers: api, body: JSON.stringify({ path, text }) })
let at = CURSORS
const readAt = async () => (await (await fetch(`${B}api/file?path=${encodeURIComponent(at)}`)).json()).text
const shown = async () => (await readAt()).replace(/^---\n[\s\S]*?\n---\n/, "")
const hasText = (want) => until(async () => (await shown()).includes(want), 4000)

await fetch(`${B}api/file?path=${encodeURIComponent("Qa cursors")}`, { method: "DELETE" })
await post(CURSORS, "alpha one\nbeta one\ngamma one\n")
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 2 })
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(B).origin })
const tab = watch(await ctx.newPage()), ui = app(tab)
await tab.goto(`${B}#file/${encodeURIComponent(CURSORS)}`)
const editorOf = (p) => tab.locator(`article.file-view[data-path="${p}"]:visible .vau-editor`)
let ed = editorOf(CURSORS)
await ed.locator(".cm-content").waitFor(); await ui.idle()
const lineOf = (text) => ed.locator(".cm-line", { hasText: text }).first()
const atEnd = async (text, modifiers = []) => { const b = await lineOf(text).boundingBox(); await tab.mouse.move(b.x + b.width - 4, b.y + b.height / 2); await lineOf(text).click({ modifiers, position: { x: b.width - 4, y: b.height / 2 } }) }
const cursors = () => ed.locator(".cm-cursorLayer .cm-cursor").count()
await tab.addStyleTag({ content: ".cm-cursorLayer { animation: none !important; }" })

await atEnd("alpha one"); await atEnd("beta one", ["Alt"]); await atEnd("gamma one", ["Alt"]); await ui.idle()
check("⌥-click adds a cursor, each", await cursors() === 3, await cursors())
const top = await lineOf("alpha one").boundingBox()
await tab.screenshot({ path: `${SHOTS}multiple-cursors.png`, clip: { x: top.x - 16, y: top.y - 16, width: 360, height: top.height * 3 + 40 } })
await tab.keyboard.type("!")
check("typing goes in at each", await hasText("alpha one!\nbeta one!\ngamma one!"), await shown())

const home = async (text) => { await atEnd(text); await tab.keyboard.press("Home") }
await home("alpha one"); await ui.idle()
check("a plain click leaves one cursor", await cursors() === 1, await cursors())
await tab.keyboard.press("ControlOrMeta+Alt+ArrowDown"); await tab.keyboard.press("ControlOrMeta+Alt+ArrowDown"); await ui.idle()
check("⌘⌥↓ adds a cursor below, twice", await cursors() === 3, await cursors())
await tab.keyboard.type("#")
check("typing goes in at all three", await hasText("#alpha one!\n#beta one!\n#gamma one!"), await shown())
await home("gamma one"); await tab.keyboard.press("ControlOrMeta+Alt+ArrowUp"); await ui.idle()
check("⌘⌥↑ adds one above", await cursors() === 2, await cursors())

const select = async (text, at, n) => { await home(text); for (let i = 0; i < at; i++) await tab.keyboard.press("ArrowRight"); for (let i = 0; i < n; i++) await tab.keyboard.press("Shift+ArrowRight") }
await select("alpha one", 7, 3)
await command(tab, "Select next occurrence"); await command(tab, "Select next occurrence"); await ui.idle()
check("Select next occurrence, twice: three selections", await ed.locator(".cm-selectionBackground").count() === 3, await ed.locator(".cm-selectionBackground").count())
await tab.screenshot({ path: `${SHOTS}multiple-selections.png`, clip: { x: top.x - 16, y: top.y - 16, width: 360, height: top.height * 3 + 40 } })
await tab.keyboard.type("two")
check("typing replaces each", await hasText("#alpha two!\n#beta two!\n#gamma two!"), await shown())

const column = async (from, to, keys) => {
  const a = await lineOf(from).boundingBox(), b = await lineOf(to).boundingBox()
  for (const k of keys) await tab.keyboard.down(k)
  await tab.mouse.move(a.x + 1, a.y + a.height / 2); await tab.mouse.down()
  await tab.mouse.move(b.x + 1, b.y + b.height / 2, { steps: 6 }); await tab.mouse.up()
  for (const k of keys) await tab.keyboard.up(k)
  await ui.idle()
}
await column("#alpha", "#gamma", ["Shift", "Alt"])
check("⇧⌥-drag: a cursor a line, in a column", await cursors() === 3, await cursors())
await tab.keyboard.type("> ")
check("typing goes in down the column", await hasText("> #alpha two!\n> #beta two!\n> #gamma two"), await shown())
await home("gamma two"); await column("alpha two", "beta two", ["Alt"])
check("⌥-drag adds the column to the cursor there was", await cursors() === 3, await cursors())

const PASTE = "Qa cursors/Paste.md"
await post(PASTE, "Paste here: \n\nLink the docs word.\n\n```\ncode: \n```\n")
at = PASTE; ed = editorOf(PASTE)
await tab.goto(`${B}#file/${encodeURIComponent(PASTE)}`); await ed.locator(".cm-content").waitFor(); await ui.idle()
const paste = (data) => ed.locator(".cm-content").evaluate((el, data) => {
  const d = new DataTransfer()
  for (const [type, text] of Object.entries(data)) d.setData(type, text)
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true }))
}, data)
await atEnd("Paste here:")
await paste({ "text/html": '<h3>Trip</h3><p>Book <b>flights</b> and <a href="https://x.test/hotel">a hotel</a>.</p><ol><li>Pack</li><li>Go</li></ol>', "text/plain": "Trip\nBook flights and a hotel.\nPack\nGo" })
check("HTML pastes as Markdown", await hasText("Paste here: ### Trip\n\nBook **flights** and [a hotel](https://x.test/hotel).\n\n1. Pack\n2. Go"), await shown())
await select("Link the docs", 9, 4)
await paste({ "text/plain": "https://x.test/docs" })
check("a web address over a selection links it", await hasText("Link the [docs](https://x.test/docs) word."), await shown())
await atEnd("code:")
await paste({ "text/html": "<p>Some <b>bold</b></p>", "text/plain": "Some bold" })
check("in a code block, HTML pastes as its text", await hasText("code: Some bold\n"), await shown())
await atEnd("word.")
await tab.evaluate(() => navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob(["<p>Raw <b>bold</b></p>"], { type: "text/html" }), "text/plain": new Blob(["Raw bold"], { type: "text/plain" }) })]))
await tab.keyboard.press("ControlOrMeta+Shift+V")
check("⇧⌘V pastes the plain text", await hasText("word.Raw bold"), await shown())
await fetch(`${B}api/file?path=${encodeURIComponent("Qa cursors")}`, { method: "DELETE" })
await done()
