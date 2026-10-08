// Editing: find and replace in a file (plugins/core/find: ⌘F, ⌥⌘F, the count, Enter, replace all, find
// only while reading), folding (plugins/core/folding: the chevron on hover, a folded heading hides its section and is
// remembered, Fold all / Unfold all, a `#` line in code isn't a heading), page preview (plugins/core/page-preview: a
// [[link]] previews its note on hover while reading, needs ⌘ while editing, links in it work, it closes when the pointer
// leaves) and All properties (plugins/core/properties: the panel's counts, rename everywhere with Undo). Screenshots in
// light and dark. WRITES a "Qa editing" folder and renames a property in it: throwaway server only.
//   node web/qa/editing.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json" }
const NOTE = "Qa editing/Folding and finding.md", OTHER = "Qa editing/Linked note.md"
const write = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path, text, base: null }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${encodeURIComponent(path)}`)).json()).text
const props = async () => (await (await fetch(`${B}api/properties`)).json())

await write(OTHER, `---\ntype: note\nkind: note\nqa_stage: draft\n---\n\nIntro line of the linked note.\n\n${Array.from({ length: 30 }, (_, i) => `Filler line ${i}.`).join("\n\n")}\n\n## Far section\n\nA line under the far section with [[Alice Martin]] in it.\n\n${Array.from({ length: 30 }, (_, i) => `More filler ${i}.`).join("\n\n")}\n`)
await write(NOTE, `---
type: note
kind: note
qa_stage: draft # a comment that stays
tags: [Qa]
---

Intro with a link to [[Linked note]] and one to [[Linked note#Far section]].

## Apples

Apple pie and apple juice. apple.

- Fruit
  - Apple
  - Pear
- Vegetables

\`\`\`bash
# not a heading
echo apple
\`\`\`

### Small apples

Crab apple.

## Bananas

Banana bread.
`)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const page = watch(await ctx.newPage())
const palette = async (name) => {
  await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type(name); await wait(300)
  const none = await page.getByText("No command matches").count()
  await page.keyboard.press(none ? "Escape" : "Enter"); await wait(700)
  return !none
}
const ed = page.locator(".file-view .vau-editor").first()
const line = (text) => ed.locator(".cm-line", { hasText: text }).first()
const count = () => page.locator("[data-find-count]").textContent()
const total = async () => Number(/(\d+)(?: results?)?$/.exec(await count())?.[1] ?? -1)
const shot = async (name) => { await page.screenshot({ path: `${OUT}editing-${name}.png` }) }

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(2000)
await palette("Switch to live preview")

// ---------- find and replace ----------
await line("Banana bread").click(); await wait(200)
await page.keyboard.press("ControlOrMeta+f"); await wait(500)
check("⌘F opens the find bar", await page.locator("[data-find-bar]").count() === 1)
check("the keyboard is in the find field", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "Find")
await page.keyboard.type("apple"); await wait(400)
check(`typing finds as you go, from the cursor round to the top, with a count (${await count()})`, /^1 of 8$/.test(await count()))
check("the matches are lit in the text", await ed.locator(".cm-searchMatch").count() >= 5)
await page.keyboard.press("Enter"); await wait(200)
const second = await count()
await page.keyboard.press("Shift+Enter"); await wait(200)
check(`Enter and Shift+Enter move between matches (${second} -> ${await count()})`, second !== await count())
await page.locator("button[aria-label='Match case']").click(); await wait(300)
check(`match case narrows it (${await count()})`, await total() === 5)
await page.locator("button[aria-label='Whole word']").click(); await wait(300)
check(`whole word narrows it more (${await count()})`, await total() === 4)
await page.locator("button[aria-label='Whole word']").click(); await page.locator("button[aria-label='Match case']").click(); await wait(200)
await shot("find-light")
await page.keyboard.press("Escape"); await wait(300)
check("Escape closes it", await page.locator("[data-find-bar]").count() === 0)
// Replace
await line("Banana bread").click(); await wait(200)
await page.keyboard.press("ControlOrMeta+Alt+f"); await wait(500)
check("⌥⌘F opens it with replace", await page.locator("input[aria-label=Replace]").count() === 1)
await page.locator("input[aria-label=Find]").fill("banana"); await wait(200)
await page.locator("input[aria-label=Replace]").fill("plantain"); await wait(200)
await page.getByRole("button", { name: "Replace all" }).click(); await wait(1400)
check("replace all writes every match", (await read(NOTE)).includes("plantain bread") && !/banana/i.test((await read(NOTE)).replace("## Bananas", "")))
await page.keyboard.press("Escape"); await wait(200)
await page.keyboard.press("ControlOrMeta+z"); await wait(1400)
check("⌘Z undoes the replace all", (await read(NOTE)).includes("Banana bread"))
// Reading: find only
await page.keyboard.press("ControlOrMeta+e"); await wait(800)
await page.keyboard.press("ControlOrMeta+f"); await wait(500)
check("reading view: ⌘F finds, without replace", await page.locator("[data-find-bar]").count() === 1 && await page.locator("input[aria-label=Replace]").count() === 0
  && await page.locator("button[aria-label='Show replace']").count() === 0)
