// Editing: find and replace (a card, on a phone a strip), folding, page preview and All properties, light and dark.
// WRITES a "Qa editing" folder and renames a property in it: throwaway server.
//   node web/qa/editing.mjs <base url> [out dir]
// Paths: plugins/core/find
import { mkdirSync } from "node:fs"
import { SHOTS, command, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json" }
const NOTE = "Qa editing/Folding and finding.md", OTHER = "Qa editing/Linked note.md", BLOCKS = "Qa editing/Find in blocks.md",
  DASH = "Qa editing/Find dashboard.md"
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
const page = watch(await ctx.newPage()), ui = app(page)
const palette = async (name) => { const hit = await command(page, name, 0); await ui.idle(); return hit }
const ed = page.locator(".file-view .vau-editor").first()
const line = (text) => ed.locator(".cm-line", { hasText: text }).first()
const count = () => page.locator("[data-find-count]").textContent()
const total = async () => Number(/(\d+)(?: results?)?$/.exec(await count())?.[1] ?? -1)
const shot = async (name) => { await page.screenshot({ path: `${OUT}editing-${name}.png` }) }

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await ed.waitFor(); await ui.idle()
await palette("Switch to live preview")

await line("Banana bread").click(); await ui.idle()
const textAt = async () => (await line("Banana bread").boundingBox()).y
const textWas = await textAt()
await page.keyboard.press("ControlOrMeta+f"); await ui.idle()
check("⌘F opens the find bar", await page.locator("[data-find-bar]").count() === 1)
const spot = () => page.evaluate(() => {
  const c = document.querySelector("[data-find-bar]").getBoundingClientRect(), p = document.querySelector("#main-scroll").getBoundingClientRect()
  return { right: Math.round(p.right - c.right), top: Math.round(c.top - p.top), width: Math.round(c.width) }
})
const placed = await spot()
check(`it floats at the pane's top right, under its bar, not at the text's edge (${JSON.stringify(placed)})`, placed.right >= 8 && placed.right <= 16 && placed.top >= 44 && placed.top <= 52 && placed.width <= 440)
check("the text doesn't move for it", Math.abs(await textAt() - textWas) < 1)
check("the keyboard is in the find field", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "Find")
await page.keyboard.type("apple"); await ui.idle()
check(`typing finds as you go, from the cursor round to the top, with a count (${await count()})`, /^1 of 8$/.test(await count()))
check("the matches are lit in the text", await ed.locator(".cm-searchMatch").count() >= 5)
await page.keyboard.press("Enter"); await ui.idle()
const second = await count()
await page.keyboard.press("Shift+Enter"); await ui.idle()
check(`Enter and Shift+Enter move between matches (${second} -> ${await count()})`, second !== await count())
await page.locator("button[aria-label='Match case']").click(); await ui.idle()
check(`match case narrows it (${await count()})`, await total() === 5)
await page.locator("button[aria-label='Whole word']").click(); await ui.idle()
check(`whole word narrows it more (${await count()})`, await total() === 4)
await page.locator("button[aria-label='Whole word']").click(); await page.locator("button[aria-label='Match case']").click(); await ui.idle()
await shot("find-light")
await page.keyboard.press("Escape"); await ui.idle()
check("Escape closes it", await page.locator("[data-find-bar]").count() === 0)
await line("Banana bread").click(); await ui.idle()
await page.keyboard.press("ControlOrMeta+Alt+f"); await ui.idle()
check("⌥⌘F opens it with replace", await page.locator("input[aria-label=Replace]").count() === 1)
await page.locator("input[aria-label=Find]").fill("banana"); await ui.idle()
await page.locator("input[aria-label=Replace]").fill("plantain"); await ui.idle()
await page.getByRole("button", { name: "Replace all" }).click()
check("replace all writes every match", await until(async () => (await read(NOTE)).includes("plantain bread") && !/banana/i.test((await read(NOTE)).replace("## Bananas", ""))))
await page.keyboard.press("Escape"); await ui.idle()
await page.keyboard.press("ControlOrMeta+z")
check("⌘Z undoes the replace all", await until(async () => (await read(NOTE)).includes("Banana bread")))
await page.keyboard.press("ControlOrMeta+e"); await ui.idle()
await page.keyboard.press("ControlOrMeta+f"); await ui.idle()
check("reading view: ⌘F finds, without replace", await page.locator("[data-find-bar]").count() === 1 && await page.locator("input[aria-label=Replace]").count() === 0
  && await page.locator("button[aria-label='Show replace']").count() === 0)
await page.keyboard.type("crab"); await ui.idle()
check(`reading view finds (${await count()})`, /1/.test(await count()))
await page.keyboard.press("Escape"); await ui.idle()
await page.keyboard.press("ControlOrMeta+e"); await ui.idle()

await write(BLOCKS, `---\ntype: note\nqa_word: zebra\n---\n\nA zebra up top, and a [link](https://zebra.example).\n\n${Array.from({ length: 40 }, (_, i) => `Filler ${i}.`).join("\n\n")}
\n| Animal | Note |\n| --- | --- |\n${Array.from({ length: 20 }, (_, i) => `| ${i === 14 ? "zebra" : "horse"} | row ${i} |`).join("\n")}\n\n> [!note] A callout\n> With a zebra.\n\n<details><summary>More</summary>\n\nA zebra folded away.\n\n</details>\n\nEnd.\n`)
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(BLOCKS)}`); await ed.waitFor(); await ui.idle()
await palette("Switch to live preview")
await line("A zebra up top").click(); await page.keyboard.press("Home"); await ui.idle()
await page.keyboard.press("ControlOrMeta+f"); await ui.idle()
await page.keyboard.type("zebra"); await ui.idle()
check(`live preview finds what's shown, not the frontmatter or a link's address (${await count()})`, await count() === "1 of 4")
const current = () => page.evaluate(() => {
  const r = [...(CSS.highlights.get("vau-find-current") ?? [])][0], box = r?.getBoundingClientRect()
  const head = document.querySelector("[data-find-bar]")?.getBoundingClientRect().bottom ?? 0
  return { in: r?.startContainer.parentElement?.closest(".cm-block")?.className.match(/cm-block-(\w+)/)?.[1] ?? null, seen: !!box && box.top >= head && box.bottom <= innerHeight }
})
await page.keyboard.press("Enter"); await ui.idle()
let at = await current()
check(`Enter goes to the one in the table: lit in its cell, in sight below the bar (${JSON.stringify(at)})`, at.in === "table" && at.seen)
check("the bar stayed put while the note scrolled to it", await page.locator("#main-scroll").evaluate((el) => el.scrollTop > 300) && JSON.stringify(await spot()) === JSON.stringify(placed))
await page.keyboard.press("Enter"); await ui.idle()
at = await current()
check(`then the callout's (${JSON.stringify(at)})`, at.in === "callout" && at.seen)
await page.keyboard.press("Enter"); await ui.idle()
at = await current()
check(`then the closed <details>' one: opened, in sight (${JSON.stringify(at)})`, at.in === "details" && at.seen && await page.locator(".cm-block-details details[open]").count() === 1)
check("the others in blocks are lit too", await page.evaluate(() => CSS.highlights.get("vau-find")?.size ?? 0) >= 2)
await page.keyboard.press("Escape"); await ui.idle()
check("closing the bar puts the highlights away", await page.evaluate(() => !CSS.highlights.has("vau-find") && !CSS.highlights.has("vau-find-current")))
await palette("Switch to source mode")
await ed.locator(".cm-content").focus(); await page.keyboard.press("ControlOrMeta+Home"); await ui.idle()
await page.keyboard.press("ControlOrMeta+f"); await ui.idle()
await page.keyboard.type("zebra"); await ui.idle()
check(`source mode finds it all (${await count()})`, await total() === 6)
await page.keyboard.press("Escape"); await ui.idle()
await palette("Switch to live preview")
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await ed.waitFor(); await ui.idle()

