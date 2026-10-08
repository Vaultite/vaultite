// The block contract (core/blocks.ts): a block's options against its plugin's declaration. A note whose blocks have
// an unknown option, a wrong value and a required one left out: reading draws them clean, live preview adds a quiet
// line under each ("Unknown option titel (did you mean title?)"); a fixed option makes its line go. In source mode,
// typing in a block's fence suggests the options it doesn't have yet (with what each takes) and an enum's values,
// and a pick goes in as `key: value`. The slash menu's block comes with its required options. The Plugins page
// labels the app's own tier Built-in, with a line at the bottom saying what isn't a plugin.
// WRITES to the vault: throwaway server only.
//   node web/qa/blocks.mjs <base url> <vault path> [out dir]
import { readFileSync } from "node:fs"
import { SHOTS, palette, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const read = (p) => readFileSync(`${VAULT}/${p}`, "utf8")
const post = (path, body) => fetch(`${B}api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

const NOTE = "Qa blocks/Options.md"
const body = "Intro line.\n\n```block-week-goals\ntitel: Mine\n```\n\n```block-graph\ndepth: 5\n```\n\n```block-area\n```\n\n" +
  "```block-query\ntitle: Qa query\nfrom: Qa blocks/\n```\n\nEnd line.\n"
await fetch(`${B}api/file?path=${encodeURIComponent(NOTE)}`, { method: "DELETE" })
await post("file", { path: NOTE, text: `---\ntype: note\nkind: note\n---\n\n${body}` })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const notes = page.locator("[data-block-notes]")
const editing = async () => (await page.locator(".vau-editor .cm-content[contenteditable=true]").count()) > 0

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(1800)
await palette(page, "Switch to reading view")
check("the note opens in reading", !(await editing()))
check("its blocks are drawn", await page.locator(".cm-block-block").count() >= 4 || (await page.locator(".cm-block").count()) >= 4)
check("reading: no option notes, the blocks draw clean", (await notes.count()) === 0)
await page.screenshot({ path: `${OUT}blocks-reading.png` })

await palette(page, "Switch to live preview")
check("live preview", await editing())
await wait(600)
const texts = await notes.allInnerTexts()
check(`live preview: an unknown option is noted under its block (${JSON.stringify(texts)})`, texts.some((t) => t === "Unknown option titel (did you mean title?)"))
check("…a wrong value too", texts.some((t) => t === "depth should be one of 1, 2, 3, not 5"))
check("…and a required option left out", texts.some((t) => t === "area is required"))
check("a block with fine options has none", !texts.some((t) => /query/i.test(t)))
check("option names are drawn as code", await page.locator('[data-block-notes="week-goals"] code', { hasText: "titel" }).count() === 1)
const box = await page.locator('[data-block-notes="week-goals"]').boundingBox()
check(`the note is one quiet line (${box?.height}px)`, box && box.height < 30)
await page.locator('[data-block-notes="week-goals"]').scrollIntoViewIfNeeded()
await page.screenshot({ path: `${OUT}blocks-notes.png` })
check("the block with a note is still drawn", await page.locator(".cm-content", { hasText: "This week" }).count() > 0)

// Fixed on disk (as an AI would): its line goes.
await fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: NOTE, text: read(NOTE).replace("titel: Mine", "title: Mine") }) })
await wait(2500)
check("fixed on disk, its note goes", !(await notes.allInnerTexts()).some((t) => t.includes("titel")))

// Source mode: suggestions inside a block's fence.
await palette(page, "Switch to source mode")
const menu = page.locator(".cm-tooltip-autocomplete")
await page.locator(".vau-editor .cm-line", { hasText: "depth: 5" }).first().click()
await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("he"); await wait(500)
const labels = (await menu.locator("li").allInnerTexts().catch(() => [])).map((t) => t.split(/\s/)[0])
check(`typing in a block suggests its options, not the ones it has (${labels.join(", ")})`, await menu.isVisible() && labels.includes("height") && !labels.includes("depth"))
await page.screenshot({ path: `${OUT}blocks-suggest.png` })
await page.keyboard.press("Enter"); await page.keyboard.type("280"); await wait(1500)
check("a pick goes in as `key: ` and the value follows", /```block-graph\ndepth: 5\nheight: 280\n```/.test(read(NOTE)))
await page.locator(".vau-editor .cm-line", { hasText: "title: Qa query" }).first().click()
await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("vie"); await wait(400)
await page.keyboard.press("Enter"); await page.keyboard.type("b"); await wait(500)
const values = (await menu.locator("li").allInnerTexts().catch(() => [])).map((t) => t.split(/\s/)[0])
check(`after an enum's key, its values (${values.join(", ")})`, values.includes("board"))
await page.keyboard.press("Enter"); await wait(1500)
check("…and the value goes in", /title: Qa query\nview: board\n/.test(read(NOTE)))
await page.locator(".vau-editor .cm-line", { hasText: "End line." }).first().click()
await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("de"); await wait(400)
check("outside a block, no option suggestions", !(await menu.isVisible()))
await page.keyboard.press("Escape")

// The slash menu's block comes with its required options.
await palette(page, "Switch to live preview")
await page.locator(".vau-editor .cm-line", { hasText: "Intro line." }).first().click()
await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.keyboard.press("Enter")
await page.keyboard.type("/area"); await wait(500)
const pick = menu.locator("li", { hasText: /^Area/ })
if (await pick.count()) await pick.first().click(); else await page.keyboard.press("Enter")
await wait(300); await page.keyboard.type("workouts"); await wait(1500)
check("a block from the slash menu comes with its required options, the cursor at the first", /```block-area\narea: workouts\n```/.test(read(NOTE)))

// The Plugins page: Built-in, not Core.
await page.goto(`${B}#plugins`); await wait(1500)
const heads = await page.locator("[data-plugin-group] h2").allInnerTexts()
check(`the app's own tier is Built-in (${heads.join(", ")})`, heads[0] === "Built-in plugins" && !heads.some((h) => /core|community/i.test(h)))
await page.screenshot({ path: `${OUT}blocks-plugins.png` })
await page.locator('[data-plugin-row="people"]').click(); await wait(800)
check("a built-in plugin's sheet says Built-in plugin", (await page.getByText("Built-in plugin", { exact: true }).count()) > 0)

await done()
