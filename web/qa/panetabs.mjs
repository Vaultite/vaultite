// A split's panes with tabs of their own (core/layout.ts Pane.stack), as the user has the app: the tab bar, pane titles
// and rails off, panes as cards, file bars fading, the tabs in the sidebar. The Tabs panel lists each pane's tabs under
// the split's row while it's on screen (plugins/core/tabs PaneList): a click shows one, its X closes it, a drag moves it
// along its pane's list, into the other's or out to the list; a list's tab dragged onto a pane's list joins it; another
// tab shown, the row folds to its map with +n per cell. ⌘W closes the place shown, the pane's next showing. With the tab
// bar on, a pane's strip of its tabs (components/Tabs.tsx PlaceStrip). WRITES the vault's appearance.json (put back):
// throwaway server only.
//   node web/qa/panetabs.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/panetabs-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const notes = ["Notes", "Projects", "People"].flatMap((dir) => (existsSync(path.join(VAULT, dir)) ? readdirSync(path.join(VAULT, dir)) : []).filter((f) => f.endsWith(".md")).map((f) => `${dir}/${f}`)).slice(0, 5)
const [a, b, c, d, e] = notes
const look = path.join(VAULT, ".vaultite", "appearance.json")
const was = existsSync(look) ? readFileSync(look, "utf8") : null
const lookAs = (o) => writeFileSync(look, JSON.stringify({ ...JSON.parse(was ?? "{}"), ...o }) + "\n")
const USER = { tabBar: false, paneTitles: false, rails: false, paneCards: true, fileBarFade: "always" }
lookAs(USER)
mkdirSync(OUT, { recursive: true })

