// Phones: a held tab card's More ▸ opens in place (Back row returns), the sheet's bar says Done, and Done on an unsaved
// form asks first; desktop's More ▸ still flies out. Chrome's touch emulation, not an iPhone. Read-only.
//   node web/qa/phonemenus.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import path from "node:path"
import { fingers, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/phonemenus-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const page = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
const { touch } = await fingers(page)
/** A finger on the element for `ms` (a tap is short, a hold is long; a slow tap must still work). */
const press = async (loc, ms) => {
  const b = await loc.first().boundingBox()
  const x = b.x + Math.min(b.width / 2, 60), y = b.y + b.height / 2
  await touch("touchStart", x, y); await wait(ms); await touch("touchEnd", x, y); await wait(350)
}
/** Whether the menu's first row is what a finger there would hit (not under a sheet). */
const onTop = () => page.evaluate(() => [...document.querySelectorAll("[role=menu]")].every((m) => {
  const r = m.getBoundingClientRect(); return m.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 12))
}))
const rows = () => page.locator("[role=menu] button").allInnerTexts()

await page.goto(B)
await page.waitForSelector("[data-tabs-button]", { timeout: 30000 })
await page.click("[data-tabs-button]")
await page.waitForSelector("[data-tab-row]")
check("the sheet's bar says Done", (await page.locator("dialog[open] [data-sheet-done]").innerText()).trim() === "Done")

// (once the list has slid in: a finger during its motion is on a picture of the screen)
await until(() => page.evaluate(() => !document.documentElement.dataset.motion))
await press(page.locator("[data-tab-row]"), 700)
check("held tab card: its menu", await page.locator("[role=menu]").count() === 1)
for (const ms of [60, 300]) {
  await press(page.locator("[role=menu] button", { hasText: /^More$/ }), ms)
  const r = await rows()
  check(`More tapped (${ms}ms): its items in place, one menu, on top`, await page.locator("[role=menu]").count() === 1 && r[0] === "More" && r.length > 2 && await onTop(), r)
  await page.screenshot({ path: path.join(OUT, `more-${ms}.png`) })
  await press(page.locator("[role=menu] button").first(), 60)
  check(`Back row (${ms}ms): the menu again`, (await rows()).includes("Close tab"), await rows())
}
await page.keyboard.press("Escape"); await wait(200)
check("Escape: the menu closes", !(await page.locator("[role=menu]").count()))

// An unsaved form: Done asks, Cancel keeps it, Discard closes.
await page.goto(`${B}#bundles/bundle-save`)
await page.waitForSelector("dialog[open] [data-bundle-name]")
await page.locator("dialog[open] [data-bundle-name]").fill("Weekend setup")
await page.locator("dialog[open] [data-sheet-done]").click()
const asked = await until(() => page.locator("dialog[data-confirm][open]").count())
check("Done with a name typed: asks first, showing it", !!asked && (await page.locator("#confirm-body").innerText()).includes("Weekend setup"))
await wait(300); await page.screenshot({ path: path.join(OUT, "discard.png") })
await page.locator("[data-confirm] [data-cancel]").click(); await wait(300)
check("Cancel: the form stays, as typed", await page.locator("dialog[open] [data-bundle-name]").inputValue() === "Weekend setup")
await page.locator("dialog[open] [data-sheet-done]").click()
await until(() => page.locator("dialog[data-confirm][open]").count())
await page.locator("[data-confirm] [data-confirm-ok]").click()
check("Discard: the sheet closes", !!await until(async () => !(await page.locator("dialog[open] [data-bundle-name]").count())))
await page.goto(`${B}#bundles/bundle-save`)
await page.waitForSelector("dialog[open] [data-bundle-name]")
await page.locator("dialog[open] [data-sheet-done]").click()
check("Done with nothing typed: closes at once", !!await until(async () => !(await page.locator("dialog[open] [data-bundle-name]").count()), 2000) && !(await page.locator("dialog[data-confirm][open]").count()))
await page.close()

// Desktop keeps its flyouts: More ▸ opens beside the menu on hover.
const desk = watch(await browser.newPage({ viewport: { width: 1400, height: 900 } }))
await desk.goto(B)
await desk.waitForSelector("[role=tab], [data-tab]", { timeout: 30000 })
await desk.locator("[role=tab], [data-tab]").first().click({ button: "right" })
await desk.locator("[role=menu] button", { hasText: /^More$/ }).hover()
check("desktop: More ▸ opens beside, its own menu", !!await until(async () => await desk.locator("[role=menu]").count() === 2, 2000), await desk.locator("[role=menu]").count())
await desk.screenshot({ path: path.join(OUT, "desktop-more.png") })
await desk.close()
console.log(`\nshots in ${OUT}`)
await done()
