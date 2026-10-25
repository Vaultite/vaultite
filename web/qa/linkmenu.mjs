// A link's right-click menu (components/LinkMenu.ts, plugins/core/editing/menu.ts): in reading view a web link offers
// Open link, Copy link and Copy link text, a [[link]] Open in new tab, Copy link and More file actions, a missing one
// Create note, a mailto: Copy email address, a #tag its files, a link in a table the same; while editing, Edit link
// selects its target and Remove link leaves its text. WRITES a "Qa link menu" folder: throwaway server only.
//   node web/qa/linkmenu.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/var/tmp/linkmenu-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa link menu", NOTE = `${VAULT}/${DIR}/Links.md`, enc = encodeURIComponent
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
const START = [
  "A web link: [the docs](https://example.com/docs) and a bare one https://example.org/page here.",
  "",
  "Aliased [[Qa target|the target]], plain [[Qa target]], missing [[Qa nowhere]].",
  "",
  "Mail [Alice](mailto:alice@example.com) about #planning soon.",
  "",
  "| Col | Link |",
  "| --- | --- |",
  "| one | [[Qa target]] |",
  "",
].join("\n")
writeFileSync(NOTE, START)
writeFileSync(`${VAULT}/${DIR}/Qa target.md`, "# Qa target\n")
// (a person's timeline is drawn Markdown, components/Markdown.tsx)
writeFileSync(`${VAULT}/${DIR}/Qa person.md`, "---\ntype: person\n---\n\n## Timeline\n\n- 2026-10-01 · note · Read [the guide](https://example.net/guide) with [[Qa target]]\n")
const disk = () => readFileSync(NOTE, "utf8")
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: "dark", permissions: ["clipboard-read", "clipboard-write"] })
  await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.editMode", "live") } catch { /* not the app's frame */ } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${enc(`${DIR}/Links.md`)}`)
  await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 })
  await wait(600)
  const items = () => page.locator("[role=menu]").first().locator(":scope > [role=menuitem]").allTextContents()
  const has = (got, ...names) => names.every((n) => got.some((i) => i.startsWith(n)))
  const clip = () => page.evaluate(() => navigator.clipboard.readText())
  const menuOn = async (sel) => { await page.keyboard.press("Escape"); await wait(100); await page.locator(sel).first().click({ button: "right" }); await wait(250); return items() }
  const pick = async (name) => { await page.locator("[role=menu]").first().getByRole("menuitem", { name, exact: false }).first().click(); await wait(250) }
  const web = "[data-pane] .cm-content [data-url='https://example.com/docs']"

  // ---- reading view ----
  await page.keyboard.press("ControlOrMeta+E"); await wait(700)
  let got = await menuOn(web)
  await page.screenshot({ path: `${OUT}web-link.png` })
  check("reading: a web link offers Open link, Copy link, Copy link text, then the text's menu", has(got, "Open link", "Copy link", "Copy link text", "Select all") && !has(got, "Edit link"), got)
  await pick("Copy link")
  check("reading: Copy link copies its address", (await clip()) === "https://example.com/docs", await clip())
  await page.locator(web).first().click({ button: "right" }); await wait(250); await pick("Copy link text")
  check("reading: Copy link text copies what it shows", (await clip()) === "the docs", await clip())

  got = await menuOn("[data-pane] .cm-content [data-url='https://example.org/page']")
  check("reading: a bare address has its menu", has(got, "Open link", "Copy link") && !has(got, "Copy link text"), got)

  got = await menuOn("[data-pane] .cm-content [data-wiki='Qa target']")
  await page.screenshot({ path: `${OUT}wikilink.png` })
  check("reading: a [[link]] offers Open in new tab, Copy link, More file actions", has(got, "Open in new tab", "Copy link", "Copy link text", "More file actions"), got)
  await pick("Copy link")
  check("reading: a [[link]]'s Copy link copies the [[link]]", (await clip()) === "[[Qa target]]", await clip())

  got = await menuOn("[data-pane] .cm-content [data-wiki='Qa nowhere']")
  check("reading: a link to nothing offers Create note", has(got, "Create note “Qa nowhere”", "Copy link"), got)

  got = await menuOn("[data-pane] .cm-content [data-url^='mailto:']")
  check("reading: a mailto: link offers Copy email address", has(got, "Open link", "Copy email address"), got)
  await pick("Copy email address")
  check("reading: Copy email address copies just the address", (await clip()) === "alice@example.com", await clip())

  got = await menuOn("[data-pane] .cm-content [data-tag]")
  check("reading: a #tag offers its files and Copy tag", has(got, "Show files with #planning", "Copy tag"), got)

  got = await menuOn("[data-pane] .cm-block [data-wiki='Qa target']")
  check("reading: a link in a table has its menu", has(got, "Open in new tab", "Copy link"), got)
  await menuOn("[data-pane] .cm-block [data-wiki='Qa target']")
  await pick("Open in new tab")
  check("reading: Open in new tab opens it", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Qa target.md")), 4000), await page.evaluate(() => location.hash))
  await page.goto("about:blank"); await page.goto(`${B}#file/${enc(`${DIR}/Links.md`)}`); await page.waitForSelector("[data-pane] .cm-content"); await wait(700)

  // ---- drawn Markdown (a person's timeline) ----
  await page.goto("about:blank"); await page.goto(`${B}#file/${enc(`${DIR}/Qa person.md`)}`); await wait(1500)
  const guide = page.locator("[data-pane] .note-prose a[href='https://example.net/guide']").first()
  await guide.click({ button: "right" }); await wait(250)
  got = await items()
  await page.screenshot({ path: `${OUT}timeline.png` })
  check("drawn Markdown: a link in a timeline has its menu", has(got, "Open link", "Copy link", "Copy link text"), got)
  await pick("Copy link")
  check("drawn Markdown: …and Copy link copies it", (await clip()) === "https://example.net/guide", await clip())
  await page.goto("about:blank"); await page.goto(`${B}#file/${enc(`${DIR}/Links.md`)}`); await page.waitForSelector("[data-pane] .cm-content"); await wait(700)

  // ---- editing ----
  const editing = () => page.evaluate(() => document.querySelector("[data-pane] .cm-content")?.getAttribute("contenteditable") === "true")
  if (!(await editing())) { await page.locator("[data-pane] .cm-content").first().click(); await page.keyboard.press("ControlOrMeta+E"); await wait(600) }
  check("editing: the note is editable", await until(editing, 3000))
  got = await menuOn(web)
  await page.screenshot({ path: `${OUT}editing.png` })
  check("editing: a link offers Edit link and Remove link, and no Add link", has(got, "Open link", "Copy link", "Edit link", "Remove link") && !has(got, "Add link"), got)
  await pick("Edit link")
  const sel = await page.evaluate(() => getSelection()?.toString())
  check("editing: Edit link selects its address", sel === "https://example.com/docs", sel)
  await page.keyboard.press("Escape"); await page.keyboard.press("End"); await wait(300)
  await page.locator(web).first().click({ button: "right" }); await wait(250); await pick("Remove link")
  check("editing: Remove link leaves its text", await until(() => disk().startsWith("A web link: the docs and"), 4000), disk().split("\n")[0])
  got = await menuOn("[data-pane] .cm-content [data-wiki='Qa nowhere']")
  await pick("Remove link")
  check("editing: Remove link on a [[link]] leaves its name", await until(() => disk().includes("missing Qa nowhere."), 4000), disk().split("\n")[2])
  await ctx.close()
} finally {
  await browser.close()
  rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
}
await done()
