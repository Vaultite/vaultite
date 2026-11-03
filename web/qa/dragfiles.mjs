// Dragging from the sidebar with the tabs' drops (core/drag.ts): files and pinned pages onto panes, tab bars, pins.
// WRITES a "Qa drag" folder and pins: throwaway server only.
//   node web/qa/dragfiles.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/dragfiles-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
// The pinned list the sidebar shows: the current workspace's own (with Workspaces on there always is one, 02c5ae8; a
// new device is on the first, and a pin or unpin there makes its own list, 23d1a2c), else pages.json's, the default.
const pins = async () => {
  const own = (await api("GET", "workspaces")).workspaces?.[0]?.pinned
  return Array.isArray(own) ? own : (await api("GET", "config/pages")).pinned
}

await fetch(`${B}api/file?path=${encodeURIComponent("Qa drag")}`, { method: "DELETE" })
await api("POST", "folder", { path: "Qa drag" })
await api("POST", "folder", { path: "Qa drag/Sub" })
for (const n of ["One", "Two", "Three"]) await api("POST", "file", { path: `Qa drag/${n}.md`, text: `${n}.\n` })
const pinnedBefore = await pins()
const filesBefore = await api("GET", "config/files")
await api("PUT", "config/files", { ...filesBefore, fileSort: "name", autoReveal: false })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const shot = (name) => page.screenshot({ path: `${OUT}dragfiles-${name}.png` })

const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
const pinRow = (p) => page.locator(`aside nav[aria-label=Pages] [data-pin="${p}"]`).first()
/** The panes on screen: where each is and what it shows. */
const panes = () => page.evaluate(() => [...document.querySelectorAll("[data-pane-area] > section[data-pane-frame]:not([data-away])")].map((s) => {
  const r = s.getBoundingClientRect()
  return { id: s.dataset.paneFrame, x: Math.round(r.x), y: Math.round(r.y), shows: s.getAttribute("aria-label") }
}).sort((a, b) => a.x - b.x || a.y - b.y))
/** The tab bar's tabs, each its panes' names (a split's halves), and the one on screen. */
const tabs = () => page.evaluate(() => [...document.querySelectorAll("[data-tab-strip] [data-tab-id]")].map((c) => {
  const halves = [...c.querySelectorAll("[data-pane-half]")].map((h) => h.innerText.trim())
  return { id: c.dataset.tabId, panes: halves.length ? halves : [c.querySelector("[role=tab]").innerText.trim()], on: c.querySelector("[role=tab]").getAttribute("aria-selected") === "true" }
}))
async function spot(gid, where) {
  const r = await page.locator(`[data-pane-body="${gid}"]`).boundingBox()
  const at = { left: [0.08, 0.5], right: [0.92, 0.5], top: [0.5, 0.08], bottom: [0.5, 0.92], center: [0.5, 0.5] }[where]
  return [r.x + r.width * at[0], r.y + r.height * at[1]]
}
const barStart = async () => { const r = await page.locator("[data-tab-strip] [data-tab-id]").first().boundingBox(); return [r.x + 4, r.y + r.height / 2] }
const center = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return [b.x + Math.min(60, b.width / 2), b.y + b.height / 2] }
/** Drag `from` to (x, y); before letting go, what's offered (a pane zone, a bar or the pages making way, a highlighted folder, the ghost's hint). */
async function drag(from, [x, y], { drop = true, name } = {}) {
  const [fx, fy] = await center(from)
  await page.mouse.move(fx, fy); await page.mouse.down()
  await page.mouse.move(fx + 8, fy + 4, { steps: 2 })
  await page.mouse.move(x, y, { steps: 10 }); await wait(150)
  const offered = await page.evaluate(() => ({
    zone: document.querySelector("[data-drop-zone]")?.dataset.dropZone ?? null,
    line: !!document.querySelector("[data-drop-preview]"),
    pinWay: !!document.querySelector("aside [data-select-list=pins][data-drop-preview]"),
    pinGap: !!document.querySelector("aside [data-select-list=pins] > [data-slide=incoming]"),
    folder: [...document.querySelectorAll("aside .drop-target")].length,
    ghost: document.querySelector("[data-drag-ghost]")?.textContent ?? null,
    dim: !!document.querySelector("[data-drag-ghost].opacity-60"),
  }))
  if (name) await shot(name)
  if (drop) await page.mouse.up(); else { await page.keyboard.press("Escape"); await page.mouse.up() }
  await wait(500)
  return offered
}

await page.goto(`${B}#file/${encodeURIComponent("Qa drag/One.md")}`); await wait(1800)
// (Its folder opened as a user does: open folders are the workspace's, files:open, 02c5ae8.)
await row("Qa drag").click(); await row("Qa drag/Two.md").waitFor()
let ps = await panes()
check("starts with one pane showing One", ps.length === 1 && ps[0].shows === "One", ps)
const g0 = ps[0].id

// A file onto its pane's middle: opens there (where the pane was goes into its history).
let o = await drag(row("Qa drag/Two.md"), await spot(g0, "center"), { name: "tree-center" })
ps = await panes()
check("tree file over a pane's middle: the whole pane lights up", o.zone === "center" && o.ghost?.includes("Two"), o)
check("...dropped: it opens there", ps.length === 1 && ps[0].shows === "Two", ps)
check("...the drop didn't also open it by click in another tab", (await tabs()).length === 1, await tabs())
// Onto a pane already showing it: not offered.
o = await drag(row("Qa drag/Two.md"), await spot(g0, "center"))
check("the file its pane already shows isn't offered in the middle", o.zone === null && o.dim, o)

