// The phone drawer's dock at iPhone size: the Buttons panel's heading held, Put in the dock; its buttons are icons above
// the vault's row, out of the stack; one held shows its name and menu, dragged it moves, tapped it runs; Take out of the
// dock puts the panel back. WRITES .vaultite/sidebars.json and newtab.json: throwaway only.
//   node web/qa/phonedock.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fingers, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/phonedock-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const conf = (f) => { try { return JSON.parse(readFileSync(path.join(VAULT, ".vaultite", f), "utf8")) } catch { return {} } }

rmSync(path.join(VAULT, ".vaultite/newtab.json"), { force: true })
writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["pages:pages", "buttons:buttons", "files:files"], right: [], collapsed: [] }))
try {
  for (const scheme of ["light", "dark"]) {
    const page = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme }))
    const { touch } = await fingers(page)
    const mid = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
    /** A finger held on the element for `ms`, then lifted (or moved to `to` first: a drag). */
    const hold = async (sel, ms = 700, to) => {
      const { x, y } = await mid(sel)
      await touch("touchStart", x, y); await wait(ms)
      if (to) { for (let i = 1; i <= 8; i++) { await touch("touchMove", x + ((to.x - x) * i) / 8, y + ((to.y - y) * i) / 8); await wait(30) } }
      await touch("touchEnd", x, y); await wait(400)
    }
    const items = () => page.locator("[role=menu] [role=menuitem]").allTextContents()
    const pick = async (label) => { await page.locator(`[role=menu] [role=menuitem]:has-text("${label}")`).first().tap(); await wait(500) }
    const dock = "[data-phone-drawer] [data-phone-dock]"
    const icons = () => page.locator(`${dock} [data-newtab-action]`).evaluateAll((els) => els.map((e) => e.dataset.newtabAction))
    const open = async () => { await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await wait(500) }

    await page.goto(B)
    await page.waitForSelector("[data-phone-header]", { timeout: 30000 })
    // A toast (the sandbox's) would sit over the dock.
    await page.addStyleTag({ content: "[data-sonner-toaster] { display: none !important }" })
    await open()
    const stacked = "[data-phone-drawer] [data-sidebar-body] [data-panel='buttons:buttons']"
    if (scheme === "light") {
      check("undocked: Buttons in the drawer's stack, no dock", await page.locator(stacked).count() === 1 && await page.locator(dock).count() === 0)
      await hold(`${stacked} [data-panel-handle]`)
      check("its heading held: Put in the dock", (await items()).some((t) => t.includes("Put in the dock")), await items())
      await pick("Put in the dock")
      check("docked: saved in sidebars.json", JSON.stringify(conf("sidebars.json").dock) === '["buttons:buttons"]', conf("sidebars.json"))
    }
    const ids = await icons()
    check(`${scheme}: the dock shows the buttons as icons, out of the stack`, ids.length >= 3 && await page.locator(stacked).count() === 0, ids)
    const box = await page.locator(`${dock} [data-newtab-action]`).first().boundingBox()
    check(`${scheme}: 44px targets`, Math.round(box.width) === 44 && Math.round(box.height) === 44, box)
    const nav = await page.locator("[data-phone-drawer] nav[aria-label=App]").boundingBox()
    check(`${scheme}: the dock sits right above the vault's row`, Math.abs(box.y + box.height + 4 - nav.y) <= 6, { box, nav })
    await page.screenshot({ path: `${OUT}phonedock-${scheme}.png` })
    if (scheme === "dark") { await page.close(); continue }

    // Held: its name first, then its menu; nothing runs.
    const hash0 = await page.evaluate(() => location.hash)
    await hold(`${dock} [data-newtab-action='${ids[0]}']`)
    const menu = await items()
    check("an icon held: its name, Move right, Take out of the dock", menu.includes("Move right") && menu.some((t) => t.includes("Take out of the dock")) && await page.locator("[role=menu]").first().innerText().then((t) => t.trim().length > 0), menu)
    await page.screenshot({ path: `${OUT}phonedock-menu.png` })
    await pick("Move right")
    check("Move right: second in newtab.json", conf("newtab.json").actions?.[1] === ids[0] && await page.evaluate(() => location.hash) === hash0, conf("newtab.json"))

    // Dragged after the last: last.
    const now = await icons()
    const last = await page.locator(`${dock} [data-newtab-action='${now[now.length - 1]}']`).boundingBox()
    await hold(`${dock} [data-newtab-action='${now[0]}']`, 700, { x: last.x + last.width + 2, y: last.y + last.height / 2 })
    const after = conf("newtab.json").actions ?? []
    check("dragged past the last icon: it's last", after[after.length - 1] === now[0], { now, after })
    for (let i = 0; i < 3 && await page.locator("[role=menu]").count(); i++) { await page.keyboard.press("Escape"); await wait(150) }

    // Tapped: it runs (New note opens a tab), and the drawer closes.
    if ((await icons()).includes("file:new")) {
      await page.locator(`${dock} [data-newtab-action='file:new']`).tap(); await wait(900)
      check("New note tapped: a new file, the drawer closed", await page.evaluate(() => location.hash) !== hash0 && !await page.locator("[data-phone-drawer]").count(), await page.evaluate(() => location.hash))
      await open()
    }

    // Taken out: back in the stack.
    await hold(`${dock} [data-newtab-action]`)
    await pick("Take out of the dock")
    check("taken out: no dock, Buttons in the stack", await page.locator(dock).count() === 0 && await page.locator(stacked).count() === 1)
    // Docked again for the dark run.
    await hold(`${stacked} [data-panel-handle]`); await pick("Put in the dock")
    await page.close()
  }
} catch (e) { check("ran to the end", false, String(e).slice(0, 300)) } finally {
  await done()
}
