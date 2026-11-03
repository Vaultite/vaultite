// Close pane (core/workspace.ts closePane) of a split tab with the tab bar and pane titles off, and Reopen closed tab
// bringing it back where it sat. WRITES the vault's appearance.json (put back): throwaway server only.
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
  await page.waitForSelector("[data-pane-bar]", { state: "attached", timeout: 30000 })
  const hash = (f) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)
  /** The tab on screen's panes: each one's file, its box, and whether it's focused; and the window's tabs. */
  const panes = () => page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem("vaultite.tabs")), t = w.tabs.find((x) => x.id === w.active)
    const leaves = (n) => (n.kids ? n.kids.flatMap(leaves) : [n])
    return leaves(t.root).map((p) => {
      const r = document.querySelector(`section[data-pane-frame="${p.id}"]:not([data-away])`)?.getBoundingClientRect()
      return { to: p.to.replace(/^file:/, ""), box: r && [r.x, r.y, r.width, r.height].map(Math.round).join(","), focus: t.focus === p.id }
    })
  })
  const tabs = () => page.evaluate(() => { const w = JSON.parse(localStorage.getItem("vaultite.tabs")); return w.tabs.map((t) => (t.pinned ? "*" : "") + (t.id === w.active ? ">" : "")) })
  const files = async () => (await panes()).map((p) => p.to)
  const menuItem = async (label) => {
    const it = page.locator("[role=menuitem]", { hasText: label }).first()
    if (!(await it.count())) { await page.keyboard.press("Escape"); return false }
    await it.click(); await wait(300); return true
  }

  // A split tab: a on top, b below it.
  await hash(a); await until(async () => (await panes())[0]?.to === a)
  await command(page, "Close all other tabs")
  await command(page, "Split down"); await hash(b); await until(async () => (await panes())[1]?.to === b)
  const before = await panes()
  check("one tab, split: a above b, b focused", same(before.map((p) => p.to), [a, b]) && before[1].focus, before)

  // A pinned tab beside it: Close current tab moves on and leaves it open, as Arc's.
  await command(page, "Open new tab"); await hash(c); await until(async () => same(await files(), [c]))
  await command(page, "Pin tab")
  await command(page, "Close current tab")
  check("Close current tab on a pinned tab moves on, as Arc's", await until(async () => same(await files(), [a, b])), await panes())
  check("…and leaves it open, pinned", same(await tabs(), [">", "*"]), await tabs())

  // The lower pane's strip (not at the window's top: drawn), its X on hover.
  const strip = page.locator("[data-pane-area] > section[data-pane-frame]:not([data-away]):not([data-top]) [data-pane-bar][data-bare]")
  const x = page.locator("[data-pane-area] > section[data-pane-frame]:not([data-away]):not([data-top]) [data-pane-close]")
  await strip.hover()
  await until(async () => (await x.evaluate((e) => getComputedStyle(e).opacity)) === "1", 2000)
  check("the strip shows an X on hover, beside the handle", (await x.evaluate((e) => getComputedStyle(e).opacity)) === "1"
    && await x.evaluate((e) => !!e.nextElementSibling?.matches("[data-pane-handle]")))
  await x.click()
  check("its X closes the pane", await until(async () => same(await files(), [a])), await panes())
  check("Reopen closed tab is offered", await command(page, "Reopen closed tab"))
  check("…and brings the pane back where it sat", await until(async () => same(await panes(), before)), [await panes(), before])

  // The strip's menu.
  await strip.click({ button: "right", position: { x: 40, y: 4 } }); await wait(200)
  check("the strip's menu has Close pane", await menuItem("Close pane"))
  check("…which closes it", await until(async () => (await panes()).length === 1), await panes())
  await command(page, "Reopen closed tab")
  check("…and it comes back again", await until(async () => same(await panes(), before)), await panes())

  // The palette's, on the focused pane.
  check("the palette has Close pane", await command(page, "Close pane"))
  check("…closing the focused pane", await until(async () => same(await files(), [a])), await panes())
  // Its keys, ⌥⇧⌘W.
  await command(page, "Reopen closed tab"); await until(async () => (await panes()).length === 2)
  await page.keyboard.press("ControlOrMeta+Alt+Shift+KeyW")
  check("⌥⇧⌘W closes the focused pane too", await until(async () => same(await files(), [a])), await panes())

  // The window's only pane: nothing to close it with.
  // (the pinned tab goes too: shown, unpinned, closed)
  await command(page, "Go to next tab"); await until(async () => same(await files(), [c]))
  await command(page, "Unpin tab"); await command(page, "Close current tab"); await until(async () => (await tabs()).length === 1)
  check("the only pane: no Close pane in the palette", !(await command(page, "Close pane")))
  check("…nor an X", (await page.locator("[data-pane-close]").count()) === 0)
  await command(page, "Pin tab"); await command(page, "Close current tab"); await wait(300)
  check("…and a pinned tab alone stays", same(await files(), [a]) && same(await tabs(), ["*>"]), await tabs())
  await command(page, "Unpin tab")

  // Pane titles on: the X beside each title row's handle. (c closed last, then b's pane: both back)
  await command(page, "Reopen closed tab"); await command(page, "Reopen closed tab"); await until(async () => (await panes()).length === 2)
  lookAs({ tabBar: false, paneTitles: true })
  check("with titles, each title row has the X", await until(async () => (await page.locator("[data-pane-title] ~ [data-pane-close]").count()) === 2, 8000))
  await page.locator("[data-pane-close]").last().click()
  check("…which closes its pane", await until(async () => (await panes()).length === 1), await panes())
} finally {
  await browser.close()
  if (was === null) rmSync(look, { force: true }); else writeFileSync(look, was)
}
await done()