// Onto the right edge: a split with it.
o = await drag(row("Qa drag/Three.md"), await spot(g0, "right"), { name: "tree-right" })
ps = await panes()
check("tree file over a pane's right edge: the right half lights up", o.zone === "right", o)
check("...dropped: a split on the right with it", ps.length === 2 && ps[1].shows === "Three" && (await tabs()).length === 1, ps)
const g1 = ps[1].id

// Onto the tab bar: a tab at that place.
o = await drag(row("Qa drag/One.md"), await barStart())
let ts = await tabs()
check("tree file over the tab bar: the tabs make way where it goes", o.line, o)
check("...dropped: first tab there, on screen", ts[0].panes.join() === "One" && ts[0].on && ts.length === 2, ts)
// (back to the split)
await page.locator("[data-tab-strip] [data-tab-id][data-split] [role=tab]").click(); await wait(400)

// Onto the bottom edge of the right pane.
o = await drag(row("Qa drag/Two.md"), await spot(g1, "bottom"))
ps = await panes()
check("tree file onto the bottom edge: a stacked split", o.zone === "bottom" && ps.length === 3, { o, ps })

// Escape cancels.
const before = JSON.stringify(await panes())
o = await drag(row("Qa drag/Three.md"), await spot(g0, "left"), { drop: false })
check("Escape cancels a tree drag", o.zone === "left" && JSON.stringify(await panes()) === before, o)

// A folder opens its page there.
o = await drag(row("Qa drag/Sub"), await spot(g0, "center"))
ps = await panes()
check("a folder over a pane: its middle offered", o.zone === "center", o)
check("...dropped: its page in that pane", ps.find((p) => p.id === g0)?.shows === "Sub", ps)

// Within the tree it still moves.
o = await drag(row("Qa drag/Three.md"), await center(row("Qa drag/Sub")))
await wait(400)
check("tree file over a folder: the folder highlights", o.folder === 1 && !o.zone, o)
check("...dropped: moved into it", (await api("GET", "files")).files.some((f) => f.path === "Qa drag/Sub/Three.md"))

// Onto the pinned pages: pinned there.
const firstPin = (await pins())[0]
o = await drag(row("Qa drag/One.md"), await (async () => { const b = await pinRow(firstPin).boundingBox(); return [b.x + 40, b.y + 3] })(), { name: "tree-pin" })
await wait(300)
check("tree file over the pages: they make way, a gap where it goes", o.pinWay && o.pinGap, o)
check("...dropped: pinned first", (await pins())[0] === "Qa drag/One.md", await pins())

// A pinned page: reorder, onto a pane, out onto the tree.
const p = await pins()
o = await drag(pinRow(p[0]), await (async () => { const b = await pinRow(p[2]).boundingBox(); return [b.x + 40, b.y + b.height - 3] })())
await wait(300)
const p2 = await pins()
check("pinned page dragged down: the others make way, then it moves after the third", o.pinWay && !o.pinGap && p2.indexOf(p[0]) === 2, { o, p2 })
o = await drag(pinRow("Qa drag/One.md"), await spot(g0, "top"), { name: "pin-top" })
ps = await panes()
check("pinned page onto a pane's top edge: a split above with it", o.zone === "top" && ps.some((x) => x.shows === "One" && x.y < 200), { o, ps })
check("...still pinned", (await pins()).includes("Qa drag/One.md"))
o = await drag(pinRow("Qa drag/One.md"), await center(row("Qa drag/Two.md")), { name: "pin-out" })
await wait(300)
check("pinned page over the tree: 'Unpin' on it, the rest close up, no folder lit", o.ghost?.includes("Unpin") && o.pinWay && o.folder === 0, o)
check("...dropped: unpinned", !(await pins()).includes("Qa drag/One.md"), await pins())

// A tab onto the pages: pinned.
const lone = (await tabs()).find((x) => x.panes.join() === "One")
const tabLoc = page.locator(`[data-tab-strip] [data-tab-id="${lone.id}"]`)
o = await drag(tabLoc, await (async () => { const b = await pinRow((await pins())[0]).boundingBox(); return [b.x + 40, b.y + 3] })())
await wait(300)
check("a tab onto the pages: a gap opens, pinned", (await pins())[0] === "Qa drag/One.md" && o.pinGap, { o, pins: await pins() })
check("...and the tab stays where it was", (await tabs()).some((x) => x.id === lone.id))

// A plain click on a tree file still opens it.
await row("Qa drag/Sub/Three.md").click().catch(async () => { await row("Qa drag/Sub").locator("button").first().click(); await wait(200); await row("Qa drag/Sub/Three.md").click() })
await wait(400)
check("a click on a tree file still opens it", decodeURIComponent(await page.evaluate(() => location.hash)).includes("Qa drag/Sub/Three.md"))

await browser.close()
await api("PUT", "config/pages", { pinned: pinnedBefore })
await api("PUT", "config/files", filesBefore)
await fetch(`${B}api/file?path=${encodeURIComponent("Qa drag")}`, { method: "DELETE" })
await done()
