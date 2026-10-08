// Blocks in live preview are views (livePreview.ts Block, components/Blocks.tsx): a click on a ```block-person keeps it
// drawn, its bar's </> shows its Markdown with Done under it, a right-click there opens the block's menu; its fields
// change in place (kit's Editable); Options is a form that writes its fence; an empty block still draws; an alias
// another file has says so. WRITES to the vault: throwaway server only.
//   node web/qa/blockedit.mjs <base url> [out dir]
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const enc = encodeURIComponent
const post = (path, body) => fetch(`${B}api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const read = async (p) => (await (await fetch(`${B}api/file?path=${enc(p)}`)).json()).text

const DIR = "Qa blockedit"
const PERSON = `${DIR}/Pat Doe.md`, GROUP = `${DIR}/Group.md`, ONE = `${DIR}/Alias one.md`, TWO = `${DIR}/Alias two.md`
for (const p of [PERSON, GROUP, ONE, TWO]) await fetch(`${B}api/file?path=${enc(p)}`, { method: "DELETE" })
await post("file", { path: PERSON, text: "---\ntype: person\nrelation: friend\n---\n\n```block-person\n```\n\nLikes tea.\n\nLast line.\n" })
await post("file", { path: GROUP, text: "# Group\n\n```block-people-group\nrelations: [nobody]\n```\n\nEnd.\n" })
await post("file", { path: ONE, text: "---\naliases: [Qaclash]\n---\n\nOne.\n" })
await post("file", { path: TWO, text: "---\naliases: [Qaclash]\n---\n\nTwo.\n" })
await wait(800)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const menu = page.locator("[role=menu]")
const editing = async () => (await page.locator(".vau-editor .cm-content[contenteditable=true]").count()) > 0
const fenceShows = async () => (await page.locator(".vau-editor .cm-line", { hasText: "```block-person" }).count()) > 0
const open = async (p) => {
  await page.goto(`${B}#file/${enc(p)}`); await wait(1800)
  if (!(await editing())) { await page.keyboard.press("ControlOrMeta+e"); await wait(800) }
}

await open(PERSON)
check("the person's file is being edited", await editing())
const card = page.locator(".cm-block-block").first()
check("its block is drawn", await card.isVisible())
await page.locator(".vau-editor .cm-line", { hasText: "Last line." }).click(); await wait(300)
await card.locator(".text-\\[13px\\]").first().click({ force: true }); await wait(400)
check("a click on the card keeps it drawn (no ```block-person)", !(await fenceShows()) && await card.isVisible())

// Its fields change in place.
await card.getByText("Add how you know them").click(); await wait(200)
await page.keyboard.type("Met at a pottery class"); await page.keyboard.press("Enter"); await wait(1500)
check("a field typed in the card is written to the frontmatter", /context: Met at a pottery class/.test(await read(PERSON)))
check("…and the card stays drawn", !(await fenceShows()))
await page.screenshot({ path: `${OUT}blockedit-card.png` })

// The bar: its name, the menu, </>.
await card.hover(); await wait(300)
const bar = card.locator(".cm-block-bar")
check("hovering shows its bar, with its name", await bar.isVisible() && /Person/.test(await bar.innerText()))
await page.screenshot({ path: `${OUT}blockedit-bar.png` })
await bar.getByRole("button", { name: "More" }).click(); await wait(900)
const text = await menu.innerText()
check(`its menu says where the data is and edits its source (${text.replace(/\n/g, " | ")})`, text.includes("This file's properties") && text.includes("Edit source"))
await page.keyboard.press("Escape"); await wait(300)

// Right-click keeps the block (and the line with the cursor) as they were.
await page.locator(".vau-editor .cm-line", { hasText: "Last line." }).click(); await wait(300)
await card.click({ button: "right" }); await wait(200)
const lineRaw = await page.locator(".vau-editor .cm-line", { hasText: "Last line." }).count()
check("right-click: its menu, the block still drawn", await menu.isVisible() && !(await fenceShows()))
await page.keyboard.press("Escape"); await wait(400)
check("…and still drawn once the menu closes", !(await fenceShows()) && lineRaw > 0)

// </> shows its Markdown, with Done under it; right-click there is the block's menu.
await card.hover(); await wait(200)
await card.locator(".cm-block-source").click(); await wait(500)
check("</> shows its Markdown", await fenceShows())
const foot = page.locator(".cm-block-foot")
check("…with Done under it", await foot.isVisible())
await page.screenshot({ path: `${OUT}blockedit-source.png` })
await page.locator(".vau-editor .cm-line", { hasText: "```block-person" }).click({ button: "right" }); await wait(900)
check("right-click on its Markdown: the block's menu, with Done", await menu.isVisible() && (await menu.innerText()).includes("Done"))
await page.keyboard.press("Escape"); await wait(300)
await foot.getByRole("button", { name: "Done" }).click(); await wait(500)
check("Done draws it again", !(await fenceShows()) && await page.locator(".cm-block-block").first().isVisible())

// This file's properties: open, in view.
await page.locator(".cm-block-block").first().click({ button: "right" }); await wait(1200)
await menu.getByRole("menuitem", { name: "This file's properties" }).click(); await wait(800)
check("This file's properties opens them", await page.locator("section[aria-label=Properties] [aria-expanded=true]").count() > 0)

// An empty block draws a place to right-click; Options writes its fence.
await open(GROUP)
const group = page.locator(".cm-block-block").first()
check("a group with no one says so", /No one/.test(await group.innerText()))
await group.hover(); await wait(200)
await group.locator(".cm-block-bar").getByRole("button", { name: "Options" }).click(); await wait(400)
const form = page.locator(".cm-block-options")
check("Options unfolds its form", await form.isVisible())
const title = form.locator("label", { hasText: "Title" }).locator("input")
await title.fill("Qa people"); await title.press("Enter"); await wait(1500)
check("a value in the form is written into its fence", /```block-people-group\nrelations: \[nobody\]\ntitle: Qa people\n```/.test(await read(GROUP)))
await page.screenshot({ path: `${OUT}blockedit-options.png` })

// An alias another file has.
await page.goto(`${B}#file/${enc(TWO)}`); await wait(1500)
await page.goto(`${B}#file/${enc(ONE)}`); await wait(1500)
const banners = await page.locator(".file-view").innerText()
const other = /\[\[Qaclash\]\] goes to Alias (one|two)/.exec(banners)
check("a file whose alias goes to another file says so",
  !!other || (await (async () => { await page.goto(`${B}#file/${enc(TWO)}`); await wait(1500); return /\[\[Qaclash\]\] goes to Alias one/.test(await page.locator(".file-view").innerText()) })()))
await page.screenshot({ path: `${OUT}blockedit-alias.png` })

noErrors()
for (const p of [PERSON, GROUP, ONE, TWO]) await fetch(`${B}api/file?path=${enc(p)}`, { method: "DELETE" })
await done()