const apples = line("Apples")
await apples.hover(); await ui.idle()
const chev = page.locator(".cm-vau-fold.is-hover")
check("pointing at a heading shows its chevron", await chev.count() === 1)
await shot("fold-hover")
const chevBox = await chev.boundingBox(), textBox = await apples.boundingBox()
check("the chevron is in the margin, left of the text", chevBox && textBox && chevBox.x + chevBox.width <= textBox.x + 1)
check("headings and list items with children fold; nothing else", await page.locator(".cm-vau-fold").count() >= 4)
await chev.click(); await ui.idle()
check("folding a heading hides its section, subheadings included, not the next heading's",
  await line("Apple pie").count() === 0 && await line("Crab apple").count() === 0 && await line("Banana bread").count() === 1)
check("a … marks the fold", await ed.locator(".cm-foldPlaceholder").count() === 1)
await shot("folded")
await ui.saved()
check("the fold is kept", await page.evaluate((p) => !!JSON.parse(localStorage.getItem("vaultite.folds") ?? "{}")[p], NOTE))
await page.reload()
check("the fold is remembered after a reload", await until(async () => await line("Apple pie").count() === 0 && await ed.locator(".cm-foldPlaceholder").count() === 1, 10000))
await palette("Unfold all headings and lists")
check("Unfold all shows everything again", await line("Apple pie").count() === 1)
await palette("Fold all headings and lists")
check("Fold all folds every heading and list", await line("Banana bread").count() === 0 && await line("Pear").count() === 0)
check("(inside a folded section)", await line("not a heading").count() === 0)
await palette("Unfold all headings and lists")
await line("not a heading").hover(); await ui.idle()
check("a # line in a code block isn't a heading", await page.locator(".cm-vau-fold.is-hover").count() === 0)
await line("Fruit").click(); await ui.idle()
await page.keyboard.press("ControlOrMeta+Alt+["); await ui.idle()
check("⌥⌘[ folds the list item the cursor is on", await line("Pear").count() === 0 && await line("Vegetables").count() === 1)
await page.keyboard.press("ControlOrMeta+Alt+["); await ui.idle()
check("⌥⌘[ again unfolds it", await line("Pear").count() === 1)
await palette("Switch to source mode")
await line("## Apples").hover(); await ui.idle()
check("source mode folds too", await page.locator(".cm-vau-fold.is-hover").count() === 1)
await palette("Switch to live preview")

