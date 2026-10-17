// Shortcodes (plugins/core/shortcodes): `:fir` suggests 🔥 with its emoji, Enter puts it in; `:icon-cal` an icon, written
// `:LiCalendar:` and drawn as the icon off the cursor and while reading; `:fire:` typed whole becomes 🔥; on a phone the
// list's rows are 44px. WRITES a "Qa shortcodes" folder: throwaway server only.
//   node web/qa/shortcodes.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json" }
const NOTE = "Qa shortcodes/Shortcodes.md"
const write = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path, text, base: null }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${encodeURIComponent(path)}`)).json()).text

for (const phone of [false, true]) {
  await write(NOTE, "---\ntype: note\n---\n\nFirst line.\n")
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 860 } })
  const page = watch(await ctx.newPage())
  const tag = phone ? "phone" : "desktop"
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(2500)
  const ed = page.locator(".vau-editor .cm-content").first()
  await ed.click(); await page.keyboard.press("ControlOrMeta+End"); await wait(200)
  if (phone) { await page.locator("button[aria-label='Edit']").first().tap(); await wait(800); await ed.locator(".cm-line").last().tap(); await wait(300) }
  await page.keyboard.press("End")
  await page.keyboard.type(" Hot :fir", { delay: 40 })
  const list = page.locator(".cm-tooltip-autocomplete")
  const first = await until(() => list.locator("li").first().textContent(), 5000)
  check(`${tag}: :fir suggests 🔥 :fire: first`, first?.includes("🔥") && first.includes(":fire:"), first)
  if (phone) {
    const h = await list.locator("li").first().evaluate((el) => el.getBoundingClientRect().height)
    check("phone: the list's rows are 44px", h >= 44, h)
  }
  await page.screenshot({ path: `${OUT}/shortcodes-${tag}-list.png` })
  await wait(400); await page.keyboard.press("Enter"); await wait(300)
  await page.keyboard.type(" due :icon-calen", { delay: 40 })
  const icon = await until(() => list.locator("li").first().textContent(), 5000)
  check(`${tag}: :icon-calen suggests the calendar icon, drawn`, icon?.includes("calendar") && await list.locator("li").first().locator("svg").count() === 1, icon)
  await wait(400); await page.keyboard.press("Enter"); await wait(300)
  await page.keyboard.type(" then :smile: done", { delay: 40 }); await wait(1500)
  const text = await until(async () => { const t = await read(NOTE); return t.includes("done") && t }, 5000)
  check(`${tag}: the file has 🔥, :LiCalendar: and 😄`, text?.includes("Hot 🔥 due :LiCalendar: then 😄 done"), text)
  await page.keyboard.press("Enter"); await wait(300)
  const drawn = await page.locator(".cm-content .vau-shortcode-icon svg").count()
  check(`${tag}: :LiCalendar: shows as the icon off the cursor`, drawn === 1, drawn)
  await page.screenshot({ path: `${OUT}/shortcodes-${tag}-drawn.png` })
  await ctx.close()
}
done()
