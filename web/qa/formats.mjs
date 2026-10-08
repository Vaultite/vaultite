// Binary formats drawn from their bytes: a workbook (Spreadsheets: the grid, a sheet's tab, the filter), a Word
// document (Documents: its pages in a shadow root), a PowerPoint deck (Presentations: its slides), a book (E-books:
// the reader turns a page), an iPhone photo (HEIC, as JPEG in Chrome), each embedded in a note, and the phone sheet at
// 390px. The files are made up: tools/fixtures/formats/make.ts's (the backend tests' own), and a HEIC made with macOS's
// `sips` (skipped without it); or real ones from [fixtures dir] (Lease.docx, Pitch.pptx, Budget.xlsx with a Summary
// sheet, Log.epub, Photo.heic), whose contents are then only looked at, not checked word for word. WRITES to the vault
// (a "Qa formats" folder): throwaway server only.
//   node web/qa/formats.mjs <base url> <vault path> [fixtures dir] [out dir]
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, FIX, OUT = SHOTS], browser, check, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa formats"
const enc = encodeURIComponent
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
/** Made-up files (the default): what each holds is known, so it's checked. */
const made = !FIX
let heic = true
if (FIX) for (const f of ["Lease.docx", "Pitch.pptx", "Budget.xlsx", "Log.epub", "Photo.heic"]) copyFileSync(`${FIX}/${f}`, `${VAULT}/${DIR}/${f}`)
else {
  const fx = await import("../../tools/fixtures/formats/make.ts")
  writeFileSync(`${VAULT}/${DIR}/Lease.docx`, fx.docx())
  writeFileSync(`${VAULT}/${DIR}/Pitch.pptx`, fx.pptx())
  writeFileSync(`${VAULT}/${DIR}/Budget.xlsx`, fx.xlsx())
  writeFileSync(`${VAULT}/${DIR}/Log.epub`, fx.epub())
  try {
    execFileSync("sips", ["-s", "format", "heic", new URL("../public/icon-512.png", import.meta.url).pathname, "--out", `${VAULT}/${DIR}/Photo.heic`], { stdio: "ignore" })
  } catch { heic = false; console.log("skipped: HEIC (no macOS sips to make one)") }
}
const files = ["Budget.xlsx", "Lease.docx", "Pitch.pptx", "Log.epub", ...(heic ? ["Photo.heic"] : [])]
writeFileSync(`${VAULT}/${DIR}/Embeds.md`, `# Embeds\n\n![[Budget.xlsx${made ? "" : "#Summary"}]]\n\n![[Lease.docx]]\n\n![[Pitch.pptx]]\n\n![[Log.epub]]\n\n${heic ? "![[Photo.heic]]\n" : ""}`)
await wait(1500)

