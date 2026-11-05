// The desktop's split tabs: splitting, tabs dragged onto the tab bar and onto panes' edges and middles, panes dragged
// between and out of tabs, dividers, a closed pane closing the tree up, the layout after a reload (the old one
// migrating), keyboard focus between panes. WRITES the vault's appearance.json (put back): throwaway server only.
//   node web/qa/splits.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { openPalette, PROMPT, qa, terminalText, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/splits-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const notes = readdirSync(`${VAULT}/Notes`).filter((f) => f.endsWith(".md")).sort().slice(0, 3)
if (notes.length < 3) { console.error("needs three notes in Notes/"); process.exit(2) }
const stem = (f) => f.replace(/\.md$/, "")
const fileHash = (f) => `#file/${encodeURIComponent(`Notes/${f}`)}`
// (the tab bar on, pane titles off: the window's one bar of tabs, a thin strip on each pane of a split)
const look = `${VAULT}/.vaultite/appearance.json`, was = existsSync(look) ? readFileSync(look, "utf8") : null
writeFileSync(look, JSON.stringify({ ...JSON.parse(was ?? "{}"), tabBar: true, paneTitles: false }) + "\n")

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const shot = (name) => page.screenshot({ path: `${OUT}splits-${name}.png` })
const ON = "[data-pane-area] > section[data-pane-frame]:not([data-away])"

/** The panes on screen, once they're still (core/panemotion.ts): id, box, what each shows, whether it has the focus. */
const panes = () => page.waitForFunction(() => !document.getAnimations().some((a) => a.id === "pane-motion")).then(() => page.evaluate((on) => [...document.querySelectorAll(on)].map((s) => {
  const r = s.getBoundingClientRect()
  return { id: s.dataset.paneFrame, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), label: s.getAttribute("aria-label"), focused: !!s.querySelector("#main-scroll") }
}).sort((a, b) => a.x - b.x || a.y - b.y), ON))
const focusedPane = async () => (await panes()).find((p) => p.focused)
/** The tab bar's chips: each one's id, its panes' labels (a split's halves) and whether it's on screen. */
const chips = () => page.evaluate(() => [...document.querySelectorAll("[data-tab-strip] [data-tab-id]")].map((c) => {
  const halves = [...c.querySelectorAll("[data-pane-half]")].map((h) => h.innerText.trim())
  return { id: c.dataset.tabId, panes: halves.length ? halves : [c.querySelector("[role=tab]").innerText.trim()], on: c.querySelector("[role=tab]").getAttribute("aria-selected") === "true" }
}))
const cmd = async (name) => {
  await openPalette(page); await wait(250)
  await page.keyboard.type(name); await wait(250)
  await page.keyboard.press("Enter"); await wait(500)
}
const chip = (label) => page.locator("[data-tab-strip] [data-tab-id]", { has: page.locator("[role=tab]", { hasText: label }) }).first()
/** A pane's handle, shown once the pointer is on its bar. */
const handle = async (id) => { await page.hover(`[data-pane-bar="${id}"]`); await wait(150); return page.locator(`[data-pane-handle="${id}"]`) }
/** A point in a pane's body: a side's edge, or its middle. */
async function spot(id, where) {
  const r = await page.locator(`[data-pane-body="${id}"]`).boundingBox()
  const at = { left: [0.08, 0.5], right: [0.92, 0.5], top: [0.5, 0.08], bottom: [0.5, 0.92], center: [0.5, 0.5] }[where]
  return [r.x + r.width * at[0], r.y + r.height * at[1]]
}
/** Drag a chip or handle to (x, y); before letting go, what's offered there (a zone, the bar making way, or nothing). */
async function drag(from, [x, y], { drop = true, name } = {}) {
  const b = await from.boundingBox()
  const lefts = () => page.$$eval("[data-tab-strip] [data-tab-id]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
  const before = await lefts()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 8, b.y + b.height / 2 + 4, { steps: 2 })
  await page.mouse.move(x, y, { steps: 8 }); await wait(120)
  const offered = await page.evaluate(() => ({
    zone: document.querySelector("[data-drop-zone]")?.dataset.dropZone ?? null,
    line: !!document.querySelector("[data-drop-preview]"),
  }))
  // (the tabs that moved to make way, the dragged one aside: it follows the pointer)
  const now = await lefts(), lifted = before.indexOf(Math.round(b.x))
  offered.moved = now.some((x, i) => i !== lifted && Math.abs(x - before[i]) > 1)
  if (name) await shot(name)
  if (drop) await page.mouse.up(); else { await page.keyboard.press("Escape"); await page.mouse.up() }
  await wait(400)
  return offered
}
/** A point in the tab bar just inside a chip's left edge, or past the last one. */
async function barSpot(label) {
  if (label) { const b = await chip(label).boundingBox(); return [b.x + 6, b.y + b.height / 2] }
  const b = await page.locator("[data-tab-strip] button[aria-label='New tab']").boundingBox()
  return [b.x + b.width + 20, b.y + b.height / 2]
}

