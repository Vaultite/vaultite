// Close pane (core/workspace.ts closePane), with the tab bar and pane titles off (appearance `tabBar`, `paneTitles`):
// Close current tab on a pinned tab leaves it open and says why; the thin strip's X (on hover) closes the pane, pinned
// tabs too, and Reopen closed tab brings it back whole, where it sat (its size, tabs, pin, shown tab); the strip's menu
// and the palette's Close pane do the same; the only pane has neither. With titles on, the title row has the X too.
// WRITES the vault's appearance.json (put back): throwaway server only.
//   node web/qa/closepane.mjs <base url> <vault path>
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const [a, b, c] = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 3).map((f) => `Notes/${f}`)
const look = path.join(VAULT, ".vaultite", "appearance.json")
const was = existsSync(look) ? readFileSync(look, "utf8") : null
const lookAs = (o) => writeFileSync(look, JSON.stringify({ ...JSON.parse(was ?? "{}"), ...o }) + "\n")
lookAs({ tabBar: false, paneTitles: false })

try {
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
  await page.goto(`${B}/#new`)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs"))
  await page.reload()
  await page.waitForSelector("[data-tab-bar]", { state: "attached", timeout: 30000 })
  const hash = (f) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)
  /** Each pane: its files ("*" after a pinned one), the shown one, its box, and whether it's focused. */
  const panes = () => page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem("vaultite.tabs"))
    const leaves = (n) => (n.tabs ? [n] : n.kids.flatMap(leaves))
    return leaves(w.root).map((g) => {
      const r = document.querySelector(`[data-group="${g.id}"]`)?.getBoundingClientRect()
      return { tabs: g.tabs.map((t) => t.to.replace(/^file:/, "") + (t.pinned ? "*" : "")), active: g.tabs.find((t) => t.id === g.active)?.to.replace(/^file:/, ""),
        box: r && [r.x, r.y, r.width, r.height].map(Math.round).join(","), focus: w.focus === g.id }
    })
  })
  const toast = (text) => until(() => page.locator("[data-sonner-toast]", { hasText: text }).count(), 3000)
  const menuItem = async (label) => {
    const it = page.locator("[role=menuitem]", { hasText: label }).first()
    if (!(await it.count())) { await page.keyboard.press("Escape"); return false }
    await it.click(); await wait(300); return true
  }

  // a on top; below it b and c, c pinned.
  await hash(a); await until(async () => (await panes())[0]?.active === a)
  await command(page, "Close all other tabs")
  await command(page, "Split down"); await hash(b); await until(async () => (await panes())[1]?.active === b)
  await command(page, "Open new tab"); await hash(c); await until(async () => (await panes())[1]?.active === c)
  await command(page, "Pin tab")
  const before = await panes()
  check("two panes, the lower one's c pinned", same(before.map((p) => p.tabs), [[a], [b, `${c}*`]]) && before[1].focus, before)

  await command(page, "Close current tab")
  check("Close current tab on a pinned tab says why", await toast("Pinned: unpin it or close the pane"))
  check("…and leaves it open", same(await panes(), before), await panes())

  // The lower pane's strip (not at the window's top: drawn), its X on hover.
  const strip = page.locator(`[data-group]:not([data-top]) [data-bare]`)
  const x = page.locator(`[data-group]:not([data-top]) [data-pane-close]`)
  await strip.hover(); await wait(250)
  check("the strip shows an X on hover, beside the handle", (await x.evaluate((e) => getComputedStyle(e).opacity)) === "1"
    && await x.evaluate((e) => !!e.nextElementSibling?.matches("[data-pane-handle]")))
  await x.click()
  check("its X closes the pane, the pinned tab too", await until(async () => same((await panes()).map((p) => p.tabs), [[a]])), await panes())
  check("Reopen closed tab is offered", await command(page, "Reopen closed tab"))
  check("…and brings the pane back where it sat, whole", await until(async () => same(await panes(), before)), [await panes(), before])

  // The strip's menu.
  await strip.click({ button: "right", position: { x: 40, y: 4 } }); await wait(200)
  check("the strip's menu has Close pane", await menuItem("Close pane"))
  check("…which closes it", await until(async () => (await panes()).length === 1), await panes())
  await command(page, "Reopen closed tab")
  check("…and it comes back again", await until(async () => same(await panes(), before)), await panes())

  // The palette's, on the focused pane.
  check("the palette has Close pane", await command(page, "Close pane"))
  check("…closing the focused pane", await until(async () => same((await panes()).map((p) => p.tabs), [[a]])), await panes())

  // The only pane: nothing to close it with.
  check("the only pane: no Close pane in the palette", !(await command(page, "Close pane")))
  check("…nor an X", (await page.locator("[data-pane-close]").count()) === 0)
  await command(page, "Pin tab"); await command(page, "Close current tab")
  check("…and a pinned tab says only to unpin it", await toast("Pinned: unpin it to close it"))
  await command(page, "Unpin tab")

  // Pane titles on: the X beside each title row's handle.
  await command(page, "Reopen closed tab"); await until(async () => (await panes()).length === 2)
  lookAs({ tabBar: false, paneTitles: true })
  check("with titles, each title row has the X", await until(async () => (await page.locator("[data-pane-title] ~ [data-pane-close]").count()) === 2, 8000))
  await page.locator("[data-pane-close]").last().click()
  check("…which closes its pane", await until(async () => (await panes()).length === 1), await panes())
} finally {
  await browser.close()
  if (was === null) rmSync(look, { force: true }); else writeFileSync(look, was)
}
await done()
