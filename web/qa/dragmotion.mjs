// Dragging tabs and panes moves like moving them (components/Tabs.tsx DragGhost, core/tabfold.ts, Workspace's DropZone):
// a pane lifts out as a card of itself (a copy nothing else finds) while it recedes, springs back on Escape and lands
// where it's dropped; a tab lifts out of its bar leaving its slot open, pulled off it is a card with a copy of its page,
// its slot showing it goes back there, and on a pane's edge its new pane grows from the card; the drop zone shows the
// pane's outline beside it; a closed tab shrinks away and leaves nothing behind; with animations off,
// nothing lingers. Sets appearance.json's animation (then unsets it), opens tabs: throwaway server only.
//   node web/qa/dragmotion.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, command, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/dragmotion-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const look = await api("GET", "config/appearance")
await api("PATCH", "config/appearance", { animation: null })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const file = (f) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)
const files = await fetch(`${B}api/state`).then((r) => r.json()).then((s) => s.files.files.filter((f) => f.path.endsWith(".md")).map((f) => f.path).slice(0, 4))
await page.goto(`${B}#file/${encodeURIComponent(files[0])}`)
await page.waitForSelector("[data-tab-bar] [data-tab-id]", { timeout: 30000 }); await wait(800)
// (from one pane with one tab, whatever an earlier run left)
for (let i = 0; i < 16 && (await page.locator("section[data-group]").count()) > 1; i++) await command(page, "Close pane")
await command(page, "Close all other tabs"); await wait(300)
await palette(page, "Split right")
const inRight = () => page.locator("section[data-group]").last().locator("[data-tab-id]").count()
for (const [i, f] of files.slice(1).entries()) {
  if (i) { const n = await inRight(); await page.locator("[aria-label='New tab']").last().click(); await until(async () => (await inRight()) > n, 3000) }
  await file(f)
  await until(() => page.locator("section[data-group]").last().locator("[role=tab][aria-selected=true]").innerText().then((t) => t.trim() === f.split("/").pop().replace(/\.md$/, "")), 3000)
}
await wait(600)
const groups = () => page.$$eval("section[data-group]", (s) => s.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.group, x: Math.round(r.x), w: Math.round(r.width), tabs: e.querySelectorAll("[data-tab-id]").length } }).sort((a, b) => a.x - b.x))
let [left, right] = await groups()
check("set up: two panes, the right one with tabs to drag", left && right?.tabs >= 2, await groups())
const box = (sel) => page.locator(sel).first().boundingBox()
const ghost = () => page.evaluate(() => {
  const g = document.querySelector("[data-drag-ghost]")
  return g && { look: g.dataset.dragLook, shape: g.dataset.dragShape ?? null, w: g.firstElementChild.getBoundingClientRect().width,
    copy: [...g.querySelectorAll("div")].some((d) => d.shadowRoot?.querySelector("section[data-group]")),
    tabCopy: [...g.querySelectorAll("div")].some((d) => d.shadowRoot?.querySelector("[data-tab-body]")) }
})