try {
  // ---------- commands: split right, split down ----------
  await page.goto(`${B}${fileHash(notes[0])}`); await wait(1500)
  check("starts with one pane", (await panes()).length === 1, await panes())
  await cmd("Split right")
  let ps = await panes()
  check("Split right: two panes side by side", ps.length === 2 && ps[0].y === ps[1].y && ps[1].x > ps[0].x, ps)
  check("...the new one has the same file, and the focus", ps[1].label === stem(notes[0]) && ps[1].focused, ps)
  check("...halves", Math.abs(ps[0].w - ps[1].w) <= 2, ps.map((p) => p.w))
  check("...one tab, its chip both panes", (await chips()).length === 1 && (await chips())[0].panes.length === 2, await chips())
  check("...the address follows", decodeURIComponent(new URL(page.url()).hash).includes(notes[0]))
  await cmd("Split down")
  ps = await panes()
  const right = ps.filter((p) => p.x === ps[1].x)
  check("Split down: the right pane stacked in two", ps.length === 3 && right.length === 2 && right[1].y > right[0].y, ps)
  check("...the lower one focused", right[1].focused, ps)
  await shot("three")
  await cmd("Focus pane to the left")
  check("Focus pane to the left", (await focusedPane())?.x === ps[0].x, await panes())
  await cmd("Focus pane to the right")
  check("Focus pane to the right", (await focusedPane())?.x === right[0].x)
  await cmd("Focus pane below")
  check("Focus pane below", (await focusedPane())?.y === right[1].y)

  // ---------- dividers ----------
  const vsep = page.locator("[role=separator][aria-label=\"Resize the split\"][aria-orientation=vertical]")
  const hsep = page.locator("[role=separator][aria-label=\"Resize the split\"][aria-orientation=horizontal]")
  check("one vertical and one horizontal divider", await vsep.count() === 1 && await hsep.count() === 1)
  let s = await vsep.boundingBox()
  await page.mouse.move(s.x + s.width / 2, 400); await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2 + 120, 400, { steps: 6 }); await page.mouse.up(); await wait(200)
  let ps2 = await panes()
  check("dragging the divider widens the left pane", Math.abs(ps2[0].w - (ps[0].w + 120)) <= 4, [ps[0].w, ps2[0].w])
  check("...the stacked ones follow", ps2.filter((p) => p.x > ps2[0].x).every((p) => p.w === ps2[1].w), ps2)
  s = await hsep.boundingBox()
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2, s.y - 150, { steps: 6 }); await page.mouse.up(); await wait(200)
  ps2 = await panes()
  const [upper, lower] = ps2.filter((p) => p.x > ps2[0].x)
  check("the horizontal divider resizes the stacked panes", lower.h - upper.h > 250, [upper.h, lower.h])
  await vsep.dblclick(); await wait(200)
  ps2 = await panes()
  check("double-click evens the split out", Math.abs(ps2[0].w - ps2[1].w) <= 2, ps2.map((p) => p.w))

  // ---------- reload keeps the layout ----------
  const before = JSON.stringify(await panes())
  await page.reload(); await wait(1500)
  check("reload restores the layout", JSON.stringify(await panes()) === before, [before, await panes()])

  // ---------- closing panes closes the tree up ----------
  ps = await panes()
  await handle(ps[2].id)
  await page.locator(`[data-pane-close="${ps[2].id}"]`).click({ force: true }); await wait(300)
  ps2 = await panes()
  check("closing the lower pane closes it up", ps2.length === 2 && ps2[1].h === ps2[0].h, ps2)
  check("...no horizontal divider left", await hsep.count() === 0)
  await chip(stem(notes[0])).locator("[role=tab]").click({ button: "right" }); await wait(200)
  const items = await page.locator("[role=menu] button").allInnerTexts()
  check("tab menu has the split items", ["Split right", "Split down", "Separate panes"].every((x) => items.some((i) => i.startsWith(x))), items)
  await page.keyboard.press("Escape"); await wait(200)
  await page.locator(`[data-pane-bar="${ps2[1].id}"]`).click({ button: "right", position: { x: 40, y: 4 } }); await wait(200)
  const pitems = await page.locator("[role=menu] button").allInnerTexts()
  check("a pane's bar has its menu", ["Move to new tab", "Close pane"].every((x) => pitems.some((i) => i.startsWith(x))), pitems)
  await page.locator("[role=menu] button", { hasText: /^Close pane/ }).click(); await wait(300)
  ps = await panes()
  // Full width: to the main area's right edge, the window's less an open right sidebar (--right-sidebar, core/room.ts).
  const mainRight = await page.evaluate(() => innerWidth - (parseFloat(getComputedStyle(document.querySelector(".vau-room") ?? document.documentElement).getPropertyValue("--right-sidebar")) || 0))
  check("closing the right pane leaves one, full width", ps.length === 1 && ps[0].x + ps[0].w >= mainRight - 2, { ps, mainRight })
  check("...and a tab of one pane has no bar of its own (its chip is its handle)", await page.locator(`${ON} [data-pane-bar]`).count() === 0)

  // ---------- dragging tabs and panes ----------
  // Three tabs.
  await page.goto(`${B}${fileHash(notes[0])}`); await wait(800)
  for (const n of notes.slice(1)) {
    await page.locator("[data-tab-strip] button[aria-label='New tab']").click(); await wait(200)
    await page.goto(`${B}${fileHash(n)}`); await wait(800)
  }
  const [A, Bn, C] = notes.map(stem)
  let cs = await chips()
  check("three tabs", cs.length === 3 && (await panes()).length === 1, cs)
  // Reorder along the bar: the first tab after the last.
  const order0 = cs.map((c) => c.panes[0])
  let o = await drag(chip(order0[0]), await barSpot(null), { name: "drag-bar" })
  check("reorder: the tabs make way where it goes", o.line && !o.zone, o)
  cs = await chips()
  check("reorder: the first tab went last", cs.map((c) => c.panes[0]).join("|") === [...order0.slice(1), order0[0]].join("|"), cs)
  // Dropping a tab back where it is isn't offered.
  o = await drag(chip(cs[1].panes[0]), await barSpot(cs[1].panes[0]))
  check("nothing makes way where it already is", !o.moved && !o.zone, o)
  // The tab on screen onto its own pane: nothing to do.
  await chip(A).locator("[role=tab]").click(); await wait(400)
  const pa = (await panes())[0]
  o = await drag(chip(A), await spot(pa.id, "center"))
  check("the tab on screen onto its own pane's middle isn't offered", !o.zone, o)
  o = await drag(chip(A), await spot(pa.id, "right"))
  check("...nor its own pane's edge", !o.zone && (await panes()).length === 1, o)
  // Another tab onto its right edge: a split of the two, the dropped one focused.
  o = await drag(chip(Bn), await spot(pa.id, "right"), { drop: false })
  check("another tab on the right edge: the right half lights up", o.zone === "right", o)
  check("Escape cancels the drag", (await panes()).length === 1 && (await chips()).length === 3)
  await drag(chip(Bn), await spot(pa.id, "right"))
  ps = await panes()
  check("dropped on the right edge: split right, one tab", ps.length === 2 && ps[1].label === Bn && ps[1].focused && (await chips()).length === 2, { ps, chips: await chips() })
  // The third onto the right pane's bottom edge.
  o = await drag(chip(C), await spot(ps[1].id, "bottom"), { name: "drag-bottom" })
  ps = await panes()
  const cPane = ps.find((p) => p.label === C), bPane = ps.find((p) => p.label === Bn)
  check("another pane's bottom edge: a stacked split", o.zone === "bottom" && ps.length === 3 && cPane?.x === bPane?.x && cPane.y > bPane.y && (await chips()).length === 1, { o, ps })
  await shot("after-bottom")
  // A pane by its handle onto the left pane's top edge: it moves there.
  const aPane = ps.find((p) => p.label === A)
  o = await drag(await handle(cPane.id), await spot(aPane.id, "top"))
  ps = await panes()
  const c2 = ps.find((p) => p.label === C), a2 = ps.find((p) => p.label === A)
  check("a pane onto another's top edge: it moves above it", o.zone === "top" && ps.length === 3 && c2.x === a2.x && c2.y < a2.y, { o, ps })
  // A pane onto another's middle: they swap.
  const b2 = ps.find((p) => p.label === Bn)
  o = await drag(await handle(c2.id), await spot(b2.id, "center"), { name: "drag-center" })
  ps = await panes()
  check("a pane onto another's middle: they swap places", o.zone === "center" && ps.find((p) => p.label === C)?.x === b2.x && ps.find((p) => p.label === Bn)?.x === c2.x, { o, ps })
  // A pane onto the tab bar: a tab of its own.
  const cNow = ps.find((p) => p.label === C)
  o = await drag(await handle(cNow.id), await barSpot(null))
  cs = await chips()
  check("a pane onto the tab bar: a tab of its own", o.line && cs.length === 2 && cs.some((c) => c.panes.join() === C) && cs.some((c) => c.panes.length === 2), { o, cs })
  // That tab onto a split pane's middle: it's one of that pane's own tabs, shown, what was there behind it.
  await chip(A).locator("[role=tab]").click(); await wait(400)
  ps = await panes()
  o = await drag(chip(C), await spot(ps.find((p) => p.label === Bn).id, "center"))
  cs = await chips()
  check("a tab onto a split pane's middle joins that pane's tabs, shown there", o.zone === "center" && cs.length === 1 && [A, C].every((x) => cs[0].panes.includes(x)) && !cs[0].panes.includes(Bn), { o, cs })
  await shot("after-drags")

  // ---------- the old layout (a main group and a right split) migrates ----------
  // (start with no tabs, like a vault before workspaces, once this page's tabs are saved: it can't make workspace 1 again)
  await wait(1500)
  for (const n of [1,2,3,4,5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" }); await wait(300); await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("vaultite.prefs") ?? "{}"); if (p.device) delete p.device.workspace; localStorage.setItem("vaultite.prefs", JSON.stringify(p)) })
  await page.evaluate(([a, b]) => {
    const t = (id, to) => ({ id, to })
    localStorage.setItem("vaultite.tabs", JSON.stringify({ groups: [{ id: "g0", tabs: [t("x1", `file:Notes/${a}`)], active: "x1" }, { id: "g9", tabs: [t("x2", `file:Notes/${b}`)], active: "x2" }], focus: "g9", split: 0.3 }))
  }, [notes[0], notes[1]])
  // The address set without the app following it (it would change, and save, its tabs before the reload).
  await page.evaluate((h) => history.replaceState(null, "", h), fileHash(notes[1])); await page.reload(); await wait(1500)
  ps = await panes()
  check("old two-group layout migrates to one split tab", ps.length === 2 && ps[1].label === Bn && ps[1].focused && Math.abs(ps[1].w / (ps[0].w + ps[1].w) - 0.3) < 0.02 && (await chips()).length === 1, ps)

  // ---------- a terminal moves into a split and out again, keeping its shell ----------
  const sid = `qa${Date.now().toString(36)}`
  await wait(1500)
  for (const n of [1,2,3,4,5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" }); await wait(300)
  await page.goto(`${B}#view/terminal%2F${sid}`); await wait(300)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs")); await page.reload(); await wait(1500)
  const text = () => terminalText(page)
  check("terminal drawn", await until(async () => (await page.locator(".xterm-screen").count()) > 0, 8000))
  await until(async () => PROMPT.test(await text()), 6000)
  await page.locator(".xterm").click()
  await page.keyboard.type("echo pid-$$"); await page.keyboard.press("Enter")
  await until(async () => /^pid-\d+\s*$/m.test(await text()), 8000)
  const pid = (await text()).match(/^pid-(\d+)\s*$/m)?.[1]
  check("terminal answers", !!pid, (await text()).slice(-200))
  await page.locator("[data-tab-strip] button[aria-label='New tab']").click(); await wait(300)
  ps = await panes()
  await drag(chip("Terminal"), await spot(ps[0].id, "right"))
  ps = await panes()
  check("terminal tab dropped into a new split", ps.length === 2 && ps[1].label === "Terminal", ps)
  check("...its output is still there", await until(async () => new RegExp(`^pid-${pid}\\s*$`, "m").test(await text()), 8000), (await text()).slice(-200))
  await page.locator(".xterm").click()
  await page.keyboard.type("echo again-$$"); await page.keyboard.press("Enter")
  check("...and it's the same shell", await until(async () => new RegExp(`^again-${pid}\\s*$`, "m").test(await text()), 8000), (await text()).slice(-200))
  await drag(await handle(ps[1].id), await barSpot(null))
  cs = await chips()
  check("terminal pane dragged onto the bar: a tab of its own", cs.length === 2 && cs.some((c) => c.panes.join() === "Terminal" && c.on), cs)
  await page.locator(".xterm").click()
  await page.keyboard.type("echo still-$$"); await page.keyboard.press("Enter")
  check("...still the same shell", await until(async () => new RegExp(`^still-${pid}\\s*$`, "m").test(await text()), 8000), (await text()).slice(-200))
  await cmd("Split right")
  ps = await panes()
  check("Split right on a terminal: a blank pane beside it, not a second terminal", ps.length === 2 && ps[1].label === "New tab", ps)
  await shot("terminal")
  // Closing its tab ends it (the tab menu's Close).
  await chip("Terminal").locator("[role=tab]").click({ button: "right" }); await wait(200)
  await page.locator("[role=menu] button", { hasText: /^Close$/ }).click(); await wait(800)
} finally {
  await ctx.close()
  if (was === null) rmSync(look, { force: true }); else writeFileSync(look, was)
}
await done()