const out = { errs: [] }
const ok = (k, v) => { out[k] = v }
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  page.on("pageerror", (e) => out.errs.push(String(e)))
  const dialogs = []
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss() })
  const open = async (name, ms = 2500) => { await page.goto(`${B}#file/${enc(`${DIR}/${name}`)}`); await wait(ms) }
  const shot = (n) => page.screenshot({ path: `${OUT}formats-${n}.png` })

  await open("Budget.xlsx")
  ok("xlsxCells", await page.locator("[data-sheet-grid] td").count())
  ok("xlsxMoney", await page.locator("[data-sheet-grid] td", { hasText: made ? "$42.50" : "$350.00" }).count())
  ok("xlsxTabs", await page.locator("[data-workbook] [role=tab]").allTextContents())
  await page.locator("[data-workbook] input").fill(made ? "oil" : "storm"); await wait(300)
  ok("xlsxFiltered", await page.locator("[data-sheet-grid] tbody tr").allInnerTexts())
  await page.locator("[data-workbook] input").fill(""); await wait(200)
  await shot("xlsx")
  if (!made) {
    await page.locator("[data-workbook] [role=tab]", { hasText: "Summary" }).click(); await wait(300)
    ok("xlsxSummaryMerged", await page.locator("[data-sheet-grid] td[colspan='2']", { hasText: "Q3 summary" }).count())
  } else {
    await page.locator("[data-workbook] [role=tab]", { hasText: "Visitors" }).click(); await wait(300)
    ok("xlsxOtherSheet", await page.locator("[data-sheet-grid] td", { hasText: "Bob Lee" }).count())
  }

  await open("Lease.docx", 3500)
  ok("docxPages", await page.evaluate(() => document.querySelector("[data-docx]")?.shadowRoot?.querySelectorAll("section.docx").length ?? 0))
  ok("docxText", await page.evaluate((w) => document.querySelector("[data-docx]")?.shadowRoot?.textContent?.includes(w) ?? false, made ? "Lighthouse lease" : "harbour office"))
  ok("docxAppStyleUntouched", await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
  await shot("docx")

  await open("Pitch.pptx", 4000)
  ok("pptxSlides", await page.evaluate(() => document.querySelector("[data-deck]")?.getAttribute("data-deck")))
  ok("pptxText", await page.evaluate(() => document.querySelector("[data-deck]")?.textContent?.includes("Roadmap") ?? false))
  await shot("pptx")

  await open("Log.epub", 4000)
  const frameText = async () => {
    for (const f of page.frames()) { try { const t = await f.evaluate(() => document.body?.innerText ?? ""); if (/storm|harbour/i.test(t)) return t.slice(0, 80) } catch { /* not ours */ } }
    return ""
  }
  ok("epubText", await frameText())
  // (the book's pages are blob: frames: cleaned of scripts, a CSP first; its <script>alert(1)</script> never runs)
  const books = page.frames().filter((f) => f.url().startsWith("blob:"))
  ok("epubCleaned", books.length > 0 && (await Promise.all(books.map((f) => f.evaluate(() => !document.querySelector("script") && !!document.querySelector("meta[http-equiv=Content-Security-Policy]"))))).every(Boolean))
  ok("epubNoDialog", !dialogs.length)
  await shot("epub")
  await page.locator("[aria-label='Next page']").click(); await wait(1200)
  ok("epubTurned", await page.locator("[data-ebook]").textContent())
  ok("epubPlaceKept", await page.evaluate((p) => !!localStorage.getItem(`vau:ebooks:place:${p}`), `${DIR}/Log.epub`))

  if (heic) {
    await open("Photo.heic")
    ok("heicDrawn", await page.evaluate(() => document.querySelector("[data-image-view] img")?.naturalWidth ?? 0))
    ok("heicSrc", await page.evaluate(() => document.querySelector("[data-image-view] img")?.getAttribute("src")))
    await shot("heic")
  }

  await open("Embeds.md", 5000)
  ok("embedSheet", await page.locator("[data-format-embed] [data-sheet-grid]").count())
  ok("embedDocx", await page.locator("[data-format-embed] [data-docx]").count())
  ok("embedDeck", await page.locator("[data-format-embed] [data-deck]").count())
  ok("embedBook", await page.locator("[data-format-embed]", { hasText: "The keeper's log" }).count())
  await shot("embeds")
  await page.close()
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => out.errs.push(`390: ${e}`))
  const res = {}
  for (const name of files) {
    await page.goto(`${B}#view/files/file/${enc(`${DIR}/${name}`)}`); await wait(3500)
    res[name] = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > 390 }))
    await page.screenshot({ path: `${OUT}formats-phone-${name.replace(/\W/g, "_")}.png` })
  }
  ok("phone", res)
  await ctx.close()
}
await browser.close()
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })

// What it saw, checked.
check("workbook: its grid is drawn", out.xlsxCells >= 6, out.xlsxCells)
check("workbook: a money number in its format", out.xlsxMoney >= 1, out.xlsxMoney)
check("workbook: its sheets are tabs", out.xlsxTabs.length >= 2, out.xlsxTabs)
// (the sheet's first row stays: it's its header)
if (made) check("workbook: the filter keeps the matching rows", out.xlsxFiltered.some((r) => r.includes("Lamp oil")) && !out.xlsxFiltered.some((r) => r.includes("Paint")), out.xlsxFiltered)
else check("workbook: the filter keeps the matching rows", out.xlsxFiltered.length >= 1, out.xlsxFiltered)
if (made) check("workbook: another sheet's tab shows it", out.xlsxOtherSheet >= 1, out.xlsxOtherSheet)
else check("workbook: a merged cell spans its columns", out.xlsxSummaryMerged >= 1, out.xlsxSummaryMerged)
check("document: its pages are drawn", out.docxPages >= 1, out.docxPages)
check("document: its text is there", out.docxText, out.docxText)
check("deck: its slides are drawn", Number(out.pptxSlides) >= 2, out.pptxSlides)
check("deck: its text is there", out.pptxText, out.pptxText)
check("book: its text is there", !!out.epubText, out.epubText)
check("book: its pages are cleaned of scripts, with a CSP", out.epubCleaned, out.epubCleaned)
check("book: its script never ran", out.epubNoDialog, out.epubNoDialog)
check("book: Next turns the page", !!out.epubTurned, out.epubTurned)
check("book: the place is kept", out.epubPlaceKept, out.epubPlaceKept)
if (heic) {
  check("HEIC: drawn", out.heicDrawn > 0, out.heicDrawn)
  check("HEIC: as JPEG in Chrome", /as=jpeg/.test(out.heicSrc ?? ""), out.heicSrc)
}
check("embeds: the workbook", out.embedSheet === 1, out.embedSheet)
check("embeds: the document", out.embedDocx === 1, out.embedDocx)
check("embeds: the deck", out.embedDeck === 1, out.embedDeck)
check("embeds: the book", out.embedBook >= 1, out.embedBook)
for (const [name, r] of Object.entries(out.phone)) check(`390px ${name}: no sideways overflow`, !r.overflow, r)
check("no page errors", !out.errs.length, out.errs.slice(0, 3))
await done()
