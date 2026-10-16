// Where a block's data comes from (components/BlockSource.tsx, GET /api/blocks/sources): a note with a graph block
// linking two notes of its own, read in reading view. Right-clicking the block opens its menu: what it is, the files it
// shows (a click opens one), Options (its form) and "Edit source" (into editing, the cursor on its fence's first
// option). The API answers the same for an agent, with the fence's line. On a phone, a held finger opens the menu.
// "Edit source" keeps the block's place: on a dashboard with many blocks above it (drawn anew in editing, at sizes
// not known yet), its Markdown shows where it was drawn, and Done draws it back there; on a desktop and a phone.
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
await post("file", { path: NOTE, text: "---\ntype: note\nkind: note\n---\n\nIntro line, about [[First match]] and [[Second match]].\n\n```block-graph\ntitle: Qa sources\n```\n\nEnd line.\n" })
await wait(800)

// The API, as an agent asks it.
const fenceLine = (await (await fetch(`${B}api/file?path=${enc(NOTE)}`)).json()).text.split("\n").indexOf("```block-graph")
const all = await (await fetch(`${B}api/blocks/sources?path=${enc(NOTE)}`)).json()
const q = all.blocks?.[0]
check(`the file's blocks, each with its fence's line (${q?.name} at ${q?.line})`, q?.name === "graph" && q.line === fenceLine && fenceLine > 0)
const files = (q?.sources ?? []).filter((s) => s.kind === "file").map((s) => s.path)
check(`a graph's sources are the files it shows (${files.join(", ")})`, files.includes(`${DIR}/First match.md`) && files.includes(`${DIR}/Second match.md`) && files.every((f) => f.startsWith(`${DIR}/`)))
const one = await (await fetch(`${B}api/blocks/sources?path=${enc(NOTE)}&name=graph&text=${enc("title: Qa sources")}`)).json()
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
check("it says what the block is", /The graph block/.test(text))
check("it lists the files it shows", text.includes("First match") && text.includes("Second match"))
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
await phone.close()

const BOARD = `${DIR}/Board.md`
const calendar = (i) => `\`\`\`base\nfilters: 'type == "log"'\nviews:\n  - type: calendar\n    name: Qa logs ${i}\n\`\`\``
const above = Array.from({ length: 6 }, (_, i) => calendar(i)).join("\n\n"), below = Array.from({ length: 3 }, (_, i) => calendar(i + 6)).join("\n\n")
const kanban = "```base\nfilters: 'type == \"project\"'\nviews:\n  - type: kanban\n    name: Qa target\n    groupBy:\n      property: status\nwide: true\n```"
await post("file", { path: BOARD, text: `---\ntype: dashboard\n---\n\n${above}\n\n${kanban}\n\n${below}\n` })
await wait(800)
for (const device of ["desktop", "phone"]) {
  const c = await browser.newContext(device === "phone" ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  const p = watch(await c.newPage())
  await p.goto(`${B}#file/${enc(BOARD)}`); await wait(2500)
  const title = p.getByText("Qa target", { exact: true }).first()
  // (the block a third of the way down, as it's read)
  await title.scrollIntoViewIfNeeded()
  await title.evaluate((el) => { const r = el.getBoundingClientRect(); let s = el.parentElement; while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement; (s ?? document.scrollingElement).scrollBy(0, r.top - innerHeight / 3) })
  await wait(1200)
  const was = Math.round((await title.boundingBox()).y)
  const at = await title.boundingBox()
  if (device === "phone") {
    const cdp = await c.newCDPSession(p), pt = { x: at.x + 10, y: at.y + at.height / 2 }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] }); await wait(800)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(600)
  } else { await title.click({ button: "right" }); await wait(800) }
  await p.locator("[role=menu]").getByRole("menuitem", { name: "Edit source" }).click()
  await wait(3000)
  // Its fence's line: the one before its first option.
  const fence = await p.evaluate(() => {
    const l = [...document.querySelectorAll(".cm-line")].find((x) => x.getClientRects().length && x.textContent === `filters: 'type == "project"'`)
    return l ? Math.round(l.previousElementSibling.getBoundingClientRect().top) : null
  })
  check(`${device}: Edit source shows its Markdown where the block was (${was} -> ${fence})`, fence !== null && Math.abs(fence - was) < 60)
  await p.screenshot({ path: `${OUT}blocksource-place-${device}.png` })
  await p.locator(".cm-block-done").first().dispatchEvent("mousedown"); await wait(2500)
  const back = await title.boundingBox()
  check(`${device}: …and Done draws it back there (${fence} -> ${back && Math.round(back.y)})`, !!back && Math.abs(back.y - fence) < 80)
  await c.close()
}
await done()
