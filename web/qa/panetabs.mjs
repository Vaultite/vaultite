// A split's panes with tabs of their own (core/layout.ts Pane.stack), as the user has the app: the tab bar, pane titles
// and rails off, panes as cards, file bars fading, the tabs in the sidebar. The Tabs panel lists each pane's tabs under
// the split's row while it's on screen (plugins/core/tabs PaneList): a click shows one, its X closes it, a drag moves it
// along its pane's list, into the other's or out to the list; a list's tab dragged onto a pane's list joins it; another
// tab shown, the row folds to its map with +n per cell. ⌘W closes the place shown, the pane's next showing. The place a
// pane shows dragged onto its own pane's edge splits off; the tab on screen too. With the tab bar on, every pane's strip
// of its tabs (components/Tabs.tsx PlaceStrip), one tab too: its +, a tab dropped on it. WRITES the vault's
// appearance.json (put back): throwaway server only.
//   node web/qa/panetabs.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/panetabs-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const notes = ["Notes", "Projects", "People"].flatMap((dir) => (existsSync(path.join(VAULT, dir)) ? readdirSync(path.join(VAULT, dir)) : []).filter((f) => f.endsWith(".md")).map((f) => `${dir}/${f}`)).slice(0, 6)
const [a, b, c, d, e, f6] = notes
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

  // The place a pane shows dragged from its list onto its own pane's edge: it splits off there, the pane showing its next.
  const own = (await shown()).ids[1]
  const edge = async (id, side) => { const r = await page.locator(`[data-pane-body="${id}"]`).boundingBox(); return side === "right" ? { x: r.x + r.width * 0.94, y: r.y + r.height / 2 } : mid(r) }
  /** What's offered with place `id`'s row held over (x, y), the drag then given up. */
  const offered = async (id, to) => {
    const r = mid(await rowBox(id))
    await page.mouse.move(r.x, r.y); await page.mouse.down()
    for (let k = 1; k <= 10; k++) { await page.mouse.move(r.x + ((to.x - r.x) * k) / 10, r.y + ((to.y - r.y) * k) / 10); await wait(30) }
    await wait(150)
    const zone = await page.evaluate(() => document.querySelector("[data-drop-zone]")?.dataset.dropZone ?? null)
    await page.keyboard.press("Escape"); await page.mouse.up(); await wait(300)
    return zone
  }
  check("the place a pane shows, held on its own pane's middle: nothing offered", (await offered(own[1], await edge(own[1], "center"))) === null)
  await drag(mid(await rowBox(own[1])), await edge(own[1], "right"))
  check("…dropped on its own pane's edge: a pane of its own there, its pane showing its next",
    await until(async () => same((await shown())?.panes, [`${A} ^${D}`, Bn, E]) && (await state()).focus === own[1], 3000), await state())
  check("…a pane with one place, held on its own edge: nothing offered", (await offered(own[0], await edge(own[0], "right"))) === null)
  // (back as it was)
  const back = await rowBox(own[0])
  await drag(mid(await rowBox(own[1])), { x: back.x + back.width / 2, y: back.y + back.height - 3 })
  check("…and back among the other's tabs", await until(async () => same((await shown())?.panes, [`${A} ^${D}`, `${Bn} ^${E}`]), 3000), await shown())

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

  // The tab bar on: each pane of the split has a strip of its own tabs, one or more, with its +.
  await page.locator(`[data-tabs-panel] [data-open-tab="${split}"]`).click(); await until(async () => (await state()).active === split)
  lookAs({ ...USER, tabBar: true })
  const strip = page.locator("[data-pane-area] > section:not([data-away]) [data-place-strip]")
  const chips = () => strip.evaluateAll((es) => es.map((e) => e.querySelectorAll("[data-place]").length).sort().join())
  check("with the tab bar, every pane of the split has a strip of its tabs, one tab too", await until(async () => (await strip.count()) === 2 && (await chips()) === "1,2", 8000), await chips())
  check("…each with its +", (await strip.locator("[data-place-new]").count()) === 2)
  await page.screenshot({ path: `${OUT}panetabs-strip.png` })
  const first = (await shown()).ids.find((x) => x.length > 1)[0]
  await strip.locator(`[data-place="${first}"]`).click()
  check("…a click on a chip shows it", await until(async () => (await state()).focus === first, 3000), await state())
  await strip.locator(`[data-place-close="${first}"]`).click({ force: true })
  check("…its X closes it, the strip staying with the pane's last", await until(async () => (await strip.count()) === 2 && (await chips()) === "1,1", 3000), await shown())
  await page.mouse.move(700, 500); await wait(300)
  await page.screenshot({ path: `${OUT}panetabs-strip-one.png`, clip: { x: 0, y: 0, width: 1280, height: 140 } })
  await command(page, "Reopen closed tab")
  check("…⌘⇧T brings it back among them", await until(async () => (await chips()) === "1,2" && (await state()).focus === first, 3000), await shown())
  // A strip's chip, the place its pane shows, dragged onto its own pane's edge: it splits off.
  const chipAt = mid(await strip.locator(`[data-place="${first}"]`).boundingBox()), panesBefore = (await shown()).panes.length
  await drag(chipAt, await edge(first, "right"))
  check("…its chip shown dragged onto its own pane's edge splits it off, with a strip of its own", await until(async () => (await shown()).panes.length === panesBefore + 1 && (await chips()) === "1,1,1" && (await state()).focus === first, 3000), await shown())
  // Its + opens a tab among the pane's own.
  const second = (await shown()).ids[1][0], tabsNow = (await state()).tabs.length
  await page.locator(`[data-place-new="${second}"]`).click()
  check("a strip's + opens a blank tab among its pane's, shown", await until(async () => (await shown())?.panes[1]?.endsWith("^new") && (await state()).tabs.length === tabsNow, 3000), await shown())
  await command(page, "Close current tab")
  check("…⌘W closes it again", await until(async () => (await chips()) === "1,1,1", 3000), await chips())
  // A tab of the list dropped on a pane's one-tab strip joins its tabs.
  await page.locator("[data-tab-strip] [data-ui='button:tab:new']").click(); await hash(f6)
  check("(a tab of the list's own)", await until(async () => (await state()).tabs.length === tabsNow + 1 && (await shown())?.panes.join() === short(f6), 5000), await state())
  const fresh = (await state()).active, at = (await state()).tabs.find((t) => t.id === split).ids[0][0]
  await page.locator(`[data-tab-strip] [data-tab-id="${split}"] [role=tab]`).first().click(); await until(async () => (await state()).active === split)
  const from = await page.locator(`[data-tab-strip] [data-tab-id="${fresh}"]`).boundingBox(), onto = await page.locator(`[data-place-strip="${at}"]`).boundingBox()
  await drag(mid(from), { x: onto.x + onto.width * 0.6, y: onto.y + onto.height / 2 })
  check("a list's tab dropped on a pane's one-tab strip joins its tabs", await until(async () => (await state()).tabs.length === tabsNow && (await chips()) === "1,1,2", 3000), [await chips(), await state()])

  // The tab on screen dragged from the Tabs panel onto its own pane's edge: a split of it and the tab shown before it.
  lookAs(USER)
  await until(async () => (await page.locator("[data-tabs-panel]").count()) === 1, 8000)
  const was = await shown(), lone = (await state()).tabs.find((t) => t.id !== split)
  await page.locator(`[data-tabs-panel] [data-open-tab="${lone.id}"]`).click(); await until(async () => (await state()).active === lone.id)
  await drag(mid(await page.locator(`[data-tabs-panel] [data-open-tab="${lone.id}"]`).boundingBox()), await edge(lone.ids[0][0], "right"))
  check("the tab on screen dragged from the panel onto its own pane's edge: beside the tab shown before it, which leaves the list",
    await until(async () => { const s = await state(); return s.tabs.length === 1 && s.active === lone.id && same((await shown()).panes, [...was.panes, ...lone.panes]) }, 3000), await state())
} finally {
  await browser.close()
  if (was === null) rmSync(look, { force: true }); else writeFileSync(look, was)
}
await done()
