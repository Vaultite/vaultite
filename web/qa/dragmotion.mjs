// Dragging tabs and panes moves like moving them (components/Tabs.tsx DragGhost, core/tabfold.ts, Workspace's DropZone):
// a pane of a split lifts out as a card of itself (a copy nothing else finds) while it recedes, springs back on Escape
// and lands where it's dropped (in another's middle: they swap); a tab lifts out of the tab bar leaving its slot open,
// pulled off it is a card with a copy of its pages, its slot showing it goes back there, and on a pane's edge its pane
// grows from the card; the drop zone shows the pane's outline beside it; a closed tab shrinks away and leaves nothing
// behind; with animations off, nothing lingers. Sets appearance.json's animation (then unsets it), opens tabs: throwaway server only.
//   node web/qa/dragmotion.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, command, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = "/tmp/dragmotion-shots/"], browser, check, watch, done } = await qa(import.meta.url, { motion: true })
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const look = await api("GET", "config/appearance")
await api("PATCH", "config/appearance", { animation: null })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true }), ui = app(page)
const nextFrame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const cmd = async (name) => { await command(page, name, 0); await ui.idle() }
/** The panes on screen, left to right: each with what it shows. */
const ON = "[data-pane-area] > section[data-pane-frame]:not([data-away])"
const panes = () => page.$$eval(ON, (s) => s.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.paneFrame, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), name: e.getAttribute("aria-label") } })
  .sort((a, b) => a.x - b.x || a.y - b.y))
/** The tab bar's tabs, in order. */
const chips = () => page.$$eval("[data-tab-strip] [data-tab-id]", (c) => c.map((e) => e.dataset.tabId))
const file = (f) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)
const files = await fetch(`${B}api/state`).then((r) => r.json()).then((s) => s.files.files.filter((f) => f.path.endsWith(".md")).map((f) => f.path).slice(0, 4))
const name = (f) => f.split("/").pop().replace(/\.md$/, "")
await page.goto(`${B}#file/${encodeURIComponent(files[0])}`)
await page.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 30000 }); await ui.idle()
// (from one tab of one pane, whatever an earlier run left)
for (let i = 0; i < 16 && (await page.locator(ON).count()) > 1; i++) await cmd("Close pane")
await cmd("Close all other tabs")
// Two more tabs, then the first split in two: its right pane shows the second file.
for (const f of files.slice(2)) {
  const n = await chips().then((c) => c.length)
  await page.locator("[data-tab-strip] [aria-label='New tab']").click(); await until(async () => (await chips()).length > n, 3000)
  await file(f); await ui.idle()
}
const split = (await chips())[0]
await page.click(`[data-tab-strip] [data-tab-id="${split}"] [role=tab]`); await ui.idle()
await cmd("Split right")
await file(files[1])
await until(async () => (await panes()).at(-1)?.name === name(files[1]), 3000)
await ui.idle()
let [left, right] = await panes()
check("set up: a split tab of two panes, two more tabs to drag", left && right && (await chips()).length === 3, { panes: await panes(), chips: await chips() })
const box = (sel) => page.locator(sel).first().boundingBox()
const ghost = () => page.evaluate(() => {
  const g = document.querySelector("[data-drag-ghost]")
  return g && { look: g.dataset.dragLook, shape: g.dataset.dragShape ?? null, w: g.firstElementChild.getBoundingClientRect().width,
    copy: [...g.querySelectorAll("div")].some((d) => d.shadowRoot?.querySelector("[data-pane-body]")),
    tabCopy: [...g.querySelectorAll("div")].some((d) => d.shadowRoot?.querySelector("[data-tab-body], .file-view")) }
})
const grip = async (id) => { await page.hover(`[data-pane-bar="${id}"]`); return box(`[data-pane-handle="${id}"]`) }