// ---------- a pane by its handle ----------
await page.hover(`section[data-group="${right.id}"] [data-tab-bar]`)
let h = await box(`[data-pane-handle="${right.id}"]`)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(h.x - 30, h.y + 40, { steps: 4 }); await wait(500)
let g = await ghost()
check("pane lifted: a card of itself, a copy of the pane in it", g?.look === "pane" && g.copy && g.w < 360, g)
// (the page's own queries: Playwright's selectors go into shadow roots)
const found = (sel) => page.evaluate((sel) => document.querySelectorAll(sel).length, sel)
check("...the copy isn't found by the page's queries", await found(`section[data-group="${right.id}"]`) === 1)
check("...the pane recedes where it was", await page.$eval(`section[data-group="${right.id}"]`, (s) => s.hasAttribute("data-lifted") && getComputedStyle(s).opacity < 1))
const lb = await box(`[data-pane-body="${left.id}"]`)
await page.mouse.move(lb.x + lb.width * 0.06, lb.y + lb.height / 2, { steps: 10 }); await wait(700)
const zone = await page.evaluate(() => {
  const z = document.querySelector("[data-drop-zone]"), r = document.querySelector("[data-drop-rest]"), b = z?.parentElement.getBoundingClientRect()
  const at = (e) => { const x = e.getBoundingClientRect(); return { l: Math.round(x.left - b.left), r: Math.round(b.right - x.right), w: Math.round(x.width), o: getComputedStyle(e).opacity } }
  return z && r && { zone: z.dataset.dropZone, half: Math.round(b.width / 2), z: at(z), rest: at(r) }
})
check("over its left edge: the zone takes the left half, the pane's outline the right", zone?.zone === "left" && zone.z.l <= 6 && Math.abs(zone.z.w - zone.half) < 8 && zone.rest.r <= 6 && Math.abs(zone.rest.w - zone.half) < 8 && zone.rest.o === "1", zone)
await page.screenshot({ path: `${OUT}pane-over-edge.png` })
await page.keyboard.press("Escape"); await page.mouse.up(); await wait(60)
check("Escape: the card springs back (still there a moment), the pane is back at once", (await ghost())?.look === "pane" && !(await found("section[data-lifted]")))
check("...then it's gone", await until(async () => !(await page.$("[data-drag-ghost]")), 2000))
check("...nothing moved", JSON.stringify(await groups()) === JSON.stringify([left, right]), await groups())

// Dropped on the left edge: it lands there, growing from its card.
await page.hover(`section[data-group="${right.id}"] [data-tab-bar]`)
h = await box(`[data-pane-handle="${right.id}"]`)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(lb.x + lb.width * 0.06, lb.y + lb.height / 2, { steps: 12 }); await wait(300)
await page.mouse.up()
const landing = await until(() => page.$eval(`section[data-group="${right.id}"]`, (s) => s.getAnimations().length > 0), 500, 16)
check("dropped on the edge: it springs into its place", landing)
await wait(900)
const after = await groups()
check("...and is there, the other beside it, nothing left of the drag", after[0]?.id === right.id && !(await found("[data-drag-ghost], section[data-lifted]"))
  && await page.$eval(`section[data-group="${right.id}"]`, (s) => !s.getAnimations().length && !s.style.transform), after)
;[right, left] = after

// ---------- a tab ----------
const tabs = () => page.$$eval(`section[data-group="${right.id}"] [data-tab-id]`, (t) => t.map((e) => e.dataset.tabId))
const [t0, t1] = await tabs()
const a = await box(`[data-tab-id="${t0}"]`), z = await box(`[data-tab-id="${t1}"]`)
await page.mouse.move(a.x + 20, a.y + a.height / 2); await page.mouse.down()
await page.mouse.move(a.x + 26, a.y + a.height / 2 + 2, { steps: 2 })
await page.mouse.move(z.x + z.width - 8, z.y + z.height / 2, { steps: 8 }); await wait(500)
g = await ghost()
const hole = await page.$eval(`[data-tab-id="${t0}"]`, (e) => ({ hidden: getComputedStyle(e.querySelector("[role=tab]")).visibility === "hidden", moved: !!e.style.transform }))
check("tab lifted: drawn as the tab, as wide", g?.look === "tab" && Math.abs(g.w - Math.min(a.width, 240) * 1.03) < 3, { g, w: a.width })
check("...its slot left open where it would land", hole.hidden && hole.moved, hole)
const ob = await box(`[data-pane-body="${left.id}"]`)
await page.mouse.move(ob.x + ob.width * 0.94, ob.y + ob.height / 2, { steps: 10 }); await wait(700)
g = await ghost()
check("pulled off the bar over a pane: a card of itself, a copy of its page in it", g?.shape === "card" && g.tabCopy && g.w > 200, g)
const slot = await page.$eval(`[data-tab-id="${t0}"]`, (e) => ({ glyph: !!e.querySelector("[data-tab-return]"), faded: getComputedStyle(e.querySelector("[role=tab]")).opacity < 1 }))
check("...its slot faded, showing it goes back there", slot.glyph && slot.faded, slot)
await page.screenshot({ path: `${OUT}tab-page.png` })
await page.mouse.move(z.x + z.width - 8, z.y + z.height / 2, { steps: 10 }); await wait(300)
await page.mouse.up(); await wait(900)
check("dropped after the next tab: they've swapped, nothing left of the drag", JSON.stringify((await tabs()).slice(0, 2)) === JSON.stringify([t1, t0]) && !(await page.$("[data-drag-ghost]")), await tabs())

