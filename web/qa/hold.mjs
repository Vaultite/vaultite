// A finger held still is the right-click on touch (components/ContextMenu.tsx, watchHolds), on a phone-sized page with
// touch: held on a blank tab's button its menu opens (once) and lifting the finger doesn't press the button; held and
// moved (a scroll) or lifted early, nothing; held on a note's text, no menu (the system's selection stays); held on a
// tab card in the tab list, its menu (and the card is picked up). Chrome's touch emulation, not an iPhone:
// WebKit's own hold (selection, a link's preview) isn't covered. WRITES .vaultite/newtab.json: throwaway only.
//   node web/qa/hold.mjs <base url> <vault path> [out dir]
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fingers, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/hold-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

rmSync(path.join(VAULT, ".vaultite/newtab.json"), { force: true })
try {
  const page = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
  const { touch } = await fingers(page)
  /** A finger on the element's middle for `ms`, moved `dy` px on the way, then lifted. */
  const hold = async (sel, ms = 700, dy = 0) => {
    const b = await page.locator(sel).first().boundingBox()
    const x = b.x + Math.min(b.width / 2, 60), y = b.y + b.height / 2
    await touch("touchStart", x, y)
    if (dy) { await wait(100); await touch("touchMove", x, y + dy) }
    await wait(ms)
    await touch("touchEnd", x, y)
    await wait(300)
  }
  const menus = () => page.locator("[role=menu]").count()
  const closeMenus = async () => { for (let i = 0; i < 3 && await menus(); i++) { await page.keyboard.press("Escape"); await wait(150) } }

  await page.goto(B)
  await page.waitForSelector("[data-bar='new']", { timeout: 30000 })
  await page.click("[data-bar='new']")
  await page.waitForSelector("[data-newtab-action='file:new']")
  const tabs0 = await page.getAttribute("[data-tabs-button]", "aria-label")
  // Which contextmenu events come: Chrome's touch sends none of its own, like iOS, so the menu is the hold's.
  await page.evaluate(() => { window.__menus = []; addEventListener("contextmenu", (e) => window.__menus.push(e.isTrusted), true) })

  await hold("[data-newtab-action='file:new']")
  check("held on a button: its menu opens, once", await menus() === 1 && await page.locator("[role=menu] >> text=Move down").count() === 1, await menus())
  check("held on a button: the menu is the hold's (one contextmenu event, sent by the app)", JSON.stringify(await page.evaluate(() => window.__menus)) === "[false]", await page.evaluate(() => window.__menus))
  await page.screenshot({ path: path.join(OUT, "held-button.png") })
  check("held on a button: lifting the finger doesn't press it (no note made)", await page.locator("[data-newtab-action='file:new']").count() === 1 &&
    (await page.getAttribute("[data-tabs-button]", "aria-label")) === tabs0)
  await closeMenus()

  await hold("[data-newtab-section='core:changed'] a", 700, 40)
  check("held and moved (a scroll): no menu", await menus() === 0, await menus())
  await hold("[data-newtab-action='palette:open']", 200)
  check("lifted early: no menu (a tap: the palette opens)", await menus() === 0 && await until(() => page.locator("[role=dialog]").count()), await menus())
  await page.keyboard.press("Escape")
  await wait(200)

  await hold("[data-newtab-section='core:changed'] a")
  check("held on a file's row: the page's menu", await menus() === 1, await menus())
  await closeMenus()

  // A note's text: nothing takes the hold (the system's selection would).
  await page.click("[data-newtab-section='core:changed'] a")
  await until(() => page.locator("main p, main li").count())
  const text = await page.locator("main p").count() ? "main p" : "main li"
  await hold(text)
  check("held on a note's text: no menu", await menus() === 0, await menus())

  // The tab list: a card held is picked up to move it, not a menu.
  await page.click("[data-tabs-button]")
  if (await until(() => page.locator("[data-tab-row]").count(), 3000)) {
    // (once the list has slid in: a finger during its motion is on a picture of the screen)
    await until(() => page.evaluate(() => !document.documentElement.dataset.motion))
    await hold("[data-tab-row]")
    check("held on a tab card: its menu", await menus() === 1, await menus())
  } else console.log("skip  the tab list didn't open")
  await page.close()
} finally {
  rmSync(path.join(VAULT, ".vaultite/newtab.json"), { force: true })
  await browser.close()
}
console.log(`\nshots in ${OUT}`)
await done()
