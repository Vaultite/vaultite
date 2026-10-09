// A tab drawn again after a pane stopped drawing it (it keeps only its last five: components/Workspace.tsx) is as it
// was left (editor/kept.ts): ⌘Z undoes what was typed before, ⇧⌘Z redoes it, the selection is where it was, and a
// change made on disk meanwhile is in without being undone. WRITES (notes of its own): throwaway server only.
//   node web/qa/keptedits.mjs <base url> <vault path>
import { readFileSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, done } = await qa(import.meta.url)

const name = (i) => `Qa kept ${i}`
const file = (i) => `Notes/${name(i)}.md`
for (let i = 0; i < 8; i++) writeFileSync(`${VAULT}/${file(i)}`, `---\ntype: note\n---\n\nFirst line of ${name(i)}.\n\nSecond line.\n`)
await wait(800)

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = await ctx.newPage()
const editor = (i) => page.locator(`.file-view[data-path="${file(i)}"] .cm-content`)
const text = (i) => editor(i).innerText()
await page.goto(`${B}#file/${encodeURIComponent(file(0))}`)
await until(async () => (await editor(0).getAttribute("contenteditable")) === "true", 8000)
check("the first note opens in editing", (await editor(0).getAttribute("contenteditable")) === "true")
const tab0 = await page.evaluate(() => document.querySelector("[role=tab][aria-selected=true]")?.closest("[data-tab-id]")?.getAttribute("data-tab-id"))

// Typed at the end of its first line, then the word selected.
await editor(0).locator(".cm-line", { hasText: "First line" }).click()
await page.keyboard.press("End")
await page.keyboard.type(" kept-word", { delay: 20 })
await wait(400)
for (let k = 0; k < 9; k++) await page.keyboard.press("Shift+ArrowLeft")
await wait(900) // (autosave)
const sel = () => page.evaluate(() => getSelection()?.toString() ?? "")
check("typed and selected", (await sel()) === "kept-word", await sel())

// Six more tabs: the first is drawn no more.
for (let i = 1; i <= 6; i++) {
  await page.keyboard.press("ControlOrMeta+o"); await wait(300)
  await page.keyboard.type(name(i)); await wait(500)
  await page.keyboard.press("ControlOrMeta+Enter"); await wait(900)
}
check("its editor is gone (more tabs than a pane keeps)", await page.locator(`.file-view[data-path="${file(0)}"]`).count() === 0)

// Changed on disk meanwhile (an agent): the second line.
const disk = readFileSync(`${VAULT}/${file(0)}`, "utf8")
check("what was typed was saved", disk.includes("kept-word"), disk)
writeFileSync(`${VAULT}/${file(0)}`, disk.replace("Second line.", "Second line, changed on disk."))
await wait(1200)

// Back to it.
await page.locator(`[data-tab-id="${tab0}"] [role=tab]`).click()
await until(async () => (await editor(0).count()) === 1, 5000); await wait(1200)
check("drawn again with the change from disk", (await text(0)).includes("changed on disk"), await text(0))
check("the selection is where it was", (await sel()) === "kept-word", await sel())
await page.keyboard.press("ControlOrMeta+z"); await wait(500)
const undone = await text(0)
check("⌘Z undoes what was typed before it went", !undone.includes("kept-word") && undone.includes("First line of"), undone)
check("and keeps the change from disk", undone.includes("changed on disk"), undone)
await page.keyboard.press("ControlOrMeta+Shift+z"); await wait(500)
check("⇧⌘Z redoes it", (await text(0)).includes("kept-word"), await text(0))
await wait(1200)
const saved = readFileSync(`${VAULT}/${file(0)}`, "utf8")
check("saved as the editor shows it", saved.includes("kept-word") && saved.includes("changed on disk"), saved)

await ctx.close()
await done()
