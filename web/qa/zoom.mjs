// oxlint-disable-next-line vaultite/comment-lines -- qa() reads its arguments from this usage line
//   node web/qa/zoom.mjs <base url> <vault path> [out dir] (pinch.ts zoom.ts textsize.ts pagezoom.ts keptzoom.ts mapzoom.ts html/Frame.tsx html/artifacts.ts Table.tsx Workbook.tsx Reader.tsx GraphCanvas.tsx canvas/view.ts ChatTab.tsx)
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { SHOTS, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
import * as fx from "../../tools/fixtures/formats/make.ts"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa zoom", enc = encodeURIComponent, at = (f) => `${VAULT}/${DIR}/${f}`
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
writeFileSync(at("rows.csv"), `name,city\n${Array.from({ length: 40 }, (_, i) => `Person ${i},Town ${i}`).join("\n")}\n`)
writeFileSync(at("script.py"), Array.from({ length: 30 }, (_, i) => `def f${i}(x):\n    return x + ${i}\n`).join("\n"))
writeFileSync(at("page.html"), `<!doctype html><title>Page</title>${Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i} of a saved page</p>`).join("")}`)
writeFileSync(at("Board.canvas"), JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Lighthouse", x: 0, y: 0, width: 240, height: 120 }], edges: [] }))
writeFileSync(at("Budget.xlsx"), fx.xlsx())
writeFileSync(at("Log.epub"), fx.epub())

const near = (a, b, by = 0.03) => Math.abs(a / b - 1) < by
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), page = watch(await ctx.newPage()), ui = app(page)
  const open = async (hash, sel) => { await page.goto("about:blank"); await page.goto(`${B}#${hash}`); await page.locator(sel).first().waitFor(); await ui.idle() }
  const file = (f, sel) => open(`file/${enc(`${DIR}/${f}`)}`, sel)
  const size = (sel, k = "height") => () => page.locator(sel).first().evaluate((e, k) => e.getBoundingClientRect()[k], k)
  const keys = async (k) => { await page.keyboard.press(k); await ui.idle() }
  const pinch = async (dy, n = 1) => {
    await page.mouse.move(700, 420)
    await page.keyboard.down("Control")
    for (let i = 0; i < n; i++) await page.mouse.wheel(0, dy)
    await page.keyboard.up("Control")
    await ui.idle()
  }
  const steps = async (name, get, { pinches = true, by = 1.1, off = 0.03 } = {}) => {
    const was = await get()
    await keys("ControlOrMeta+Equal")
    check(`${name}: ⌘+ zooms it`, await until(async () => near(await get(), was * by, off), 3000), [was, await get()])
    await keys("ControlOrMeta+0")
    check(`${name}: ⌘0 puts it back`, await until(async () => near(await get(), was, off), 3000), [was, await get()])
    await pinch(-10, 6)
    const now = await get()
    check(pinches ? `${name}: a pinch zooms it` : `${name}: a pinch leaves it (Pinch to resize text is off)`, pinches ? now > was * 1.05 : near(now, was), [was, now])
    await keys("ControlOrMeta+0")
  }
  await file("script.py", ".cm-line")
  await steps("code", size(".cm-line"), { pinches: false })
  await keys("ControlOrMeta+Equal")
  check("its line says whose size and how large", await until(() => page.getByText("Code text 110%").count(), 3000))
  await keys("ControlOrMeta+0")
  await page.keyboard.press("ControlOrMeta+p")
  await page.keyboard.type("zoom in")
  check("the palette offers Zoom in for the pane under it", await until(() => page.getByRole("option", { name: /^Zoom in\b/ }).count(), 3000))
  await page.keyboard.press("Enter")
  check("…and it zooms that", await until(() => page.getByText("Code text 110%").count(), 3000))
  await ui.idle(); await keys("ControlOrMeta+0")
  await file("rows.csv", "tr[data-csv-row]")
  await steps("a CSV's table", size("tr[data-csv-row]"))
  await file("Budget.xlsx", "[data-sheet-grid] tbody tr")
  await steps("a spreadsheet", size("[data-sheet-grid] tbody tr"))
  await file("page.html", "article iframe")
  await steps("a web page file", size("article iframe"), { by: 1.25, off: 0.06 })
  await keys("ControlOrMeta+Equal"); await ui.saved()
  await file("page.html", "article iframe")
  check("a page file opens as large as it was left", await page.locator("article iframe").evaluate((e) => e.style.zoom) === "1.25")
  await keys("ControlOrMeta+0"); await ui.saved()
  await file("Log.epub", "[data-ebook]")
  const word = async () => { for (const f of page.frames()) if (f !== page.mainFrame()) { const px = await f.locator("p").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize), { timeout: 1000 }).catch(() => 0); if (px) return px } return 0 }
  await until(async () => await word() > 0, 10_000)
  await steps("a book", word)
  await file("Board.canvas", "[data-canvas-board]")
  const percent = () => page.locator("[data-canvas-tool='Zoom to 100%'] span").innerText().then(parseInt)
  await keys("ControlOrMeta+0")
  await pinch(-120)
  check("a canvas: one notch of Control and the wheel is one step, as a picture's", near(await percent(), 127, 0.02), await percent())
  await open("view/graph", "[data-pane] canvas")
  const drawn = () => page.locator("[data-pane] canvas").first().evaluate((c) => c.toDataURL().length)
  const was = await drawn()
  await keys("ControlOrMeta+Equal"); await keys("ControlOrMeta+Equal")
  check("the graph: ⌘+ zooms it", await until(async () => Math.abs(await drawn() - was) > 500, 3000), [was, await drawn()])
  await page.screenshot({ path: `${OUT}zoom-graph.png` })
  await ctx.close()
} finally {
  await browser.close()
  rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
}
await done()
