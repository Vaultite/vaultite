// Where a block's data comes from (components/BlockSource.tsx, GET /api/blocks/sources): a note with a query block
// over two notes of its own, read in reading view. Right-clicking the block opens its menu: what it is, the files it
// matched (a click opens one), Options (its form) and "Edit source" (into editing, the cursor on its fence's first
// option). The API answers the same for an agent, with the fence's line. On a phone, a held finger opens the menu.
// WRITES to the vault: throwaway server only.
//   node web/qa/blocksource.mjs <base url> [out dir]
import { SHOTS, palette, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const enc = encodeURIComponent
const post = (path, body) => fetch(`${B}api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

const DIR = "Qa blocksource"
const NOTE = `${DIR}/Sources.md`
for (const p of [NOTE, `${DIR}/First match.md`, `${DIR}/Second match.md`]) await fetch(`${B}api/file?path=${enc(p)}`, { method: "DELETE" })
await post("file", { path: `${DIR}/First match.md`, text: "---\ntype: note\nkind: note\ntags: [Qasource]\n---\n\nOne.\n" })
await post("file", { path: `${DIR}/Second match.md`, text: "---\ntype: note\nkind: note\ntags: [Qasource]\n---\n\nTwo.\n" })
await post("file", { path: NOTE, text: "---\ntype: note\nkind: note\n---\n\nIntro line.\n\n```block-query\ntitle: Qa sources\ntags: [Qasource]\n```\n\nEnd line.\n" })
await wait(800)

// The API, as an agent asks it.
const fenceLine = (await (await fetch(`${B}api/file?path=${enc(NOTE)}`)).json()).text.split("\n").indexOf("```block-query")
const all = await (await fetch(`${B}api/blocks/sources?path=${enc(NOTE)}`)).json()
const q = all.blocks?.[0]
check(`the file's blocks, each with its fence's line (${q?.name} at ${q?.line})`, q?.name === "query" && q.line === fenceLine && fenceLine > 0)
const files = (q?.sources ?? []).filter((s) => s.kind === "file").map((s) => s.path)
check(`a query's sources are the files it matched (${files.join(", ")})`, files.length === 2 && files.every((f) => f.startsWith(`${DIR}/`)))
const one = await (await fetch(`${B}api/blocks/sources?path=${enc(NOTE)}&name=query&text=${enc("title: Qa sources\ntags: [Qasource]")}`)).json()
check("one block, by its name and options' text", one.line === fenceLine && one.description)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const menu = page.locator("[role=menu]")
const editing = async () => (await page.locator(".vau-editor .cm-content[contenteditable=true]").count()) > 0

await page.goto(`${B}#file/${enc(NOTE)}`); await wait(1800)
await palette(page, "Switch to reading view")
check("the note is read", !(await editing()))
const block = page.locator(".file-view").getByText("Qa sources").first()
await block.click({ button: "right" }); await wait(800)
check("right-click on the block opens its menu", await menu.isVisible())
const text = await menu.innerText()
check("it says what the block is", /The query block \(Database views\)/.test(text) || /The query block/.test(text))
check("it lists the files the query matched", text.includes("First match") && text.includes("Second match"))
check("…then its options and its source", text.includes("Edit source") && text.includes("Options"))
await page.screenshot({ path: `${OUT}blocksource-menu.png` })
await menu.getByRole("menuitem", { name: /Options/ }).click(); await wait(500)
check("Options unfolds the block's options form", await page.locator(".cm-block-options").isVisible() && /Title/.test(await page.locator(".cm-block-options").innerText()))
await page.screenshot({ path: `${OUT}blocksource-options.png` })
await page.locator(".cm-block-options").getByRole("button", { name: "Done" }).click(); await wait(300)
await page.locator(".file-view").getByText("Qa sources").first().click({ button: "right" }); await wait(800)
await menu.first().getByRole("menuitem", { name: /First match/ }).click(); await wait(1200)
check(`a file in it opens (${decodeURIComponent(page.url())})`, decodeURIComponent(page.url()).includes(`${DIR}/First match.md`))
await page.goto(`${B}#file/${enc(NOTE)}`); await wait(1500)

await page.locator(".file-view").getByText("Qa sources").first().click({ button: "right" }); await wait(800)
await menu.getByRole("menuitem", { name: "Edit source" }).click(); await wait(1500)
check("Edit source switches to editing", await editing())
const line = await page.evaluate(() => {
  const s = getSelection(); const n = s?.anchorNode
  return (n instanceof Element ? n : n?.parentElement)?.closest(".cm-line")?.textContent ?? ""
})
check(`…with the cursor on its first option (${JSON.stringify(line)})`, line === "title: Qa sources")
await page.screenshot({ path: `${OUT}blocksource-edit.png` })

// In live preview, right-click on a drawn block opens the same menu, not its source.
await page.keyboard.press("Escape")
await page.locator(".vau-editor .cm-line", { hasText: "End line." }).first().click(); await wait(500)
const drawn = page.locator(".cm-block").getByText("Qa sources").first()
await drawn.click({ button: "right" }); await wait(800)
check("live preview: right-click on a drawn block opens its menu", await menu.isVisible() && (await menu.innerText()).includes("First match"))
check("…and the block stays drawn", (await page.locator(".cm-block").getByText("Qa sources").count()) > 0)
await page.keyboard.press("Escape")
await ctx.close()

// A phone: a finger held on the block opens the menu.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = await phone.newPage()
await pp.goto(`${B}#file/${enc(NOTE)}`); await wait(2000)
const target = pp.getByText("Qa sources").first()
const box = await target.boundingBox()
const cdp = await phone.newCDPSession(pp)
const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] })
await wait(800)
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
await wait(600)
const pm = pp.locator("[role=menu]")
check("phone: a held finger opens the menu", await pm.isVisible() && (await pm.innerText()).includes("First match"))
check("…and lifting it opens nothing", !decodeURIComponent(pp.url()).includes("First match"))
await pp.screenshot({ path: `${OUT}blocksource-phone.png` })
await done()
