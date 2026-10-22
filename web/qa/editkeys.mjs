// The editing keys and commands (plugins/core/editing, Templates' Insert current date): ⌘L makes a task and
// ticks it, ⌘B / ⌘I / highlight toggle on the selection or the word at the cursor, ⌘K makes a Markdown link (not the
// quick switcher: that's ⌘O), ⌘D deletes the line, headings, lists, a block put in, the date typed, and ⌘G opens the
// graph from inside the editor (the app's keys win over the editor's); Google Docs' marks, headings and lists, ⌥↑ / ⌥↓,
// and from a file tree row F2, ⌘D (the file, not the note) and ?. WRITES a note: throwaway only.
//   node web/qa/editkeys.mjs <base url> <vault path>
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
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

// Google Docs' keys: a mark on the word at the cursor, a heading, the lists; ⌥↑ / ⌥↓ move the line.
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

// A note's keys stay in the note: ⌘D on its file tree row duplicates the file, F2 renames it there, ? the hotkeys.
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
// (the copy opens to be named, taking the keyboard, later than its file on a slow machine: then back to the row)
await until(() => page.evaluate((p) => decodeURIComponent(location.hash) === `#file/${p}` && !!document.activeElement?.closest("[data-pane]"), NOTE.replace(/\.md$/, " 1.md")), 8000)
await page.focus(row)
await page.keyboard.press("Shift+/")
check("? opens the hotkeys", !!(await until(() => page.$("[data-hotkeys]"))))
await page.keyboard.press("Escape"); await wait(300)
if (existsSync(copy)) unlinkSync(copy)
// (Duplicate opened the copy, gone now: back to the note)
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 30000 })

await page.keyboard.press("ControlOrMeta+O")
check("⌘O opens the quick switcher", !!(await until(() => page.$('[role="dialog"][aria-label="Search"]'))))
await page.keyboard.press("Escape"); await wait(300)
await page.click("[data-pane] .cm-content")
await page.keyboard.press("ControlOrMeta+G")
check("⌘G from inside the editor opens the graph", await until(() => page.evaluate(() => location.hash.startsWith("#view/graph"))), await page.evaluate(() => location.hash))
await done()
