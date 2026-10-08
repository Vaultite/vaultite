// Pinned headings and searches (bookmarks; plugins/core/pages): Pin current heading to the sidebar (the
// heading the cursor is under) and Pin current search to the sidebar, each a row in Pinned with its own icon; a click
// opens the note at its heading, or the search; they follow a rename of their note; Unpin from their menu.
// WRITES a note and pages.json: throwaway only.
//   node web/qa/bookmarks.mjs <base url> <vault path>
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const NOTE = "Notes/Bookmarked.md"
writeFileSync(path.join(VAULT, NOTE), `# Top\n\n${"Filler line.\n\n".repeat(60)}## Deep heading\n\nUnder it.\n${"More.\n\n".repeat(40)}`)
const pins = () => { try { return JSON.parse(readFileSync(path.join(VAULT, ".vaultite/pages.json"), "utf8")).pinned ?? [] } catch { return [] } }

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 30000 }); await wait(600)
// The cursor under "Deep heading".
await page.click("[data-pane] .cm-content"); await page.keyboard.press("ControlOrMeta+ArrowDown"); await wait(200)
check("Pin current heading to the sidebar", await command(page, "Pin current heading to the sidebar"))
check("pinned as the note's heading", await until(() => pins().includes(`${NOTE}#Deep heading`)), pins())
const row = page.locator(`aside [data-pin="${NOTE}#Deep heading"]`)
check("a row named by the heading", await until(async () => (await row.count()) === 1 && /Deep heading/.test(await row.innerText())))

// Open another note, then the pinned heading: the note, scrolled to it.
await page.evaluate(() => { location.hash = "#new" }); await wait(500)
await row.click()
check("a click opens the note", await until(() => page.evaluate((n) => decodeURIComponent(location.hash).includes(n), NOTE)))
const shown = await until(() => page.evaluate(() => {
  const h = [...document.querySelectorAll("[data-pane] .cm-line, [data-pane] h2")].find((e) => /Deep heading/.test(e.textContent ?? ""))
  if (!h) return false
  const r = h.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight
}))
check("at its heading", !!shown)

// A search.
await page.keyboard.press("ControlOrMeta+Shift+F"); await wait(500)
await page.keyboard.type("Filler"); await wait(800)
check("Pin current search to the sidebar", await command(page, "Pin current search to the sidebar"))
check("pinned as a search", await until(() => pins().includes("search:Filler")), pins())
const srow = page.locator(`aside [data-pin="search:Filler"]`)
await page.evaluate(() => { location.hash = "#new" }); await wait(500)
await srow.click()
check("a click opens the search", await until(() => page.evaluate(() => decodeURIComponent(location.hash) === "#view/search/Filler")), await page.evaluate(() => location.hash))

// A rename takes the heading's pin along.
await page.evaluate(async (n) => { await fetch("api/file/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: n, to: "Notes/Bookmarked 2.md" }) }) }, NOTE)
check("the heading follows its note's rename", await until(() => pins().includes("Notes/Bookmarked 2.md#Deep heading")), pins())

await srow.click({ button: "right" }); await page.click("[role=menu] >> text=Unpin")
check("Unpin from its menu", await until(() => !pins().includes("search:Filler")), pins())
await done()
