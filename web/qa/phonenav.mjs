// Phone navigation at iPhone size: the header (the sidebar's button, the name, the … menu), the bar (Back, search, new
// tab, tabs, menu), the left drawer (a swipe from the edge, real touches through CDP; the button; a file opened from it
// closes it and opens in a tab), Back, and the bar's menu. Reads only (opens tabs on this device), but run it against a
// throwaway server anyway:
//   QA_BASE=http://127.0.0.1:8799/ node web/qa/phonenav.mjs [shots dir]
import { SHOTS, fingers, qa } from "./lib/qa.mjs"
const { args: [dir = SHOTS], browser, errs, watch } = await qa(import.meta.url)
const B = process.env.QA_BASE ?? "http://127.0.0.1:8799/"
const out = {}
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme })
  const page = watch(await ctx.newPage())
  const { swipe } = await fingers(page)
  const shot = (n) => page.screenshot({ path: `${dir}phonenav-${scheme}-${n}.png` })
  const drawer = () => page.evaluate(() => { const d = document.querySelector("[data-phone-drawer]"); return d ? { side: d.dataset.phoneDrawer, x: Math.round(d.getBoundingClientRect().left), hidden: d.getAttribute("aria-hidden") } : null })
  const state = () => page.evaluate(() => ({ hash: decodeURIComponent(location.hash), title: document.querySelector("[data-phone-title]")?.textContent, back: !document.querySelector("[data-bar=back]")?.disabled }))
  await page.goto(B); await page.waitForTimeout(1500)
  const r = (out[scheme] = {})
  r.start = await state()
  await shot("1-start")
  // The left edge, swiped: the drawer follows and opens.
  await swipe(4, 400, 300, 410)
  await page.waitForTimeout(400)
  r.swiped = await drawer()
  await shot("2-drawer")
  // Swiped back: it closes.
  await swipe(300, 400, 20, 400)
  await page.waitForTimeout(400)
  r.swipedBack = await drawer()
  // The header's button opens it; a file from the tree opens in a tab, and it closes.
  await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await page.waitForTimeout(500)
  r.button = await drawer()
  const row = page.locator("[data-phone-drawer] [data-tree-path$='.md']:not([data-tree-folder])").first()
  r.rowFound = await row.count()
  if (r.rowFound) { await row.scrollIntoViewIfNeeded(); r.rowPath = await row.getAttribute("data-tree-path"); await row.locator("button, a").first().tap(); await page.waitForTimeout(800) }
  r.opened = { ...(await state()), drawer: await drawer() }
  await shot("3-file")
  // Back: where it was.
  if (r.opened.back) { await page.locator("[data-bar=back]").tap(); await page.waitForTimeout(700) }
  r.afterBack = await state()
  // The bar's menu, and the header's … menu.
  await page.locator("[data-bar=menu]").tap(); await page.waitForTimeout(300)
  r.menu = await page.locator("#bar-menu [role=menuitem]").allTextContents()
  await shot("4-menu")
  await page.locator("[aria-label='Close menu']").tap(); await page.waitForTimeout(200)
  await page.locator("[data-phone-header] button[aria-label=More]").tap(); await page.waitForTimeout(300)
  await shot("5-more")
  await page.keyboard.press("Escape"); await page.waitForTimeout(200)
  // New tab.
  await page.locator("[data-bar=new]").tap(); await page.waitForTimeout(500)
  r.newTab = await state()
  await shot("6-newtab")
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify({ ...out, errs }, null, 1))
