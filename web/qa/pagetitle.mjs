// A file's title is one thing everywhere: dashboards' and notes' alike, Show inline title off, a phone's header name.
// Writes .vaultite/editor.json (put back) and Qa page title/ (removed): throwaway server only.
//   node web/qa/pagetitle.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, OUT = "/tmp/pagetitle-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const hash = (p) => `#file/${encodeURIComponent(p)}`
const DASH = "Qa page title/Board.md", NOTE = "Qa page title/Long note.md"
mkdirSync(`${VAULT}/Qa page title`, { recursive: true })
writeFileSync(`${VAULT}/${DASH}`, "---\ntype: dashboard\nicon: sun\ntint: orange\n---\n\nWhat this board is.\n\n```block-routines\n```\n")
writeFileSync(`${VAULT}/${NOTE}`, `---\nicon: leaf\n---\n\n${Array.from({ length: 80 }, (_, i) => `Line ${i + 1} of a long note.`).join("\n\n")}\n`)
const editorFile = `${VAULT}/.vaultite/editor.json`
const editorWas = (() => { try { return readFileSync(editorFile, "utf8") } catch { return null } })()
const setEditor = async (v) => { writeFileSync(editorFile, JSON.stringify(v) + "\n"); await wait(1200) }

const size = (page, sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).fontSize)
const title = "article.file-view [data-title-row]"

// ---------- desktop ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}${hash(NOTE)}`)
  await until(() => page.locator(`${title} h1, ${title} textarea`).count(), 8000)
  const noteSize = await size(page, `${title} h1, ${title} textarea`)
  await page.goto("about:blank"); await page.goto(`${B}${hash(DASH)}`)
  check("dashboard read: a grid", await until(() => page.locator('[class~="@container"] > .grid > *').count(), 8000))
  check("dashboard read: its title is the file's name", (await page.locator(`${title} h1`).first().innerText()).trim() === "Board")
  check("dashboard read: a note's size", (await size(page, `${title} h1`)) === noteSize, [await size(page, `${title} h1`), noteSize])
  check("dashboard read: its icon before the title", (await page.locator(`${title} [data-title-icon]`).count()) === 1)
  check("dashboard read: no Properties", (await page.locator("article.file-view section[aria-label=Properties]").count()) === 0)
  check("dashboard read: its first line is text", (await page.locator("article.file-view").innerText()).includes("What this board is."))
  await page.screenshot({ path: `${OUT}dashboard-read.png` })
  await page.locator("button[aria-label=Edit]").first().click(); await wait(800)
  check("dashboard edited: the title renames (a field), the same size",
    (await page.locator(`${title} textarea[aria-label='File name']`).count()) === 1 && (await size(page, `${title} textarea`)) === noteSize)
  check("dashboard edited: Properties", (await page.locator("article.file-view section[aria-label=Properties]").count()) === 1)
  await page.screenshot({ path: `${OUT}dashboard-edit.png` })
  await setEditor({ showInlineTitle: false })
  await page.goto("about:blank"); await page.goto(`${B}${hash(DASH)}`)
  await until(() => page.locator('[class~="@container"] > .grid > *').count(), 8000)
  check("inline title off: no title drawn", (await page.locator(title).count()) === 0)
  check("inline title off: still in the path bar", (await page.locator("nav[aria-label='File path']").innerText()).includes("Board"))
  await page.screenshot({ path: `${OUT}dashboard-no-title.png` })
  await setEditor({})
  await ctx.close()
}

// ---------- phone ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = watch(await ctx.newPage(), { label: "phone" })
  const headerName = () => page.locator("[data-phone-title]").evaluate((e) => Number(getComputedStyle(e).opacity))
  await page.goto(`${B}${hash(NOTE)}`)
  await until(() => page.locator(`${title} h1`).count(), 8000); await wait(400)
  check("phone: the header's name is hidden while the title is in sight", (await headerName()) === 0, await headerName())
  await page.screenshot({ path: `${OUT}phone-top.png` })
  await page.evaluate(() => scrollTo(0, 600)); await wait(500)
  check("phone: scrolled past the title, the header names the file", (await headerName()) === 1, await headerName())
  await page.screenshot({ path: `${OUT}phone-scrolled.png` })
  await page.evaluate(() => scrollTo(0, 0)); await wait(500)
  check("phone: back at the top, hidden again", (await headerName()) === 0, await headerName())
  await page.goto("about:blank"); await page.goto(`${B}${hash(DASH)}`)
  await until(() => page.locator(`${title} h1`).count(), 8000); await wait(400)
  check("phone dashboard: one title, the header's hidden", (await page.locator(`${title} h1`).innerText()).trim() === "Board" && (await headerName()) === 0)
  await page.screenshot({ path: `${OUT}phone-dashboard.png` })
  await setEditor({ showInlineTitle: false })
  await page.goto("about:blank"); await page.goto(`${B}${hash(NOTE)}`); await wait(1500)
  check("phone, inline title off: the header names the file at the top", (await page.locator(title).count()) === 0 && (await headerName()) === 1)
  await page.screenshot({ path: `${OUT}phone-no-title.png` })
  await ctx.close()
}

if (editorWas === null) rmSync(editorFile, { force: true }); else writeFileSync(editorFile, editorWas)
rmSync(`${VAULT}/Qa page title`, { recursive: true, force: true })
await done()