await page.keyboard.type("crab"); await wait(300)
check(`reading view finds (${await count()})`, /1/.test(await count()))
await page.keyboard.press("Escape"); await wait(200)
await page.keyboard.press("ControlOrMeta+e"); await wait(800)

// ---------- folding ----------
const apples = line("Apples")
await apples.hover(); await wait(300)
const chev = page.locator(".cm-vau-fold.is-hover")
check("pointing at a heading shows its chevron", await chev.count() === 1)
await shot("fold-hover")
const chevBox = await chev.boundingBox(), textBox = await apples.boundingBox()
check("the chevron is in the margin, left of the text", chevBox && textBox && chevBox.x + chevBox.width <= textBox.x + 1)
check("headings and list items with children fold; nothing else", await page.locator(".cm-vau-fold[data-fold-from]").count() >= 4)
await chev.click(); await wait(400)
check("folding a heading hides its section, subheadings included, not the next heading's",
  await line("Apple pie").count() === 0 && await line("Crab apple").count() === 0 && await line("Banana bread").count() === 1)
check("a … marks the fold", await ed.locator(".cm-foldPlaceholder").count() === 1)
await shot("folded")
// remembered
await page.reload(); await wait(2500)
check("the fold is remembered after a reload", await line("Apple pie").count() === 0 && await ed.locator(".cm-foldPlaceholder").count() === 1)
await palette("Unfold all headings and lists"); await wait(300)
check("Unfold all shows everything again", await line("Apple pie").count() === 1)
await palette("Fold all headings and lists"); await wait(300)
check("Fold all folds every heading and list", await line("Banana bread").count() === 0 && await line("Pear").count() === 0)
check("(inside a folded section)", await line("not a heading").count() === 0)
await palette("Unfold all headings and lists"); await wait(300)
await line("not a heading").hover(); await wait(200)
check("a # line in a code block isn't a heading", await page.locator(".cm-vau-fold.is-hover").count() === 0)
await line("Fruit").click(); await wait(100)
await page.keyboard.press("ControlOrMeta+Alt+["); await wait(300)
check("⌥⌘[ folds the list item the cursor is on", await line("Pear").count() === 0 && await line("Vegetables").count() === 1)
await page.keyboard.press("ControlOrMeta+Alt+["); await wait(300)
check("⌥⌘[ again unfolds it", await line("Pear").count() === 1)
await palette("Switch to source mode")
await line("## Apples").hover(); await wait(200)
check("source mode folds too", await page.locator(".cm-vau-fold.is-hover").count() === 1)
await palette("Switch to live preview")

