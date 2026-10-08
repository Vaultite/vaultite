// The desktop workspace's split tree: Split right / Split down from the command palette and the tab
// menu, dragging tabs (along a bar, onto another bar, onto each edge and the middle of a pane, with the drop overlay),
// drops that change nothing not offered, dividers (drag, double-click), panes closing up when emptied, the layout
// coming back after a reload (and the old two-group layout migrating), focus moving between panes from the keyboard,
// and a terminal tab moved between panes keeping its shell. WRITES (a terminal runs on the server's machine; tabs only
// open notes): throwaway server only.
//   node web/qa/splits.mjs <base url> <vault path> [out dir]
import { mkdirSync, readdirSync } from "node:fs"
import { qa, terminalText, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/splits-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const notes = readdirSync(`${VAULT}/Notes`).filter((f) => f.endsWith(".md")).sort().slice(0, 3)
if (notes.length < 3) { console.error("needs three notes in Notes/"); process.exit(2) }
const stem = (f) => f.replace(/\.md$/, "")
const fileHash = (f) => `#file/${encodeURIComponent(`Notes/${f}`)}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const shot = (name) => page.screenshot({ path: `${OUT}splits-${name}.png` })

/** Every pane: its group, box, tab labels, active tab, and whether it has the focus. */
const panes = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane]")].map((s) => {
  const r = s.getBoundingClientRect()
  return {
    id: s.dataset.group, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    tabs: [...s.querySelectorAll("[role=tab]")].map((t) => t.innerText.trim()),
    active: s.querySelector("[role=tab][aria-selected=true]")?.innerText.trim(),
    focused: !!s.querySelector("#main-scroll"),
  }
}).sort((a, b) => a.x - b.x || a.y - b.y))
const focusedPane = async () => (await panes()).find((p) => p.focused)
const cmd = async (name) => {
  await page.keyboard.press("ControlOrMeta+p"); await wait(250)
  await page.keyboard.type(name); await wait(250)
  await page.keyboard.press("Enter"); await wait(500)
}
const tab = (gid, label) => page.locator(`section[data-group="${gid}"] [data-tab-id]`, { has: page.locator("[role=tab]", { hasText: label }) }).first()
/** A point in a pane's body: a side's edge, or its middle. */
async function spot(gid, where) {
  const r = await page.locator(`[data-pane-body="${gid}"]`).boundingBox()
  const at = { left: [0.08, 0.5], right: [0.92, 0.5], top: [0.5, 0.08], bottom: [0.5, 0.92], center: [0.5, 0.5] }[where]
  return [r.x + r.width * at[0], r.y + r.height * at[1]]
}
/** Drag a tab to (x, y); before letting go, what's offered there (a zone, a line in a bar, or nothing). */
async function drag(from, [x, y], { drop = true, name } = {}) {
  const b = await from.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 8, b.y + b.height / 2 + 4, { steps: 2 })
  await page.mouse.move(x, y, { steps: 8 }); await wait(120)
  const offered = await page.evaluate(() => ({
    zone: document.querySelector("[data-drop-zone]")?.dataset.dropZone ?? null,
    line: !!document.querySelector("[data-drop-line]"),
  }))
  if (name) await shot(name)
  if (drop) await page.mouse.up(); else { await page.keyboard.press("Escape"); await page.mouse.up() }
  await wait(400)
  return offered
}
/** Point in a tab bar just before a tab (or after the last one). */
async function barSpot(gid, beforeLabel) {
  if (beforeLabel) { const b = await tab(gid, beforeLabel).boundingBox(); return [b.x + 6, b.y + b.height / 2] }
  const b = await page.locator(`section[data-group="${gid}"] [role=tablist] button[aria-label="New tab"]`).boundingBox()
  return [b.x + b.width + 20, b.y + b.height / 2]
}

// ---------- commands: split right, split down ----------
await page.goto(`${B}${fileHash(notes[0])}`); await wait(1500)
check("starts with one pane", (await panes()).length === 1, await panes())
await cmd("Split right")
let ps = await panes()
check("Split right: two panes side by side", ps.length === 2 && ps[0].y === ps[1].y && ps[1].x > ps[0].x, ps)
check("...the new one has the same file, and the focus", ps[1].tabs[0] === stem(notes[0]) && ps[1].focused, ps)
check("...halves", Math.abs(ps[0].w - ps[1].w) <= 2, ps.map((p) => p.w))
check("...the address follows", decodeURIComponent(new URL(page.url()).hash).includes(notes[0]))
await cmd("Split down")
ps = await panes()
const right = ps.filter((p) => p.x === ps[1].x)
check("Split down: the right pane stacked in two", ps.length === 3 && right.length === 2 && right[1].y > right[0].y, ps)
check("...the lower one focused", right[1].focused, ps)
await shot("three")
await cmd("Focus on the pane to the left")
check("Focus on the pane to the left", (await focusedPane())?.x === ps[0].x, await panes())
await cmd("Focus on the pane to the right")
check("Focus on the pane to the right", (await focusedPane())?.x === right[0].x)
await cmd("Focus on the pane below")
check("Focus on the pane below", (await focusedPane())?.y === right[1].y)

// ---------- dividers ----------
const vsep = page.locator("[role=separator][aria-label=\"Resize the split\"][aria-orientation=vertical]")
const hsep = page.locator("[role=separator][aria-label=\"Resize the split\"][aria-orientation=horizontal]")
check("one vertical and one horizontal divider", await vsep.count() === 1 && await hsep.count() === 1)
let s = await vsep.boundingBox()
await page.mouse.move(s.x + s.width / 2, 400); await page.mouse.down()
await page.mouse.move(s.x + s.width / 2 + 120, 400, { steps: 6 }); await page.mouse.up(); await wait(200)
let ps2 = await panes()
check("dragging the divider widens the left pane", Math.abs(ps2[0].w - (ps[0].w + 120)) <= 4, [ps[0].w, ps2[0].w])
check("...the stacked ones follow", ps2.filter((p) => p.x === ps2[0].x + ps2[0].w).length === 2 || ps2.filter((p) => p.x > ps2[0].x).every((p) => p.w === ps2[1].w), ps2)
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
await tab(ps[2].id, stem(notes[0])).locator("button[data-tab-close]").click({ force: true }); await wait(300)
ps2 = await panes()
check("closing the lower pane's last tab closes it", ps2.length === 2 && ps2[1].h === ps2[0].h, ps2)
check("...no horizontal divider left", await hsep.count() === 0)
await tab(ps2[1].id, stem(notes[0])).click({ button: "right" }); await wait(200)
const items = await page.locator("[role=menu] button").allInnerTexts()
check("tab menu has the split items", ["Split right", "Split down", "Move to new split right", "Move to new split down"].every((x) => items.includes(x)), items)
check("...Move to new split is off for a pane's only tab", await page.locator("[role=menu] button", { hasText: "Move to new split right" }).isDisabled())
await page.locator("[role=menu] button", { hasText: /^Close$/ }).click(); await wait(300)
ps = await panes()
// Full width: to the main area's right edge, the window's less an open right sidebar (--right-sidebar, App.tsx; the
// sandbox opens one: the Inbox, Links and Outline).
const mainRight = await page.evaluate(() => innerWidth - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--right-sidebar")) || 0))
check("closing the right pane leaves one, full width", ps.length === 1 && ps[0].x + ps[0].w >= mainRight - 2, { ps, mainRight })

// ---------- dragging tabs ----------
// One pane with three tabs.
await page.goto(`${B}${fileHash(notes[0])}`); await wait(800)
for (const n of notes.slice(1)) {
  await page.locator("[role=tablist] button[aria-label='New tab']").click(); await wait(200)
  await page.goto(`${B}${fileHash(n)}`); await wait(800)
}
ps = await panes()
const [A, Bn, C] = notes.map(stem)
check("three tabs in one pane", ps.length === 1 && ps[0].tabs.length === 3, ps)
const g0 = ps[0].id
// Reorder along the bar: the first tab after the last.
const order0 = ps[0].tabs
let o = await drag(tab(g0, order0[0]), await barSpot(g0, null), { name: "drag-bar" })
check("reorder: a line shows where it goes", o.line && !o.zone, o)
ps = await panes()
check("reorder: the first tab went last", ps[0].tabs.join("|") === [...order0.slice(1), order0[0]].join("|"), ps[0].tabs)
// Dropping a tab back where it is isn't offered.
o = await drag(tab(g0, ps[0].tabs[1]), await barSpot(g0, ps[0].tabs[1]))
check("no line where it already is", !o.line, o)
// Its own pane's middle: nothing to do.
o = await drag(tab(g0, A), await spot(g0, "center"))
check("own pane's middle isn't offered", !o.zone, o)
// Its own right edge: a new split on the right.
o = await drag(tab(g0, A), await spot(g0, "right"), { drop: false })
check("own right edge: the right half lights up", o.zone === "right", o)
check("Escape cancels the drag", (await panes()).length === 1)
await drag(tab(g0, A), await spot(g0, "right"))
ps = await panes()
check("drag to own right edge: split right with the tab", ps.length === 2 && ps[1].tabs.join() === A && !ps[0].tabs.includes(A) && ps[1].focused, ps)
const g1 = ps[1].id
// A pane's only tab onto its own edge: not offered.
o = await drag(tab(g1, A), await spot(g1, "left"))
check("only tab onto its own pane's edge isn't offered", !o.zone && (await panes()).length === 2, o)
// Onto another pane's bottom edge.
o = await drag(tab(g0, Bn), await spot(g1, "bottom"), { name: "drag-bottom" })
ps = await panes()
check("another pane's bottom edge: overlay then a stacked split", o.zone === "bottom" && ps.length === 3 && ps.some((p) => p.tabs.join() === Bn && p.y > 100), { o, ps })
await shot("after-bottom")
// Onto the top edge of the lower pane, from the left pane (its last tab: the left pane closes).
const lowerId = ps.find((p) => p.tabs.join() === Bn).id
o = await drag(tab(g0, C), await spot(lowerId, "top"))
ps = await panes()
check("top edge: a split above; the emptied left pane closes", o.zone === "top" && ps.length === 3 && ps.every((p) => p.x === ps[0].x) && ps.map((p) => p.tabs.join()).join("|") === [A, C, Bn].join("|"), { o, ps })
// Onto a pane's left edge.
const top = ps[0]
o = await drag(tab(lowerId, Bn), await spot(top.id, "left"))
ps = await panes()
const bp = ps.find((p) => p.tabs.join() === Bn), ap = ps.find((p) => p.id === top.id)
check("left edge: a split on its left", o.zone === "left" && ps.length === 3 && bp && ap && bp.y === ap.y && bp.x < ap.x && bp.w === ap.w, { o, ps })
// Onto a pane's middle: moves into it.
const into = ps.find((p) => p.tabs.join() === C)
o = await drag(tab(bp.id, Bn), await spot(into.id, "center"), { name: "drag-center" })
ps = await panes()
check("middle: the tab joins that pane (overlay over the whole pane)", o.zone === "center" && ps.length === 2 && ps.some((p) => p.tabs.join("|") === [C, Bn].join("|") && p.active === Bn && p.focused), { o, ps })
// Between tab bars: into another bar, before its first tab.
const withTwo = ps.find((p) => p.tabs.length === 2), other = ps.find((p) => p !== withTwo)
o = await drag(tab(withTwo.id, Bn), await barSpot(other.id, other.tabs[0]))
ps = await panes()
check("onto another bar: there, at that place", o.line && ps.some((p) => p.tabs.join("|") === [Bn, other.tabs[0]].join("|")), { o, ps })
await shot("after-bars")

// ---------- the old layout (a main group and a right split) migrates ----------
// (A device on a workspace takes its tabs: start with none, like a vault before workspaces, once this page's last change
// of tabs is saved, so it can't make workspace 1 again.)
await wait(1500)
for (const n of [1,2,3,4,5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" }); await wait(300); await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("vaultite.prefs") ?? "{}"); if (p.device) delete p.device.workspace; localStorage.setItem("vaultite.prefs", JSON.stringify(p)) })
await page.evaluate(([a, b]) => {
  const t = (id, to) => ({ id, to })
  localStorage.setItem("vaultite.tabs", JSON.stringify({ groups: [{ id: "g0", tabs: [t("x1", `file:Notes/${a}`)], active: "x1" }, { id: "g9", tabs: [t("x2", `file:Notes/${b}`)], active: "x2" }], focus: "g9", split: 0.3 }))
}, [notes[0], notes[1]])
// The address set without the app following it (it would change, and save, its tabs before the reload).
await page.evaluate((h) => history.replaceState(null, "", h), fileHash(notes[1])); await page.reload(); await wait(1500)
ps = await panes()
check("old two-group layout migrates", ps.length === 2 && ps[1].tabs.join() === Bn && ps[1].focused && Math.abs(ps[1].w / (ps[0].w + ps[1].w) - 0.3) < 0.02, ps)

// ---------- a terminal tab moves between panes and keeps its shell ----------
const sid = `qa${Date.now().toString(36)}`
// (A device on a workspace takes its tabs: start with none, like a vault before workspaces, once this page's last change
// of tabs is saved, so it can't make workspace 1 again.)
await wait(1500)
for (const n of [1,2,3,4,5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" }); await wait(300)
await page.goto(`${B}#view/terminal%2F${sid}`); await wait(300)
await page.evaluate(() => localStorage.removeItem("vaultite.tabs")); await page.reload(); await wait(1500)
const text = () => terminalText(page)
check("terminal drawn", await until(async () => (await page.locator(".xterm-screen").count()) > 0, 8000))
await until(async () => /%|\$|❯/.test(await text()), 6000)
await page.locator(".xterm").click()
await page.keyboard.type("echo pid-$$"); await page.keyboard.press("Enter")
await until(async () => /^pid-\d+\s*$/m.test(await text()), 8000)
const pid = (await text()).match(/^pid-(\d+)\s*$/m)?.[1]
check("terminal answers", !!pid, (await text()).slice(-200))
ps = await panes()
await page.locator(`section[data-group="${ps[0].id}"] [role=tablist] button[aria-label='New tab']`).click(); await wait(300)
await drag(tab(ps[0].id, "Terminal"), await spot(ps[0].id, "right"))
ps = await panes()
check("terminal tab moved into a new split", ps.length === 2 && ps[1].tabs.join() === "Terminal", ps)
check("...its output is still there", await until(async () => new RegExp(`^pid-${pid}\\s*$`, "m").test(await text()), 8000), (await text()).slice(-200))
await page.locator(".xterm").click()
await page.keyboard.type("echo again-$$"); await page.keyboard.press("Enter")
check("...and it's the same shell", await until(async () => new RegExp(`^again-${pid}\\s*$`, "m").test(await text()), 8000), (await text()).slice(-200))
await drag(tab(ps[1].id, "Terminal"), await barSpot(ps[0].id, null))
ps = await panes()
check("terminal tab moved back onto the other bar", ps.length === 1 && ps[0].tabs.includes("Terminal"), ps)
await page.locator("[role=tab]", { hasText: "Terminal" }).click(); await wait(300)
await page.locator(".xterm").click()
await page.keyboard.type("echo still-$$"); await page.keyboard.press("Enter")
check("...still the same shell", await until(async () => new RegExp(`^still-${pid}\\s*$`, "m").test(await text()), 8000), (await text()).slice(-200))
await cmd("Split right")
ps = await panes()
check("Split right on a terminal: a blank tab beside it, not a second terminal", ps.length === 2 && ps[1].tabs.join() === "New tab", ps)
await shot("terminal")
// Closing its tab ends it (the tab menu's Close).
await tab(ps[0].id, "Terminal").click({ button: "right" }); await wait(200)
await page.locator("[role=menu] button", { hasText: /^Close$/ }).click(); await wait(800)

await ctx.close()
await done()
