// An Obsidian vault in the app: note embeds (a section, a block, one that embeds itself), heading and block links that
// scroll there, [[#Heading]] in the same file, #tags (styled, clickable, the Tags panel, a tag's sheet, renamed), its
// plugins' stand-ins (Obsidian settings' sheet), the Outline
// panel (click to go, the current heading lit; shown for the run: it's hidden until shown, like Tags), ==highlights==, %%comments%% and ^block ids hidden when reading,
// ![[image.png|120]], [[photo.png]] finding the attachment, .obsidian/app.json (new notes' folder, a pasted or dropped image's
// folder), the Design page, and a phone at 390px. WRITES a "Qa obsidian" folder, the vault's .obsidian/app.json and
// .vaultite/plugins.json and sidebars.json (put back): throwaway only.
//   node web/qa/obsidian.mjs <base url> <vault path> [out dir]
import fs from "node:fs"
import path from "node:path"
import { SHOTS, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const DIR = "Qa obsidian"
const filler = Array.from({ length: 60 }, (_, i) => `Filler line ${i + 1} to make the note long enough to scroll.`).join("\n\n")
const A = `---
tags: [qa-compat]
---
# Top

Intro with #qa-obs/inline and ==bright== text %%a secret%% ^intro

## Plans

- first ^li1
  - under it
- second

%%
hidden lines
%%

## Filler

${filler}

## Far

The far section.

${filler}
`
const Bn = `See [[Qa A#Far]] and [[Qa A#^li1]], [md](Qa%20A.md#Plans), [[#Mine]], [[qa-photo.png]].

${filler}

## Mine

![[Qa A#Plans]]

![[Qa A#^intro]]

![[Qa B]]

![[qa-photo.png|120]]
`
const put = (p, text) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p, text }) })
await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await put(`${DIR}/Qa A.md`, A)
await put(`${DIR}/Qa B.md`, Bn)
// A 60x30 PNG, drawn by a canvas-free encoder: a plain orange block.
const png = await (async () => {
  const { deflateSync, crc32 } = await import("node:zlib")
  const w = 60, h = 30, raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([230, 120, 30]))])))
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t), d])) >>> 0); return Buffer.concat([l, Buffer.from(t), d, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ihdr), ch("IDAT", deflateSync(raw)), ch("IEND", Buffer.alloc(0))])
})()
await fetch(`${B}api/upload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `${DIR}/Pics/qa-photo.png`, data: png.toString("base64") }) })
const appJson = path.join(VAULT, ".obsidian", "app.json")
const hadApp = fs.existsSync(appJson) ? fs.readFileSync(appJson, "utf8") : null
// Outline and Tags are hidden until shown (`hidden`): shown for the run, under the default panels in sidebars.json (put
// back), with Workspaces off (a workspace keeps sidebars of its own).
const pluginsJson = path.join(VAULT, ".vaultite", "plugins.json"), sidebarsJson = path.join(VAULT, ".vaultite", "sidebars.json")
const hadPlugins = fs.existsSync(pluginsJson) ? fs.readFileSync(pluginsJson, "utf8") : null
const hadSidebars = fs.existsSync(sidebarsJson) ? fs.readFileSync(sidebarsJson, "utf8") : null
const conf = hadPlugins ? JSON.parse(hadPlugins) : {}
fs.writeFileSync(pluginsJson, JSON.stringify({ ...conf, disabled: (conf.disabled ?? []).filter((d) => !["outline", "tags", "workspaces"].includes(d)).concat("workspaces") }, null, 2) + "\n")
fs.writeFileSync(sidebarsJson, JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files", "outline:outline", "tags:tags"], right: [], collapsed: [] }, null, 2) + "\n")
await wait(1000)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const ed = page.locator("#main-scroll .vau-editor")
/** Where an element is from the top of the focused pane (px), or null when it isn't there. */
const fromTop = (loc) => loc.first().evaluate((el) => el.getBoundingClientRect().top - document.querySelector("#main-scroll").getBoundingClientRect().top).catch(() => null)
const open = async (p) => { await page.goto(`${B}#file/${encodeURIComponent(p)}`); await wait(2000) }

// ---- reading B: embeds, attachments ----
await open(`${DIR}/Qa B.md`)
await palette(page, "Switch to reading view", 700); await wait(1500)
// (the editor draws only what's near the screen: the embeds are at the end. Scrolled with the wheel, as a reader does: a
// scroll from code doesn't stop the new view keeping its place, filePlace.ts, so it went back to the top)
const embeds = ed.locator(".note-embed")
const scroller = await page.locator("#main-scroll").boundingBox()
await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2)
await until(async () => { await page.mouse.wheel(0, 4000); return (await embeds.count()) === 3 }, 10000)
check(`reading: three note embeds (a section, a block, itself): ${await embeds.count()}`, await embeds.count() === 3)
check(`the section embed is that section, under a head naming it: ${JSON.stringify((await embeds.nth(0).innerText()).slice(0, 200))}`, await embeds.nth(0).locator(".note-embed-head", { hasText: "Qa A › Plans" }).count() === 1 && await embeds.nth(0).locator("li li", { hasText: "under it" }).count() === 1
  && !(await embeds.nth(0).innerText()).includes("Filler"))