// ---------- a pane by its handle ----------
let h = await grip(right.id)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(h.x - 30, h.y + 40, { steps: 4 }); await ui.idle()
let g = await ghost()
check("pane lifted: a card of itself, a copy of the pane in it", g?.look === "pane" && g.copy && g.w < 360, g)
// (the page's own queries: Playwright's selectors go into shadow roots)
const found = (sel) => page.evaluate((sel) => document.querySelectorAll(sel).length, sel)
check("...the copy isn't found by the page's queries", await found(`section[data-pane-frame="${right.id}"]`) === 1)
check("...the pane recedes where it was", await page.$eval(`section[data-pane-frame="${right.id}"]`, (s) => s.hasAttribute("data-lifted") && getComputedStyle(s).opacity < 1))
const lb = await box(`[data-pane-body="${left.id}"]`)
await page.mouse.move(lb.x + lb.width * 0.06, lb.y + lb.height / 2, { steps: 10 }); await ui.idle()
const zone = await page.evaluate(() => {
  const z = document.querySelector("[data-drop-zone]"), r = document.querySelector("[data-drop-rest]"), b = z?.parentElement.getBoundingClientRect()
  const at = (e) => { const x = e.getBoundingClientRect(); return { l: Math.round(x.left - b.left), r: Math.round(b.right - x.right), w: Math.round(x.width), o: getComputedStyle(e).opacity } }
  return z && r && { zone: z.dataset.dropZone, half: Math.round(b.width / 2), z: at(z), rest: at(r) }
})
check("over its left edge: the zone takes the left half, the pane's outline the right", zone?.zone === "left" && zone.z.l <= 6 && Math.abs(zone.z.w - zone.half) < 8 && zone.rest.r <= 6 && Math.abs(zone.rest.w - zone.half) < 8 && zone.rest.o === "1", zone)
await page.screenshot({ path: `${OUT}pane-over-edge.png` })
await page.keyboard.press("Escape"); await page.mouse.up(); await nextFrame()
check("Escape: the card springs back (still there a moment), the pane is back at once", (await ghost())?.look === "pane" && !(await found("section[data-lifted]")))
check("...then it's gone", await until(async () => !(await page.$("[data-drag-ghost]")), 2000))
check("...nothing moved", JSON.stringify(await panes()) === JSON.stringify([left, right]), await panes())

// Dropped on the left edge: it lands there, growing from its card.
h = await grip(right.id)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(lb.x + lb.width * 0.06, lb.y + lb.height / 2, { steps: 12 }); await ui.idle()
await page.mouse.up()
const landing = await until(() => page.$eval(`section[data-pane-frame="${right.id}"]`, (s) => s.getAnimations().length > 0), 500, 16)
check("dropped on the edge: it springs into its place", landing)
await ui.idle()
const after = await panes()
check("...and is there, the other beside it, nothing left of the drag", after[0]?.id === right.id && !(await found("[data-drag-ghost], section[data-lifted]"))
  && await page.$eval(`section[data-pane-frame="${right.id}"]`, (s) => !s.getAnimations().length && !s.style.transform), after)
;[right, left] = after

// ---------- a tab ----------
const [, t0, t1] = await chips()
const a = await box(`[data-tab-id="${t0}"]`), z = await box(`[data-tab-id="${t1}"]`)
await page.mouse.move(a.x + 20, a.y + a.height / 2); await page.mouse.down()
await page.mouse.move(a.x + 26, a.y + a.height / 2 + 2, { steps: 2 })
await page.mouse.move(z.x + z.width - 8, z.y + z.height / 2, { steps: 8 }); await ui.idle()
g = await ghost()
const hole = await page.$eval(`[data-tab-id="${t0}"]`, (e) => ({ hidden: getComputedStyle(e.querySelector("[role=tab]")).visibility === "hidden", moved: !!e.style.transform }))
check("tab lifted: drawn as the tab, as wide", g?.look === "tab" && Math.abs(g.w - Math.min(a.width, 240) * 1.03) < 3, { g, w: a.width })
check("...its slot left open where it would land", hole.hidden && hole.moved, hole)
const ob = await box(`[data-pane-body="${left.id}"]`)
await page.mouse.move(ob.x + ob.width * 0.94, ob.y + ob.height / 2, { steps: 10 }); await ui.idle()
g = await ghost()
check("pulled off the bar over a pane: a card of itself, a copy of its page in it", g?.shape === "card" && g.tabCopy && g.w > 200, g)
const slot = await page.$eval(`[data-tab-id="${t0}"]`, (e) => ({ glyph: !!e.querySelector("[data-tab-return]"), faded: getComputedStyle(e.querySelector("[role=tab]")).opacity < 1 }))
check("...its slot faded, showing it goes back there", slot.glyph && slot.faded, slot)
await page.screenshot({ path: `${OUT}tab-page.png` })
await page.mouse.move(z.x + z.width - 8, z.y + z.height / 2, { steps: 10 }); await ui.idle()
await page.mouse.up(); await ui.idle()
check("dropped after the next tab: they've swapped, nothing left of the drag", JSON.stringify((await chips()).slice(1, 3)) === JSON.stringify([t1, t0]) && !(await page.$("[data-drag-ghost]")), await chips())