try {
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
  await page.goto(`${B}/#new`)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs"))
  await page.reload()
  await page.waitForSelector("[data-pane-bar]", { state: "attached", timeout: 30000 })
  const hash = (f) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)
  /** The window's tabs as kept: each tab's panes, each pane its places (files) in order, the shown one starred. */
  const state = () => page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem("vaultite.tabs.workspace") ?? localStorage.getItem("vaultite.tabs"))
    const leaves = (n) => (n.kids ? n.kids.flatMap(leaves) : [n])
    const name = (p) => p.to.replace(/^file:[^/]+\//, "").replace(/\.md$/, "")
    const places = (p) => { const s = p.stack ?? [], at = Math.min(p.stackAt ?? 0, s.length); return [...s.slice(0, at), p, ...s.slice(at)] }
    return { active: w.active, focus: w.tabs.find((t) => t.id === w.active)?.focus,
      tabs: w.tabs.map((t) => ({ id: t.id, panes: leaves(t.root).map((p) => places(p).map((x) => (x.id === p.id && places(p).length > 1 ? "^" : "") + name(x)).join(" ")), ids: leaves(t.root).map((p) => places(p).map((x) => x.id)) })) }
  })
  const shown = async () => { const s = await state(); return s.tabs.find((t) => t.id === s.active) }
  const short = (f) => f.replace(/^[^/]+\//, "").replace(/\.md$/, "")
  const [A, Bn, C, D, E] = [a, b, c, d, e].map(short)
  const rows = page.locator("[data-tabs-panel] [data-place]")
  const lists = page.locator("[data-tabs-panel] [data-pane-places]")
  const drag = async (from, to, steps = 10) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    for (let k = 1; k <= steps; k++) { await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps); await wait(30) }
    await wait(150); await page.mouse.up(); await wait(400)
  }
  const mid = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

  // A split, a | b, and two tabs of their own in the list, d and e.
  await hash(a); await until(async () => (await shown())?.panes.join() === A)
  await command(page, "Close all other tabs")
  await command(page, "Split right"); await hash(b); await until(async () => (await shown())?.panes.join() === `${A},${Bn}`)
  const split = (await state()).active
  const panel = page.locator("[data-tabs-panel]")
  if (!(await panel.count())) await command(page, "Show tabs in the sidebar").catch(() => {})
  // (the list's New tab row: a tab of the list's own, where ⌘T in a split would open one of the pane's)
  const listTab = async (f) => { await page.locator("[data-tabs-panel] [data-new-tab-row]").click(); await hash(f); await until(async () => (await shown())?.panes.join() === short(f)) }
  await listTab(d); await listTab(e)
  const tabOf = async (n) => (await state()).tabs.find((t) => t.panes.join() === n)?.id
  const [tD, tE] = [await tabOf(D), await tabOf(E)]
  await page.locator(`[data-tabs-panel] [data-open-tab="${split}"]`).click(); await until(async () => (await state()).active === split)
  check("a split with one place a pane: no lists under its row", (await lists.count()) === 0)

  // ⌥-click a tab in the list: it's one of the focused pane's own (b's), what it showed behind it.
  await page.locator(`[data-tabs-panel] [data-open-tab="${tD}"]`).click({ modifiers: ["Alt"] })
  check("⌥-click a list tab: it's one of the focused pane's tabs, shown, the list without it",
    await until(async () => same((await shown())?.panes, [A, `${Bn} ^${D}`]) && (await state()).tabs.length === 2), await state())
  check("…and the split's row lists each pane's tabs under it", await until(async () => (await lists.count()) === 2 && (await rows.count()) === 3, 3000), await rows.count())
  const heads = await page.locator("[data-tabs-panel] [data-pane-heading]").allInnerTexts()
  check("…each list headed by where its pane sits", same(heads.map((t) => t.trim()), ["Left", "Right"]), heads)
  await page.screenshot({ path: `${OUT}panetabs-lists.png` })
  await page.locator("[data-tabs-panel]").screenshot({ path: `${OUT}panetabs-sidebar.png` })

  // A click on a place shows it in its pane.
  const ids = (await shown()).ids
  await page.locator(`[data-tabs-panel] [data-place="${ids[1][0]}"]`).click()
  check("a click on a pane's tab shows it there, focused", await until(async () => same((await shown())?.panes, [A, `^${Bn} ${D}`]) && (await state()).focus === ids[1][0]), await state())
  check("…on screen", await until(async () => (await page.locator(`section[data-pane-frame="${ids[1][0]}"]:not([data-away])`).count()) === 1, 3000))

  // Dragged along its list, a place moves (what's shown stays).
  const rowBox = async (id) => page.locator(`[data-tabs-panel] [data-place="${id}"]`).boundingBox()
  const r0 = await rowBox(ids[1][0]), r1 = await rowBox(ids[1][1])
  await drag(mid(r1), { x: r0.x + r0.width / 2, y: r0.y + 4 })
  check("a place dragged up its list moves before the other, b still shown", await until(async () => same((await shown())?.panes, [A, `${D} ^${Bn}`]), 3000), await shown())

  // Dragged onto the other pane's list: it's shown there.
  const la = await page.locator(`[data-tabs-panel] [data-place="${ids[0][0]}"]`).boundingBox(), rd = await rowBox(ids[1][1])
  await drag(mid(rd), { x: la.x + la.width / 2, y: la.y + la.height - 3 })
  check("a place dragged onto the other pane's list is shown there, its own pane showing its next",
    await until(async () => same((await shown())?.panes, [`${A} ^${D}`, Bn]), 3000), await shown())

  // A list tab dragged onto a pane's list joins it.
  const re = await page.locator(`[data-tabs-panel] [data-open-tab="${tE}"]`).boundingBox(), lb = await rowBox(ids[1][0])
  await drag(mid(re), { x: lb.x + lb.width / 2, y: lb.y + lb.height - 3 })
  check("a list tab dragged onto a pane's list joins it, shown", await until(async () => same((await shown())?.panes, [`${A} ^${D}`, `${Bn} ^${E}`]) && (await state()).tabs.length === 1, 3000), await state())

  // ⌘W: the place shown closes, the pane's next shows.
  await command(page, "Close current tab")
  check("Close current tab (⌘W) closes the place shown, its pane showing its next", await until(async () => same((await shown())?.panes, [`${A} ^${D}`, Bn]), 3000), await shown())
  await command(page, "Reopen closed tab")
  check("…⌘⇧T brings it back among them", await until(async () => same((await shown())?.panes, [`${A} ^${D}`, `${Bn} ^${E}`]), 3000), await shown())

  // A place's X closes it.
  const xi = (await shown()).ids[0][0]
  await page.locator(`[data-tabs-panel] [data-place="${xi}"]`).hover()
  const x = page.locator(`[data-tabs-panel] [data-place="${xi}"] button[aria-label^="Close"]`)
  await until(async () => (await x.evaluate((el) => +getComputedStyle(el).opacity)) > 0.5, 2000)
  await x.click()
  check("a place's X closes it alone", await until(async () => same((await shown())?.panes, [D, `${Bn} ^${E}`]), 3000), await shown())

  // Dragged out to the list: a tab of its own.
  const ps = (await shown()).ids[1], out = await rowBox(ps[0])
  const newRow = await page.locator("[data-tabs-panel] [data-new-tab-row]").boundingBox()
  await drag(mid(out), { x: newRow.x + 40, y: newRow.y + newRow.height / 2 })
  check("a place dragged out to the list is a tab of its own", await until(async () => (await state()).tabs.length === 2 && same((await state()).tabs[0].panes, [D, E]), 3000), await state())
  check("…the split's row folds back to its map, no pane having more", await until(async () => (await lists.count()) === 0, 3000))

  // ⌘T in a split; then folded while another tab shows: +n per cell.
  await page.locator(`[data-tabs-panel] [data-open-tab="${split}"]`).click(); await until(async () => (await state()).active === split)
  await command(page, "Open new tab")
  check("⌘T in a split opens a blank tab of the focused pane", await until(async () => (await shown())?.panes.some((p) => p.includes("^new")), 3000), await shown())
  await hash(c); await until(async () => (await shown())?.panes.some((p) => p.includes(`^${C}`)))
  const other = (await state()).tabs.find((t) => t.id !== split).id
  await page.locator(`[data-tabs-panel] [data-open-tab="${other}"]`).click(); await until(async () => (await state()).active === other)
  check("another tab shown: the split's row is its map, a cell saying +1", await until(async () => (await lists.count()) === 0 && (await page.locator("[data-tabs-panel] [data-cell-more]").allInnerTexts()).join() === "+1", 3000),
    await page.locator("[data-tabs-panel] [data-cell-more]").allInnerTexts())
  await page.locator("[data-tabs-panel]").screenshot({ path: `${OUT}panetabs-folded.png` })

  // The tab bar on: a pane with tabs of its own has a strip of them.
  await page.locator(`[data-tabs-panel] [data-open-tab="${split}"]`).click(); await until(async () => (await state()).active === split)
  lookAs({ ...USER, tabBar: true })
  const strip = page.locator("[data-pane-area] > section:not([data-away]) [data-place-strip]")
  check("with the tab bar, the pane with tabs of its own has a strip of them", await until(async () => (await strip.count()) === 1 && (await strip.locator("[data-place]").count()) === 2, 8000))
  await page.screenshot({ path: `${OUT}panetabs-strip.png` })
  const first = (await shown()).ids.find((x) => x.length > 1)[0]
  await strip.locator(`[data-place="${first}"]`).click()
  check("…a click on a chip shows it", await until(async () => (await state()).focus === first, 3000), await state())
  await strip.locator(`[data-place-close="${first}"]`).click({ force: true })
  check("…its X closes it, the strip going with the pane's last but one", await until(async () => (await strip.count()) === 0, 3000), await shown())
} finally {
  await browser.close()
  if (was === null) rmSync(look, { force: true }); else writeFileSync(look, was)
}
await done()