check("the embed hides block ids and comments", !(await embeds.nth(0).innerText()).includes("^li1") && !(await embeds.nth(0).innerText()).includes("hidden lines"))
check("the block embed is that paragraph", (await embeds.nth(1).innerText()).includes("Intro with") && !(await embeds.nth(1).innerText()).includes("Filler"))
check("the block embed draws highlights and tags", await embeds.nth(1).locator("mark", { hasText: "bright" }).count() === 1 && await embeds.nth(1).locator("a.tag").count() === 1)
check("a note embedding itself says so", (await embeds.nth(2).innerText()).includes("embeds itself"))
check("![[qa-photo.png|120]] is the image at 120px", await ed.locator("img.cm-image").evaluate((i) => i.style.width === "120px" && i.naturalWidth === 60).catch(() => false))
await page.screenshot({ path: `${OUT}obsidian-embeds.png`, fullPage: false })
await embeds.nth(0).scrollIntoViewIfNeeded()
await embeds.nth(0).screenshot({ path: `${OUT}obsidian-embed.png` })
await page.locator("#main-scroll").evaluate((s) => s.scrollTo(0, 0)); await wait(500)
check("[[qa-photo.png]] finds the attachment by name", await ed.locator(".cm-wikilink:not(.is-missing)", { hasText: "qa-photo.png" }).count() === 1)

// ---- links to places ----
await page.locator("#main-scroll").evaluate((s) => s.scrollTo(0, 0)); await wait(200)
// (a heading link reads like everywhere else: "Mine" in the same file, "Qa A › Far" in another)
check("[[#Mine]] reads as the heading's name", await ed.locator('.cm-wikilink[data-wiki="#Mine"]').innerText() === "Mine")
await ed.locator('.cm-wikilink[data-wiki="#Mine"]').click(); await wait(1200)
let top = await fromTop(ed.locator(".cm-line.cm-h", { hasText: "Mine" }))
check(`[[#Mine]] scrolls to the heading in the same file (${top})`, top !== null && top >= 0 && top < 200)
await page.locator("#main-scroll").evaluate((s) => s.scrollTo(0, 0)); await wait(200)
check("[[Qa A#Far]] reads Qa A › Far", await ed.locator('.cm-wikilink[data-wiki="Qa A#Far"]').innerText() === "Qa A › Far")
await ed.locator('.cm-wikilink[data-wiki="Qa A#Far"]').click(); await wait(2000)
check("[[Qa A#Far]] opens Qa A", await page.evaluate(() => decodeURIComponent(location.hash)).then((h) => h.includes("Qa A.md")))
top = await fromTop(ed.locator(".cm-line.cm-h", { hasText: "Far" }))
check(`…scrolled to its Far heading (${top})`, top !== null && top >= 0 && top < 200)
await page.goBack(); await wait(1500)
await page.locator("#main-scroll").evaluate((s) => s.scrollTo(0, 0)); await wait(200)
await ed.locator(".cm-link", { hasText: "md" }).click(); await wait(2000)
top = await fromTop(ed.locator(".cm-line.cm-h", { hasText: "Plans" }))
check(`a Markdown link [md](Qa%20A.md#Plans) goes to the heading (${top})`, top !== null && top >= 0 && top < 200)

// ---- A in reading: hidden and drawn marks ----
await open(`${DIR}/Qa A.md`)
const text = await ed.innerText()
check("reading: comments and block ids hidden", !text.includes("a secret") && !text.includes("hidden lines") && !text.includes("^intro") && !text.includes("^li1"))
check("reading: a tag and a highlight", await ed.locator(".cm-tag", { hasText: "#qa-obs/inline" }).count() === 1 && await ed.locator(".cm-highlight", { hasText: "bright" }).count() === 1)
// The Outline panel.
const outline = page.locator("[data-outline-panel]")
check(`outline lists the headings: ${await outline.locator("[data-outline-item]").allInnerTexts()}`, await outline.locator("[data-outline-item]").allInnerTexts().then((t) => t.join("|") === "Top|Plans|Filler|Far"))
await outline.locator('[data-outline-item="Far"]').click(); await wait(1200)
top = await fromTop(ed.locator(".cm-line.cm-h", { hasText: "Far" }))
check(`outline: clicking Far scrolls there (${top})`, top !== null && top >= 0 && top < 200)
check("outline: Far is lit", await outline.locator('[data-outline-item="Far"][aria-current]').count() === 1)
await page.locator("#main-scroll").evaluate((s) => s.scrollTo(0, 0)); await wait(500)
check("outline: back at the top, Top is lit", await outline.locator('[data-outline-item="Top"][aria-current]').count() === 1)
await outline.screenshot({ path: `${OUT}obsidian-outline.png` })
// Live preview: comments faint, the id on the cursor's line.
await palette(page, "Switch to live preview", 700); await wait(800)
await page.locator("#main-scroll").evaluate((s) => s.scrollTo(0, 0)); await wait(600)
check(`live preview: comments show, faint (${await page.evaluate(() => document.querySelector("#main-scroll .cm-content")?.getAttribute("contenteditable"))})`, await ed.locator(".cm-comment").count() >= 1)
await ed.locator(".cm-line", { hasText: "first" }).first().click(); await wait(300)
check("live preview: the block id shows on the cursor's line", await ed.locator(".cm-blockid", { hasText: "^li1" }).count() === 1)
await palette(page, "Switch to reading view", 700); await wait(800)

