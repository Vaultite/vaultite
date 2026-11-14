// The note switcher previews its highlighted result (components/PalettePreview.tsx, components/FilePreview.tsx, components/Palette.tsx, components/SearchPalette.tsx), writing notes: node web/qa/palettepreview.mjs <base url> [out dir]
import { SHOTS, qa } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"

const { args: [arg, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const B = arg.endsWith("/") ? arg : `${arg}/`
const file = (path, init) => fetch(`${B}api/file${init ? "" : `?path=${encodeURIComponent(path)}`}`, init ?? { method: "DELETE" })
const filler = Array.from({ length: 80 }, (_, i) => `Filler line ${i + 1}.`).join("\n")
const NOTES = {
  "Qa preview/Preview alpha.md": "# Alpha heading\n\nThe alpha note's first line.\n",
  "Qa preview/Preview beta.md": `The beta note's first line.\n\n${filler}\n\nFar down, a quixotically placed word.\n`,
}
for (const [path, text] of Object.entries(NOTES)) {
  await file(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, text }) })
}

async function open(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
  const page = watch(await ctx.newPage(), { label: `${width} wide` }), ui = app(page)
  await page.goto(B)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  await ui.idle()
  await page.keyboard.press("ControlOrMeta+o")
  await page.locator("[role=dialog] input[role=combobox]").waitFor()
  return { ctx, page, ui }
}

const card = (page) => page.locator("[data-palette-preview]")
const named = (page) => card(page).locator("[data-file-preview] h1").first().innerText({ timeout: 1000 }).catch(() => "")
const selected = (page) => page.locator("[role=dialog] [role=option][aria-selected=true]").innerText()

{
  const { ctx, page, ui } = await open(1600)
  const dialog = page.locator("[role=dialog]")
  await page.keyboard.type("preview")
  const before = await dialog.boundingBox()
  await ui.idle()
  const first = await named(page)
  check("the highlighted note shows beside the palette", /^Preview (alpha|beta)$/.test(first) && (await selected(page)).startsWith(first), { first, row: await selected(page) })
  const [d, c] = [await dialog.boundingBox(), await card(page).boundingBox()]
  check("it sits to the palette's right, top-aligned, inside the window", !!c && c.x >= d.x + d.width && Math.abs(c.y - d.y) < 1 && c.x + c.width <= 1600, { d, c })
  const box = ({ x, y, width }) => ({ x, y, width })
  check("the palette didn't move or get wider", JSON.stringify(box(before)) === JSON.stringify(box(d)), { before, d })
  await page.screenshot({ path: `${OUT}palette-preview.png` })
  await page.keyboard.press("ArrowDown")
  await ui.idle()
  const second = await named(page)
  check("...nor as the card changes", JSON.stringify(await dialog.boundingBox()) === JSON.stringify(d), { d, now: await dialog.boundingBox() })
  check("the arrow keys move it to the next note", /^Preview (alpha|beta)$/.test(second) && second !== first && (await selected(page)).startsWith(second), { first, second, rows: await page.locator("[role=dialog] [role=option]").allInnerTexts() })
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("quixotically")
  await ui.idle()
  const text = await card(page).innerText()
  check("a note found by its text shows around what was found", text.includes("quixotically") && !text.includes("Filler line 1."), text.slice(0, 200))
  check("and lights it there", await page.evaluate(() => (CSS.highlights.get("vau-preview")?.size ?? 0) > 0))
  await page.screenshot({ path: `${OUT}palette-preview-text.png` })
  await page.keyboard.press("Escape")
  await ui.idle()
  check("Escape takes it with the palette", (await card(page).count()) === 0)
  await ctx.close()
}

{
  const { ctx, page, ui } = await open(1280)
  await page.keyboard.type("preview")
  await ui.idle()
  check("a narrower window shows none", (await page.locator("[role=dialog] [role=option]").count()) > 0 && (await card(page).count()) === 0)
  await ctx.close()
}

for (const path of Object.keys(NOTES)) await file(path)
noErrors()
await done()