// ---------- closing a tab ----------
const n = (await tabs()).length
await page.hover(`[data-tab-id="${t0}"]`)
await page.click(`[data-tab-id="${t0}"] [data-tab-close]`)
await wait(40)
const going = await page.$$eval(`section[data-group="${right.id}"] [data-tab-bar] [inert]`, (e) => e.length)
check("closed: the tab shrinks away where it was", going === 1 && (await tabs()).length === n - 1, { going })
await wait(700)
check("...and leaves nothing behind", !(await page.$(`[data-tab-bar] [inert]`)))

// ---------- a pane into another's middle: its card goes into that pane ----------
await page.hover(`section[data-group="${left.id}"] [data-tab-bar]`)
h = await box(`[data-pane-handle="${left.id}"]`)
const rb = await box(`[data-pane-body="${right.id}"]`)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 }); await wait(300)
await page.mouse.up(); await wait(40)
check("a pane dropped in another's middle: its card goes into it", (await ghost())?.look === "pane")
check("...then it's gone, one pane left", await until(async () => !(await found("[data-drag-ghost]")) && (await groups()).length === 1, 2000), await groups())

// ---------- a tab onto its pane's edge: a new pane grows from its card ----------
const [only] = await groups(), [k0] = await page.$$eval(`section[data-group="${only.id}"] [data-tab-id]`, (t) => t.map((e) => e.dataset.tabId))
const kb = await box(`[data-tab-id="${k0}"]`), pb = await box(`[data-pane-body="${only.id}"]`)
await page.mouse.move(kb.x + 20, kb.y + kb.height / 2); await page.mouse.down()
await page.mouse.move(pb.x + pb.width * 0.95, pb.y + pb.height / 2, { steps: 12 }); await wait(400)
await page.mouse.up()
const grows = await until(() => page.evaluate((id) => { const s = [...document.querySelectorAll("section[data-group]")].find((x) => x.querySelector(`[data-tab-id="${id}"]`)); return !!s && s.getAnimations().length > 0 }, k0), 500, 16)
check("a tab dropped on its pane's edge: its new pane grows from its card", grows)
await wait(800)
check("...two panes, the tab in the right one", (await groups()).length === 2 && await page.$eval(`section[data-group="${(await groups())[1].id}"]`, (s, id) => !!s.querySelector(`[data-tab-id="${id}"]`), k0), await groups())
;[left, right] = await groups()

// ---------- animations off ----------
await api("PATCH", "config/appearance", { animation: "off" })
await until(() => page.evaluate(() => document.documentElement.dataset.animation === "off"), 3000)
const [c0] = await page.$$eval(`section[data-group="${left.id}"] [data-tab-id]`, (t) => t.map((e) => e.dataset.tabId))
await page.hover(`[data-tab-id="${c0}"]`)
await page.click(`[data-tab-id="${c0}"] [data-tab-close]`); await wait(40)
check("animations off: a closed tab just goes", !(await page.$(`[data-tab-bar] [inert]`)))
await page.hover(`section[data-group="${right.id}"] [data-tab-bar]`)
h = await box(`[data-pane-handle="${right.id}"]`)
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
await page.mouse.move(h.x - 200, h.y + 200, { steps: 6 }); await wait(200)
await page.keyboard.press("Escape"); await page.mouse.up(); await wait(60)
check("...and a pane let go nowhere is back at once", !(await found("[data-drag-ghost], section[data-lifted]")))

await api("PATCH", "config/appearance", { animation: look.animation ?? null })
await done()