// ---- tags: the panel, a tag's sheet ----
const tags = page.locator("[data-tags-panel]")
check("Tags panel lists the frontmatter and inline tags", await tags.locator('[data-tag-row="qa-obs"]').count() === 1 && await tags.locator('[data-tag-row="qa-compat"]').count() === 1)
await tags.locator('[data-tag-row="qa-obs"] button[aria-expanded]').click(); await wait(200)
check("a nested tag shows under its parent", await tags.locator('[data-tag-row="qa-obs/inline"]').count() === 1)
await tags.screenshot({ path: `${OUT}obsidian-tags.png` })
await ed.locator(".cm-tag", { hasText: "#qa-obs/inline" }).click(); await wait(1000)
check("clicking a tag in a note opens its sheet", await page.locator("#sheet-title", { hasText: "#qa-obs/inline" }).count() === 1)
check("the sheet lists the file", await page.locator("[role=dialog], .sheet, body").locator("text=Qa A").count() >= 1)
await page.screenshot({ path: `${OUT}obsidian-tag-sheet.png` })
await page.keyboard.press("Escape"); await wait(500)

// ---- renaming a tag (Tag Wrangler's): right-click, Rename, in every file ----
await tags.locator('[data-tag-row="qa-compat"]').click({ button: "right" }); await wait(300)
await page.getByRole("menuitem", { name: "Rename #qa-compat…" }).click(); await wait(800)
const field = page.locator("[data-tag-rename] input")
check("Rename opens the tag's sheet with its name to edit", await field.count() === 1 && await field.inputValue() === "qa-compat")
await field.fill("qa-renamed"); await page.screenshot({ path: `${OUT}obsidian-tag-rename.png` })
await field.press("Enter"); await wait(1500)
check("the tag is renamed in the file, the sheet follows", fs.readFileSync(path.join(VAULT, DIR, "Qa A.md"), "utf8").includes("tags: [qa-renamed]") &&
  await page.locator("#sheet-title", { hasText: "#qa-renamed" }).count() === 1)
await page.keyboard.press("Escape"); await wait(500)

// ---- its plugins: what stands in for each here, in Obsidian settings' sheet ----
const community = path.join(VAULT, ".obsidian", "community-plugins.json")
const hadCommunity = fs.existsSync(community) ? fs.readFileSync(community, "utf8") : null
fs.mkdirSync(path.dirname(community), { recursive: true })
fs.writeFileSync(community, JSON.stringify(["recent-files-obsidian", "tag-wrangler", "qa-made-up"]))
await page.goto("about:blank"); await page.goto(`${B}#plugins`); await wait(2000)
await page.locator("[data-plugin-gear=obsidian]").click(); await wait(1500)
const op = page.locator("[data-obsidian-plugins]")
check("Obsidian's sheet lists the vault's Obsidian plugins, each with what stands in for it", await op.locator('[data-obsidian-plugin="recent-files-obsidian"]', { hasText: "Recent files" }).count() === 1 &&
  await op.locator('[data-obsidian-plugin="tag-wrangler"]', { hasText: "Tags" }).count() === 1 && await op.locator('[data-obsidian-plugin="qa-made-up"]', { hasText: "your agent can write one" }).count() === 1)
await op.screenshot({ path: `${OUT}obsidian-plugins.png` })
await page.keyboard.press("Escape"); await wait(500)
if (hadCommunity === null) fs.rmSync(community); else fs.writeFileSync(community, hadCommunity)

