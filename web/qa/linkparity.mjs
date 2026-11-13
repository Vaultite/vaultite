// [[note#^ blocks, [[## and [[^^, Copy link to block, drags onto a note's text, link format, backlinks in document (linkComplete.ts, linkDrop.ts, blockLink.ts, Links.tsx).
// WRITES "Qa links/", files.json, sidebars, the Links plugin's settings (put back): throwaway only.   node web/qa/linkparity.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync } from "node:fs"
import { SHOTS, apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const DIR = "Qa links", HERE = `${DIR}/Here.md`, TARGET = `${DIR}/Target.md`
const put = (path, text) => api("PUT", "file", { path, text, base: null })
const read = (p) => { try { return readFileSync(`${VAULT}/${p}`, "utf8") } catch { return "" } }
const saved = async (test, p = HERE) => !!(await until(() => test(read(p)), 5000))
const line = (text, s) => text.split("\n").find((l) => l.includes(s)) ?? text

await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await put(TARGET, "# Target\n\nThe launch checklist is ready.\n\n- Ask Alice about the budget\n- Book the room\n\n## Agenda\n\nWho comes.\n")
await put(HERE, "First line.\n")
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
await fetch(`${B}api/upload?path=${encodeURIComponent(`${DIR}/pic.png`)}`, { method: "POST", body: png })
const filesBefore = await api("GET", "config/files")
const SIDE = `${DIR}/Side.md`, sidebarsBefore = await api("GET", "config/sidebars")
await put(SIDE, "Docked note.\n")
for (const n of [1, 2, 3, 4, 5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
await api("PUT", "config/sidebars", { left: ["files:files"], right: ["outline:outline", `pages:file/${SIDE}`], collapsed: [], heights: {} })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
const page = watch(await ctx.newPage()), ui = app(page)
const menu = page.locator(".cm-tooltip-autocomplete")
const ready = async (name) => { await menu.locator("li", { hasText: name }).first().waitFor({ timeout: 5000 }); await ui.idle() }
const content = page.locator("#main-scroll .vau-editor .cm-content[contenteditable=true]")

async function openHere() {
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(HERE)}`)
  await page.locator(".vau-editor .cm-line", { hasText: "First line." }).first().waitFor(); await ui.idle()
  if (!(await content.count())) await page.keyboard.press("ControlOrMeta+e")
  await content.waitFor(); await ui.idle()
}
const end = async () => { await content.click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.press("Enter") }

await openHere(); await end()
await page.keyboard.type("Blocks: [[Target#^"); await ready("Ask Alice")
await page.screenshot({ path: `${OUT}link-parity-block-suggest.png` })
const offered = await menu.locator("li").allInnerTexts()
check("[[note#^ lists the note's paragraphs and list items, not its headings", offered.some((t) => t.includes("The launch checklist")) && offered.some((t) => t.includes("Book the room")) && !offered.some((t) => t.startsWith("Agenda")), offered)
await menu.locator("li", { hasText: "Ask Alice" }).click()
const id = (await until(() => /- Ask Alice about the budget \^([a-z0-9]{6})\n/.exec(read(TARGET))?.[1], 5000)) ?? ""
check("…picked: the block gets a ^id in its note, the rest as it was", !!id && read(TARGET).replace(/^---\n[\s\S]*?\n---\n\n/, "") === `# Target\n\nThe launch checklist is ready.\n\n- Ask Alice about the budget ^${id}\n- Book the room\n\n## Agenda\n\nWho comes.\n`, read(TARGET))
check("…and the link to it goes in", await saved((t) => t.includes(`Blocks: [[Target#^${id}]]`)), line(read(HERE), "Blocks"))

await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("Across: [[^^launch check"); await ready("The launch checklist")
await menu.locator("li", { hasText: "The launch checklist" }).click()
const id2 = (await until(() => /The launch checklist is ready\. \^([a-z0-9]{6})\n/.exec(read(TARGET))?.[1], 5000)) ?? ""
check("[[^^ finds blocks across the vault; picked, it gets an id and its link", !!id2 && await saved((t) => t.includes(`Across: [[Target#^${id2}]]`)), [line(read(HERE), "Across"), read(TARGET)])
await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("Heads: [[##agen"); await ready("Agenda")
await menu.locator("li", { hasText: "Agenda" }).click()
check("[[## finds headings across the vault", await saved((t) => t.includes("Heads: [[Target#Agenda]]")), line(read(HERE), "Heads"))

await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("Copy this paragraph."); await ui.saved()
await page.locator(".vau-editor .cm-line", { hasText: "Copy this paragraph." }).click({ button: "right" })
await page.locator("[role=menu]").last().waitFor()
const items = await ui.menu.items()
check("the editor's menu on a paragraph: Copy link to block", items.includes("Copy link to block"), items)
await ui.menu.pick("Copy link to block")
await ui.toast.wait("Copied the link").catch(() => {})
check("…it gives the block an id in the note", await saved((t) => /Copy this paragraph\. \^[a-z0-9]{6}\n?/.test(t)), line(read(HERE), "Copy this"))
check("…and says the link is copied", (await ui.toast()).some((t) => t.includes("Copied the link")), await ui.toast())

const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
if (!(await row(TARGET).isVisible().catch(() => false))) { await row(DIR).click(); await row(TARGET).waitFor() }
async function drag(from, to) {
  const f = await from.boundingBox(), t = await to.boundingBox()
  const [fx, fy, tx, ty] = [f.x + 30, f.y + f.height / 2, t.x + t.width - 4, t.y + t.height / 2]
  await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx + 8, fy + 4, { steps: 2 })
  await page.mouse.move(tx, ty, { steps: 10 }); await ui.idle()
  const caret = await page.locator(".cm-file-drop").count()
  await page.mouse.up(); await ui.idle()
  return caret
}
const first = page.locator(".vau-editor .cm-line", { hasText: "First line." }).first()
const caret = await drag(row(TARGET), first)
check("a file dragged from the tree onto a note's text: a caret where it goes", caret === 1, caret)
check("…dropped: its link at that point", await saved((t) => t.startsWith("First line.[[Target]]\n") || t.includes("\nFirst line.[[Target]]\n")), line(read(HERE), "First line"))
await drag(row(`${DIR}/pic.png`), page.locator(".vau-editor .cm-line", { hasText: "Copy this paragraph." }))
check("an image dragged in is embedded", await saved((t) => /Copy this paragraph\. \^[a-z0-9]{6}!\[\[pic\.png\]\]/.test(t)), line(read(HERE), "Copy this"))
const panes = await ui.pane.all()
check("…and the pane under the text didn't open them", panes.length === 1 && panes[0] === "Here", panes)

const docked = page.locator(`[data-file-panel="${SIDE}"] .cm-line`, { hasText: "Docked note." }).first()
await docked.waitFor({ timeout: 8000 }); await ui.idle()
const layout = JSON.stringify(await api("GET", "config/sidebars"))
await drag(row(TARGET), docked)
check("a file dropped onto the text of a note docked in a sidebar: its link there, the sidebar's panels as they were",
  await saved((t) => t.endsWith("\nDocked note.[[Target]]\n"), SIDE) && JSON.stringify(await api("GET", "config/sidebars")) === layout, [await api("GET", "config/sidebars"), read(SIDE)])

await api("PATCH", "config/files", { wikilinks: false, linkFormat: "absolute" })
await openHere(); await end()
await page.keyboard.type("Markdown: [[Targ"); await ready("Target")
await page.keyboard.press("Enter")
check("Use wikilinks off, absolute paths: a pick is a Markdown link from the vault's top", await saved((t) => t.includes("Markdown: [Target](Qa%20links/Target.md)")), line(read(HERE), "Markdown"))
await api("PATCH", "config/files", { wikilinks: filesBefore.wikilinks ?? null, linkFormat: filesBefore.linkFormat ?? null })

await api("PATCH", "config/plugin/backlinks", { inDocument: true })
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(TARGET)}`)
const under = page.locator("[data-links-in-note]")
await under.locator("[data-link-item=Here]").first().waitFor({ timeout: 8000 }).catch(() => {})
await under.scrollIntoViewIfNeeded().catch(() => {}); await ui.idle()
await page.screenshot({ path: `${OUT}link-parity-backlinks-in-document.png` })
check("Backlinks in document on: the note's linked mentions under its text", await under.locator("[data-link-item=Here]").count() > 0)
check("…without its outgoing links", await under.locator("[data-links-group=outgoing]").count() === 0)
await api("PATCH", "config/plugin/backlinks", { inDocument: null })
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(TARGET)}`)
await page.locator(".vau-editor .cm-line", { hasText: "Who comes." }).first().waitFor(); await ui.idle()
check("off (the default): nothing under the note", await page.locator("[data-links-in-note]").count() === 0)

await ctx.close()
await api("PUT", "config/sidebars", sidebarsBefore)
await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await done()