await page.keyboard.press("ControlOrMeta+e"); await ui.idle()
const link = ed.locator("[data-wiki='Linked note']").first()
const pop = page.locator("[data-preview-level='0']")
await link.hover(); await until(async () => await pop.count() === 1); await ui.idle()
check("reading: resting on a link previews its note", await pop.count() === 1)
check("the preview shows the note's text", /Intro line of the linked note/.test(await pop.textContent() ?? ""))
await shot("preview-light")
await page.mouse.move(5, 500); await until(async () => await pop.count() === 0); await ui.idle()
check("it closes when the pointer leaves", await pop.count() === 0)
await ed.locator("[data-wiki='Linked note#Far section']").first().hover(); await until(async () => await pop.count() === 1); await ui.idle()
const scrolled = await page.locator("[data-preview-body]").evaluate((b) => {
  const h = [...b.querySelectorAll("h2")].find((x) => /Far section/.test(x.textContent))
  return h ? Math.round(h.getBoundingClientRect().top - b.getBoundingClientRect().top) : null
}).catch(() => null)
check(`a heading link previews at that heading (${scrolled})`, scrolled !== null && scrolled < 40)
await page.locator("[data-preview-level='0'] [data-wiki='Alice Martin']").hover()
check("a link in a preview previews in turn", await until(async () => await page.locator("[data-preview-level='1']").count() === 1))
await page.locator("[data-preview-level='0'] [data-wiki='Alice Martin']").click()
check("clicking a link in a preview follows it and closes the previews", await until(async () => await page.locator("[data-preview-level]").count() === 0 && decodeURIComponent(page.url()).includes("Alice Martin")))
await page.goBack(); await ed.waitFor(); await ui.idle()
await palette("Switch to live preview")
await ed.locator("[data-wiki='Linked note']").first().hover(); await ui.idle()
check("editing: pointing alone doesn't preview", await page.locator("[data-preview-level]").count() === 0)
await page.keyboard.down("ControlOrMeta"); await ui.idle()
check("editing: with ⌘ held it does", await page.locator("[data-preview-level]").count() === 1)
await page.keyboard.up("ControlOrMeta"); await page.mouse.move(5, 500); await until(async () => await page.locator("[data-preview-level]").count() === 0); await ui.idle()