// ---------- page preview ----------
await page.keyboard.press("ControlOrMeta+e"); await wait(800) // reading
const link = ed.locator("[data-wiki='Linked note']").first()
await link.hover(); await wait(1000)
const pop = page.locator("[data-preview-level='0']")
check("reading: resting on a link previews its note", await pop.count() === 1)
check("the preview shows the note's text", /Intro line of the linked note/.test(await pop.textContent() ?? ""))
await shot("preview-light")
await page.mouse.move(5, 500); await wait(900)
check("it closes when the pointer leaves", await pop.count() === 0)
await ed.locator("[data-wiki='Linked note#Far section']").first().hover(); await wait(1000)
const scrolled = await page.locator("[data-preview-body]").evaluate((b) => {
  const h = [...b.querySelectorAll("h2")].find((x) => /Far section/.test(x.textContent))
  return h ? Math.round(h.getBoundingClientRect().top - b.getBoundingClientRect().top) : null
}).catch(() => null)
check(`a heading link previews at that heading (${scrolled})`, scrolled !== null && scrolled < 40)
// a link inside the preview previews too, and a click follows it
await page.locator("[data-preview-level='0'] [data-wiki='Alice Martin']").hover(); await wait(1000)
check("a link in a preview previews in turn", await page.locator("[data-preview-level='1']").count() === 1)
await page.locator("[data-preview-level='0'] [data-wiki='Alice Martin']").click(); await wait(1200)
check("clicking a link in a preview follows it and closes the previews", await page.locator("[data-preview-level]").count() === 0 && decodeURIComponent(page.url()).includes("Alice Martin"))
await page.goBack(); await wait(1500)
await palette("Switch to live preview")
await ed.locator("[data-wiki='Linked note']").first().hover(); await wait(1000)
check("editing: pointing alone doesn't preview", await page.locator("[data-preview-level]").count() === 0)
await page.keyboard.down("ControlOrMeta"); await wait(500)
check("editing: with ⌘ held it does", await page.locator("[data-preview-level]").count() === 1)
await page.keyboard.up("ControlOrMeta"); await page.mouse.move(5, 500); await wait(900)

// ---------- all properties ----------
const before = (await props()).find((p) => p.key === "qa_stage")
check(`GET /api/properties counts a key and its type (${JSON.stringify(before)})`, before?.count === 2 && before.type === "text")
await page.evaluate(() => fetch("api/config/sidebars", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: ["properties:properties"] }) }))
await palette("Open all properties in a tab"); await wait(800)
const row = page.locator("[data-properties-view] [data-property='qa_stage']")
check("the tab lists qa_stage with its count", await row.count() === 1 && /2/.test(await row.textContent()))
await shot("properties-light")
await row.click({ button: "right" }); await wait(300)
await page.getByRole("menuitem", { name: "Rename property…" }).click(); await wait(300)
await page.keyboard.type("qa_phase"); await wait(200); await page.keyboard.press("Enter"); await wait(400)
await page.getByRole("button", { name: "Rename", exact: true }).click(); await wait(1500)
const text = await read(NOTE)
check("renamed in the file: only the key's text changed, its comment stayed", text.includes("qa_phase: draft # a comment that stays") && !text.includes("qa_stage"))
check("and in every other file that had it", (await read(OTHER)).includes("qa_phase: draft"))
await page.waitForTimeout(800)
check("the list follows the vault", await page.locator("[data-properties-view] [data-property='qa_phase']").count() === 1)
await page.getByRole("button", { name: "Undo" }).click(); await wait(1500)
check("Undo renames it back", (await read(NOTE)).includes("qa_stage: draft # a comment that stays"))

// dark
await page.emulateMedia({ colorScheme: "dark" })
await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(NOTE)}`); await wait(1500)
await line("Banana bread").click(); await page.keyboard.press("ControlOrMeta+Alt+f"); await wait(300); await page.keyboard.type("apple"); await wait(300)
await line("Apples").hover(); await wait(300)
await shot("find-dark")
await page.keyboard.press("Escape")
await ctx.close()

// A phone: no previews, the find bar fits.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(2000)
  await page.locator("[data-view-toggle]").click().catch(() => {}); await wait(600)
  await page.evaluate(() => document.querySelector(".file-view .cm-content")?.focus())
  await page.keyboard.press("ControlOrMeta+f"); await wait(500)
  const bar = await page.locator("[data-find-bar]").boundingBox()
  check("phone: the find bar fits the width", bar && bar.width <= 390 && await page.evaluate(() => document.documentElement.scrollWidth <= 390))
  await page.screenshot({ path: `${OUT}editing-phone.png` })
  await ctx.close()
}
await done()