// ---- .obsidian/app.json: new notes, pasted images ----
fs.mkdirSync(path.dirname(appJson), { recursive: true })
fs.writeFileSync(appJson, JSON.stringify({ newFileLocation: "folder", newFileFolderPath: `${DIR}/Inbox`, attachmentFolderPath: "./assets" }))
await wait(1500)
await open(`${DIR}/Qa A.md`)
await palette(page, "Switch to live preview", 700); await wait(800)
await ed.locator(".cm-line", { hasText: "Intro with" }).click(); await wait(200)
await page.keyboard.press("End")
await page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], "image.png", { type: "image/png" }))
  document.querySelector("#main-scroll .cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
}, png.toString("base64"))
await wait(2500)
const assets = fs.existsSync(path.join(VAULT, DIR, "assets")) ? fs.readdirSync(path.join(VAULT, DIR, "assets")) : []
check(`a pasted image goes to ./assets beside the note: ${assets}`, assets.some((f) => /^Pasted image \d{14}\.png$/.test(f)))
check("…and is embedded where it was pasted", await ed.locator("img.cm-image").count() === 1 || (await ed.innerText()).includes("![[Pasted image"))
await wait(1000)
// A file dropped on the note goes the same way (not read into it as text).
const at = await ed.locator(".cm-line", { hasText: "Intro with" }).boundingBox()
await page.evaluate(async ({ b64, x, y }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], "qa-dropped.png", { type: "image/png" }))
  const el = document.elementFromPoint(x, y)
  for (const type of ["dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }))
}, { b64: png.toString("base64"), x: at.x + 30, y: at.y + at.height / 2 })
await wait(2500)
const dropped = fs.existsSync(path.join(VAULT, DIR, "assets")) ? fs.readdirSync(path.join(VAULT, DIR, "assets")) : []
check(`a dropped image is an attachment, embedded where it fell: ${dropped}`, dropped.includes("qa-dropped.png") && fs.readFileSync(path.join(VAULT, DIR, "Qa A.md"), "utf8").includes("![[qa-dropped.png]]"))
// Dropped beside the text (the note's title, not the editor): an attachment too, not a tab outside the vault.
await page.evaluate(() => document.querySelector("#main-scroll").scrollTo(0, 0)); await wait(300)
const box = await page.locator("#main-scroll article.file-view").first().boundingBox()
await page.evaluate(async ({ b64, x, y }) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], "qa-beside.png", { type: "image/png" }))
  const el = document.elementFromPoint(x, y)
  for (const type of ["dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }))
}, { b64: png.toString("base64"), x: box.x + 30, y: box.y + 10 })
await wait(2500)
check("a file dropped beside the text is embedded too", fs.readFileSync(path.join(VAULT, DIR, "Qa A.md"), "utf8").includes("![[qa-beside.png]]"))
// ![[ suggests attachments (any file, by its name with the extension), not only notes.
await ed.locator(".cm-content").click()
await page.keyboard.press("Control+End"); await page.keyboard.press("ControlOrMeta+ArrowDown")
await page.keyboard.type("\n![[qa-besi")
await wait(800)
check("![[ suggests an attachment by its file name", (await page.locator(".cm-tooltip-autocomplete").innerText().catch(() => "")).includes("qa-beside.png"))
await page.keyboard.press("Escape")
await palette(page, "Create new note", 700); await wait(1500)
check(`a new note goes to newFileFolderPath: ${await page.evaluate(() => decodeURIComponent(location.hash))}`, await page.evaluate(() => decodeURIComponent(location.hash)).then((h) => h.includes(`${"Qa obsidian"}/Inbox/Untitled`)))

// ---- the Design page ----
await open("Dashboards/Design.md")
const dash = page.locator(".dash-prose")
check("Design: a highlight and a tag", await dash.locator("mark").count() >= 1 && await dash.locator("a.tag").count() >= 1)
check("Design: an embedded block", await page.locator(".file-view .note-embed").count() >= 1)
check("Design: the block id is hidden", !(await page.locator(".dash-prose p", { hasText: "Marks:" }).innerText()).includes("design-marks"))
await page.locator(".file-view .note-embed").first().screenshot({ path: `${OUT}obsidian-design.png` })

// ---- phone ----
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const pp = watch(await phone.newPage())
await pp.goto(`${B}#file/${encodeURIComponent(`${DIR}/Qa B.md`)}`); await wait(3000)
check("phone: no sideways scroll", await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
await pp.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await wait(1200)
check("phone: the embeds are drawn", await pp.locator(".note-embed").count() === 3)
await pp.locator(".note-embed").first().scrollIntoViewIfNeeded()
await pp.screenshot({ path: `${OUT}obsidian-phone.png` })

await browser.close()
if (hadApp === null) fs.rmSync(appJson); else fs.writeFileSync(appJson, hadApp)
if (hadPlugins === null) fs.rmSync(pluginsJson); else fs.writeFileSync(pluginsJson, hadPlugins)
if (hadSidebars === null) fs.rmSync(sidebarsJson, { force: true }); else fs.writeFileSync(sidebarsJson, hadSidebars)
await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await done()
