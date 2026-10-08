// The note plugins (plugins/core/note-composer, random-note, unique-note): Extract current selection to a new
// note and to one that's there (a link left in its place), Merge current file with another file (Undo puts both
// back), Open random note, Create new unique note (named by the minute). WRITES notes: throwaway only.
//   node web/qa/composer.mjs <base url> <vault path>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const read = (p) => { try { return readFileSync(path.join(VAULT, p), "utf8") } catch { return null } }
writeFileSync(path.join(VAULT, "Notes/Composer source.md"), "keep this\nmove this line\nand keep this\n")
writeFileSync(path.join(VAULT, "Notes/Composer target.md"), "---\ntags: [x]\n---\nTarget text\n")
writeFileSync(path.join(VAULT, "Notes/Composer merged.md"), "---\ntags: [y]\n---\nMerged body\n")

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const open = async (f) => { await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`); await page.waitForSelector("[data-pane] .cm-content"); await wait(600) }
const pick = async (text) => { await page.waitForSelector("[role=option]"); await page.keyboard.type(text); await wait(300); await page.keyboard.press("Enter") }
const selectLine = async (n) => {
  await page.click("[data-pane] .cm-content"); await page.keyboard.press("ControlOrMeta+ArrowUp")
  for (let i = 1; i < n; i++) await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Home"); await page.keyboard.press("Shift+End")
}
await page.goto(B)
await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })

// Extract to a new note.
await open("Notes/Composer source.md")
check("no Extract without a selection", !(await command(page, "Extract current selection")))
await selectLine(2)
check("Extract current selection", await command(page, "Extract current selection"))
await pick("Extracted bit")
const body = (p) => read(p)?.replace(/^---\n[\s\S]*?\n---\n/, "").trim() // (Provenance gives a new note its origin)
check("the new note has the text", await until(() => body("Notes/Extracted bit.md") === "move this line"), read("Notes/Extracted bit.md"))
check("a link in its place", await until(() => read("Notes/Composer source.md") === "keep this\n[[Extracted bit]]\nand keep this\n"), read("Notes/Composer source.md"))

// Extract to a note that's there: at its end.
await selectLine(3)
await command(page, "Extract current selection")
await pick("Composer target")
check("appended to the note picked", await until(() => read("Notes/Composer target.md") === "---\ntags: [x]\n---\nTarget text\n\nand keep this\n"), read("Notes/Composer target.md"))
check("its link in its place", await until(() => read("Notes/Composer source.md")?.includes("[[Composer target]]")), read("Notes/Composer source.md"))

// Merge, then Undo.
await open("Notes/Composer merged.md")
check("Merge current file with another file", await command(page, "Merge current file with another file"))
await pick("Composer target")
check("merged: its body at the end of the other", await until(() => read("Notes/Composer target.md")?.endsWith("and keep this\n\nMerged body\n")), read("Notes/Composer target.md"))
check("merged: it's gone to the trash", await until(() => !existsSync(path.join(VAULT, "Notes/Composer merged.md"))))
check("merged: the other is open", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Composer target"))))
await page.click("[data-sonner-toast] button:has-text('Undo')")
check("Undo: both back", await until(() => existsSync(path.join(VAULT, "Notes/Composer merged.md")) && !read("Notes/Composer target.md")?.includes("Merged body")), read("Notes/Composer target.md"))

// Random note.
const before = await page.evaluate(() => location.hash)
check("Open random note", await command(page, "Open random note"))
check("another note opens", await until(async () => { const h = await page.evaluate(() => location.hash); return h !== before && h.startsWith("#file/") && h.endsWith(".md") }), await page.evaluate(() => location.hash))

// Unique note.
// (where new notes go: the vault's top, here)
const had = new Set(readdirSync(VAULT))
check("Create new unique note", await command(page, "Create new unique note"))
const made = await until(() => readdirSync(VAULT).find((f) => !had.has(f) && f.endsWith(".md")))
check("named by the minute", /^\d{12}\.md$/.test(made ?? ""), made)
await done()