const before = (await props()).find((p) => p.key === "qa_stage")
check(`GET /api/properties counts a key and its type (${JSON.stringify(before)})`, before?.count === 2 && before.type === "text")
await page.evaluate(() => fetch("api/config/sidebars", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: ["properties:properties"] }) }))
await palette("Open all properties in a tab")
const row = page.locator("[data-properties-view] [data-property='qa_stage']")
check("the tab lists qa_stage with its count", await row.count() === 1 && /2/.test(await row.textContent()))
await shot("properties-light")
await ui.menu.context(row); await ui.menu.pick("Rename property…")
await page.keyboard.type("qa_phase"); await ui.idle(); await page.keyboard.press("Enter"); await ui.idle()
await ui.sees(NOTE, () => page.getByRole("button", { name: "Rename", exact: true }).click())
const text = await read(NOTE)
check("renamed in the file: only the key's text changed, its comment stayed", text.includes("qa_phase: draft # a comment that stays") && !text.includes("qa_stage"))
check("and in every other file that had it", (await read(OTHER)).includes("qa_phase: draft"))
check("the list follows the vault", await until(async () => await page.locator("[data-properties-view] [data-property='qa_phase']").count() === 1))
await page.getByRole("button", { name: "Undo" }).click()
check("Undo renames it back", await until(async () => (await read(NOTE)).includes("qa_stage: draft # a comment that stays")))

await page.emulateMedia({ colorScheme: "dark" })
await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(NOTE)}`); await line("Banana bread").waitFor(); await ui.idle()
await line("Banana bread").click(); await page.keyboard.press("ControlOrMeta+Alt+f"); await ui.idle(); await page.keyboard.type("apple"); await ui.idle()
await line("Apples").hover(); await ui.idle()
await shot("find-dark")
await page.keyboard.press("Escape")

await write(DASH, `---\ntype: dashboard\n---\n\nA marmot up top.\n\n${Array.from({ length: 60 }, (_, i) => (i % 15 === 14 ? `Line ${i}, a marmot.` : `Line ${i}.`)).join("\n\n")}\n`)
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(DASH)}`); await page.locator("#main-scroll", { hasText: "A marmot up top" }).waitFor(); await ui.idle()
await page.locator("#main-scroll").click({ position: { x: 400, y: 300 } }); await ui.idle()
await page.keyboard.press("ControlOrMeta+f"); await ui.idle()
check("a dashboard: ⌘F opens the page's find bar", await page.locator("[data-page-find]").count() === 1)
await page.keyboard.type("marmot"); await ui.idle()
const pageCount = await page.locator("[data-page-find] [data-find-count]").textContent()
await page.keyboard.press("Enter"); await ui.idle()
const lit = await page.evaluate(() => {
  const r = [...(CSS.highlights.get("vau-find-current") ?? [])][0]?.getBoundingClientRect()
  return { all: CSS.highlights.get("vau-find")?.size ?? 0, seen: !!r && r.top > 0 && r.bottom < innerHeight }
})
check(`it counts what's drawn and Enter goes to the next, lit and in sight (${pageCount}, ${JSON.stringify(lit)})`, pageCount === "1 of 5" && lit.all === 5 && lit.seen)
await page.keyboard.press("Escape"); await ui.idle()
check("Escape closes it and puts the highlights away", await page.locator("[data-page-find]").count() === 0 && await page.evaluate(() => !CSS.highlights.has("vau-find")))
await ctx.close()

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage(), ui = app(page)
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await page.locator(".file-view").first().waitFor(); await ui.idle()
  await page.locator("[data-view-toggle]").click().catch(() => {}); await ui.idle()
  await page.evaluate(() => document.querySelector(".file-view .cm-content")?.focus())
  await page.keyboard.press("ControlOrMeta+f"); await ui.idle()
  const bar = await page.locator("[data-find-bar]").boundingBox()
  check("phone: the find bar fits the width", bar && bar.width <= 390 && await page.evaluate(() => document.documentElement.scrollWidth <= 390))
  check("phone: a strip across the top, not a card", await page.locator(".cm-panels-top [data-find-bar]").count() === 1 && bar.width >= 340)
  await page.screenshot({ path: `${OUT}editing-phone.png` })
  await ctx.close()
}
await done()
