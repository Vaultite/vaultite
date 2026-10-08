// The editing keys and commands (plugins/core/editing, Templates' Insert current date): ⌘L makes a task and
// ticks it, ⌘B / ⌘I / highlight toggle on the selection or the word at the cursor, ⌘K makes a Markdown link (not the
// quick switcher: that's ⌘O), ⌘D deletes the line, headings, lists, a block put in, the date typed, and ⌘G opens the
// graph from inside the editor (the app's keys win over the editor's). WRITES a note: throwaway only.
//   node web/qa/editkeys.mjs <base url> <vault path>
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
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
/** The cursor to the start of line n (1-based). */
const line = async (n) => { await page.keyboard.press("ControlOrMeta+ArrowUp"); for (let i = 1; i < n; i++) await page.keyboard.press("ArrowDown"); await page.keyboard.press("Home") }
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
await page.keyboard.press("ControlOrMeta+D")
check("⌘D: the line deleted", await until(() => !disk().includes("gamma")) && lines()[2] === "delta", lines())

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

await page.keyboard.press("ControlOrMeta+O")
check("⌘O opens the quick switcher", !!(await until(() => page.$('[role="dialog"][aria-label="Search"]'))))
await page.keyboard.press("Escape"); await wait(300)
await page.click("[data-pane] .cm-content")
await page.keyboard.press("ControlOrMeta+G")
check("⌘G from inside the editor opens the graph", await until(() => page.evaluate(() => location.hash.startsWith("#view/graph"))), await page.evaluate(() => location.hash))
await done()
