// A ```query block (pages/QueryResults.tsx, pages/SearchHits.tsx) and pinned commands (core/palettepins.ts,
// components/CommandPalette.tsx). WRITES "Qa query/", palette.json: throwaway server.   node web/qa/querypins.mjs <base>
import { mkdirSync } from "node:fs"
import { SHOTS, apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B), DIR = "Qa query", NOTE = `${DIR}/Reading list.md`
await api("PUT", "file", { path: `${DIR}/Dune.md`, text: "---\ntags: [qa-book]\n---\nA desert planet and its spice.\n" })
await api("PUT", "file", { path: `${DIR}/Solaris.md`, text: "---\ntags: [qa-book]\n---\nAn ocean that thinks.\n" })
await api("PUT", "file", { path: NOTE, text: "Books I mean to read:\n\n```query\ntag:#qa-book\n(planet OR ocean OR shrike)\n```\n" })
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const { idle, sees } = app(page)
try {
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  const block = page.locator("[data-query-results]").first()
  await block.waitFor({ timeout: 20000 }); await idle()
  const files = () => block.locator("[data-search-file]").evaluateAll((els) => els.map((e) => e.getAttribute("data-search-file")).sort())
  check("the block lists the files its search finds", (await files()).join() === `${DIR}/Dune.md,${DIR}/Solaris.md`, await files())
  check("it says how many", /2 files/.test(await block.locator("[data-query-status]").innerText()), await block.locator("[data-query-status]").innerText())
  await sees(`${DIR}/Hyperion.md`, () => api("PUT", "file", { path: `${DIR}/Hyperion.md`, text: "---\ntags: [qa-book]\n---\nPilgrims and the Shrike.\n" }))
  check("a new file that matches shows up by itself", await until(async () => (await files()).includes(`${DIR}/Hyperion.md`), 8000), await files())
  await page.locator("[data-query-results]").first().locator("..").screenshot({ path: `${OUT}query-block.png` }).catch(() => page.screenshot({ path: `${OUT}query-block.png` }))
  await block.locator(`[data-search-file="${DIR}/Solaris.md"] button[data-keyrow]`).first().click(); await idle()
  check("a click opens the file", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("Solaris")), 5000), await page.evaluate(() => location.hash))

  await api("PUT", "config/palette", { pinned: ["search:open-tab"] })
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await block.waitFor({ timeout: 20000 }); await idle()
  const open = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("ControlOrMeta+P"); await page.waitForSelector("#palette-results [role=option]"); await idle() }
  const heads = () => page.locator("#palette-results [role=presentation]").allInnerTexts()
  const first = () => page.locator("#palette-results [role=option]").first().innerText()
  await open()
  check("a pinned command comes first, under Pinned", (await heads())[0] === "Pinned" && (await first()).startsWith("Open search in a tab"), [await heads(), await first()])
  const field = page.locator("[role=dialog] input").first()
  await field.fill("new base"); await idle()
  const row = page.locator("#palette-results [role=option]", { hasText: "New base" }).first()
  await row.hover()
  const pin = row.locator("xpath=..").locator("[data-row-action]")
  await pin.click(); await idle()
  const saved = await until(async () => { const c = await api("GET", "config/palette"); return c.pinned?.join() === "search:open-tab,query:new-base" && c }, 8000)
  check("a row's pin pins it, at the end of the pinned ones (palette.json)", !!saved, await api("GET", "config/palette"))
  await field.fill(""); await idle()
  const pinnedNames = () => page.locator("#palette-results [role=group]").first().locator("[role=option]").allInnerTexts()
  check("it moves up under Pinned at once", (await pinnedNames()).some((t) => t.startsWith("New base")), await pinnedNames())
  await page.locator("[role=dialog]").first().screenshot({ path: `${OUT}palette-pinned.png` }).catch(() => page.screenshot({ path: `${OUT}palette-pinned.png` }))
  await page.locator("#palette-results [role=group]").first().locator("[data-row-action][aria-pressed=true]").last().click(); await idle()
  check("its pin again unpins it", !!await until(async () => (await api("GET", "config/palette")).pinned?.join() === "search:open-tab", 8000), await api("GET", "config/palette"))
} finally {
  await api("DELETE", `file?path=${encodeURIComponent(DIR)}`).catch(() => {})
  await api("PATCH", "config/palette", { pinned: null }).catch(() => {})
  await browser.close()
}
await done()