// ---------- closing a tab ----------
const n = (await chips()).length
await page.hover(`[data-tab-id="${t0}"]`)
await page.click(`[data-tab-id="${t0}"] [data-tab-close]`)
await nextFrame()
const going = await page.$$eval("[data-tab-strip] [inert]", (e) => e.length)
check("closed: the tab shrinks away where it was", going === 1 && (await chips()).length === n - 1, { going })
await ui.idle()
check("...and leaves nothing behind", !(await page.$("[data-tab-strip] [inert]")))

// ---------- a pane into another's middle: they swap, the one dropped growing from its card ----------
h = await grip(left.id)
const rb = await box(`[data-pane-body="${right.id}"]`)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 }); await ui.idle()
await page.mouse.up()
const swapping = await until(() => page.$eval(`section[data-pane-frame="${left.id}"]`, (s) => s.getAnimations().length > 0), 500, 16)
check("a pane dropped in another's middle: it springs from its card", swapping)
await ui.idle()
check("...they've swapped, nothing left of the drag", !(await found("[data-drag-ghost]")) && JSON.stringify((await panes()).map((p) => p.id)) === JSON.stringify([left.id, right.id]), await panes())
;[left, right] = await panes()

// ---------- a tab onto a pane's edge: its pane grows from its card ----------
const [, k0] = await chips()
const k0pane = await page.evaluate((id) => JSON.parse(localStorage.getItem("vaultite.tabs")).tabs.find((t) => t.id === id)?.focus, k0)
const kb = await box(`[data-tab-id="${k0}"]`), pb = await box(`[data-pane-body="${right.id}"]`)
await page.mouse.move(kb.x + 20, kb.y + kb.height / 2); await page.mouse.down()
await page.mouse.move(pb.x + pb.width * 0.95, pb.y + pb.height / 2, { steps: 12 }); await ui.idle()
await page.mouse.up()
const grows = await until(() => page.evaluate((id) => !!document.querySelector(`section[data-pane-frame="${id}"]:not([data-away])`)?.getAnimations().length, k0pane), 500, 16)
check("a tab dropped on a pane's edge: its pane grows from its card", grows)
await ui.idle()
check("...three panes, its pane the right one, the tab gone into the split", (await panes()).length === 3 && (await panes()).at(-1)?.id === k0pane && !(await chips()).includes(k0), { panes: await panes(), chips: await chips() })
;[left, , right] = await panes()

// ---------- animations off ----------
await api("PATCH", "config/appearance", { animation: "off" })
await until(() => page.evaluate(() => document.documentElement.dataset.animation === "off"), 3000)
// (a file open nowhere else: one open already would be shown where it is)
await page.locator("[data-tab-strip] [aria-label='New tab']").click(); await ui.idle()
await file(files[2]); await ui.idle()
const c0 = (await chips()).at(-1)
check("set up: a new tab to close", c0 !== split, await chips())
await page.hover(`[data-tab-id="${c0}"]`)
await page.click(`[data-tab-id="${c0}"] [data-tab-close]`); await nextFrame()
check("animations off: a closed tab just goes", !(await page.$("[data-tab-strip] [inert]")))
await page.click(`[data-tab-strip] [data-tab-id="${split}"] [role=tab]`); await ui.idle()
h = await grip(right.id)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(h.x - 200, h.y + 200, { steps: 6 }); await ui.idle()
await page.keyboard.press("Escape"); await page.mouse.up(); await nextFrame()
check("...and a pane let go nowhere is back at once", !(await found("[data-drag-ghost], section[data-lifted]")))

await api("PATCH", "config/appearance", { animation: look.animation ?? null })
await done()
