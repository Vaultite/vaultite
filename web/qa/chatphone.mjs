// Claude Code's chat on a phone: the composer's choices fit its one line, and the chat draws once.
// WRITES a note, taken away: throwaway server only. Starts no session.
//   node web/qa/chatphone.mjs <base url> <vault path> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, , OUT = "/tmp/chatphone-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B)
mkdirSync(OUT, { recursive: true })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
await page.goto(`${B}#view/${encodeURIComponent("claude-session/new")}`)
const chip = page.locator('[data-composer] button[aria-label="Permission mode"]')
await chip.waitFor({ timeout: 15000 })
await wait(800)
await page.evaluate(() => { document.querySelector("[data-composer]").__qaKept = true })
const NOTE = "Notes/Chat redraw check.md"
await api("PUT", "file", { path: NOTE, text: "# Chat redraw check\n" })
await wait(2500)
await api("DELETE", `file?path=${encodeURIComponent(NOTE)}`).catch(() => {})
check("chat on a phone: a redraw once its code has come keeps the chat drawn, not drawn anew", await page.evaluate(() => document.querySelector("[data-composer]")?.__qaKept === true))
const shown = (await chip.innerText()).trim()
check("chat on a phone: the permission mode is a short word, auto by default", shown === "Auto", shown)
const fits = await page.evaluate(() => {
  const c = document.querySelector('[data-composer] button[aria-label="Permission mode"]'), row = c?.parentElement
  if (!c || !row) return null
  const a = c.getBoundingClientRect(), r = row.getBoundingClientRect()
  return { fits: a.right <= r.right + 0.5 && a.left >= r.left - 0.5, chip: [a.left, a.right], row: [r.left, r.right], scrolled: row.scrollLeft }
})
check("chat on a phone: the permission mode chip is whole on screen, not scrolled off its row", !!fits?.fits && fits.scrolled === 0, fits)
await page.screenshot({ path: `${OUT}composer.png` })
await chip.tap()
const auto = page.getByRole("menuitemradio", { name: /Auto mode/ })
check("chat on a phone: its menu has the modes, auto chosen", (await auto.getAttribute("aria-checked").catch(() => null)) === "true",
  await page.locator("[role=menu]").innerText().catch(() => ""))
await page.screenshot({ path: `${OUT}menu.png` })
await ctx.close()
await done()
