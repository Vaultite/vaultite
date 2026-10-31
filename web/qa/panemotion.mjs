// Panes moving (core/panemotion.ts): a split grows in, a closed pane collapses, panes zoom and float (moved, resized,
// kept over a reload) and dock back, without remounting. WRITES: throwaway server only.
//   node web/qa/panemotion.mjs <base url> <vault path> [out dir]
import { mkdirSync, readdirSync } from "node:fs"
import { command, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/panemotion-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const note = readdirSync(`${VAULT}/Notes`).filter((f) => f.endsWith(".md")).sort()[0]

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const cdp = await ctx.newCDPSession(page)
await cdp.send("Animation.enable")
const slow = (rate) => cdp.send("Animation.setPlaybackRate", { playbackRate: rate })
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` })
const still = () => page.waitForFunction(() => !document.getAnimations().some((a) => a.id === "pane-motion"), null, { timeout: 10000 })
/** Every pane: its group, its box on screen (with its move's transform) and whether it floats or is zoomed. */
const panes = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane]")].map((s) => {
  const r = s.getBoundingClientRect()
  return { id: s.dataset.group, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), float: "floating" in s.dataset, zoomed: "zoomed" in s.dataset,
    clip: s.getAnimations().length ? getComputedStyle(s).clipPath : "", opacity: Number(getComputedStyle(s).opacity) }
}))
const ws = () => page.evaluate(() => JSON.parse(localStorage.getItem("vaultite.tabs")))
const box = () => page.evaluate(() => { const r = document.querySelector("section[aria-label=Pane]").parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
// What remounting would lose: a mark on each pane's body element.
const mark = () => page.evaluate(() => { for (const b of document.querySelectorAll("[data-pane-body]")) b.qaMark = b.dataset.paneBody })
const marked = () => page.evaluate(() => [...document.querySelectorAll("[data-pane-body]")].every((b) => b.qaMark === b.dataset.paneBody))

await page.goto(`${B}#file/${encodeURIComponent(`Notes/${note}`)}`)
await page.waitForSelector("section[aria-label=Pane] [data-tab-id]", { timeout: 30000 })
await wait(800)
const W = await box()

// A split pops in at its place while the pane it splits springs narrower; nothing reflows per frame.
await slow(0.1)
await command(page, "Split right", 0)
await wait(450)
const mid = await panes()
await shot("split-mid")
check("split: mid-move the new pane pops in at its place (a little small and clear), the old one springing narrower", mid.length === 2
  && mid[1].opacity < 0.95 && mid[1].w < W.w / 2 - 4 && mid[1].x > W.x + W.w / 2 && /inset/.test(mid[0].clip), mid)
await slow(1); await still()
const after = await panes()
const left = after[0]?.id
check("split: then two halves", after.length === 2 && Math.abs(after[0].w - after[1].w) < 12 && after[1].x > after[0].x, after)
await mark()

// Zoom: the focused (new, right) pane fills the workspace, a badge says so and unzooms.
await command(page, "Zoom pane"); await still()
let ps = await panes(), z = ps.find((p) => p.zoomed)
check("zoom: the focused pane fills the workspace, the other still drawn under it", !!z && Math.abs(z.w - W.w) < 2 && Math.abs(z.x - W.x) < 2 && ps.length === 2 && (await ws()).zoom === z.id, ps)
check("zoom: its bar shows it, the others are out of reach", await page.locator(`section[data-group="${z?.id}"] [data-pane-unzoom]`).isVisible()
  && await page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane]:not([data-zoomed])")].every((s) => s.inert)))
await shot("zoomed")
await page.locator("[data-pane-unzoom]").click(); await still()
ps = await panes()
check("zoom: the badge's click puts it back", !ps.some((p) => p.zoomed) && Math.abs(ps[0].w - ps[1].w) < 12 && !(await ws()).zoom, ps)
// Interrupted: zoomed and back again mid-move, each move starting where the last one was.
for (let i = 0; i < 5; i++) { await page.keyboard.press("ControlOrMeta+Shift+Enter"); await wait(60) }
const midway = await panes()
await still()
ps = await panes()
check("zoom: ⌘⇧↩ zooms; pressed again mid-move it turns back from where it is, and settles", ps.some((p) => p.zoomed) && Math.abs(ps.find((p) => p.zoomed).w - W.w) < 2
  && midway.some((p) => p.zoomed && p.clip) && !(await page.locator("[data-moving]").count()), [midway, ps])
await page.locator("section[aria-label=Pane]:not([data-zoomed])").first().evaluate((s) => s.inert = false)
await page.evaluate(() => document.querySelector("section[aria-label=Pane]:not([data-zoomed]) [data-pane-body]").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })))
await still()
check("zoom: another pane focused, it's back", !(await panes()).some((p) => p.zoomed) && !(await ws()).zoom)

// Float: the focused pane lifts into a card over the workspace; the other fills the gap.
await command(page, "Float pane"); await still()
ps = await panes()
const card = ps.find((p) => p.float), tiled = ps.find((p) => !p.float)
check("float: a card inside the workspace, the other pane full width", !!card && card.w < W.w * 0.7 && card.x >= W.x && card.x + card.w <= W.x + W.w + 1 && Math.abs(tiled.w - W.w) < 2, ps)
check("float: nothing remounted", await marked())
await shot("floating")
// Moved by its bar's empty part, kept inside the workspace.
const bar = await page.locator(`section[data-group="${card.id}"] [data-tab-bar]`).boundingBox()
await page.mouse.move(bar.x + bar.width - 60, bar.y + bar.height / 2); await page.mouse.down()
await page.mouse.move(bar.x + bar.width - 160, bar.y + 140, { steps: 6 }); await page.mouse.move(bar.x - 2000, bar.y + 140, { steps: 6 }); await page.mouse.up()
let moved = (await panes()).find((p) => p.id === card.id)
check("float: dragged by its bar, it moves, stopping at the workspace's edge", Math.abs(moved.x - W.x) < 2 && moved.y > card.y + 100, moved)
// Resized by its right edge.
await page.mouse.move(moved.x + moved.w + 2, moved.y + moved.h / 2); await page.mouse.down()
await page.mouse.move(moved.x + moved.w + 122, moved.y + moved.h / 2, { steps: 5 }); await page.mouse.up()
const wider = (await panes()).find((p) => p.id === card.id)
check("float: its edge resizes it", Math.abs(wider.w - moved.w - 120) < 4 && wider.x === moved.x, [moved, wider])
// Kept over a reload.
await page.reload(); await page.waitForSelector("section[data-floating]", { timeout: 30000 }); await wait(500)
const back = (await panes()).find((p) => p.float)
check("float: kept over a reload", !!back && Math.abs(back.x - wider.x) < 2 && Math.abs(back.w - wider.w) < 2 && Math.abs(back.y - wider.y) < 2, [wider, back])
await mark()
// Docked by its button, back where it came from.
await page.locator(`section[data-group="${back.id}"] [data-pane-dock]`).click(); await still()
ps = await panes()
check("dock: back in its place, halves again, nothing remounted", !ps.some((p) => p.float) && ps.length === 2 && Math.abs(ps[0].w - ps[1].w) < 12
  && back.id === left && ps.find((p) => p.id === left).x < ps.find((p) => p.id !== left).x && await marked(), ps)

// ⌥⌘↩ floats it (centred on the right) and, unmoved, docks it back where it was.
const halves = await panes()
await page.keyboard.press("ControlOrMeta+Alt+Enter"); await still()
const right = (await panes()).find((p) => p.float)
await page.keyboard.press("ControlOrMeta+Alt+Enter"); await still()
check("float: ⌥⌘↩ floats it centred on the right; again, unmoved, it docks where it was", !!right && right.x + right.w / 2 > W.x + W.w / 2
  && JSON.stringify(await panes()) === JSON.stringify(halves), [right, halves, await panes()])

// Closing a pane: a still copy of it fades where it was while its neighbour takes the room.
await slow(0.1)
await command(page, "Close pane", 0)
await wait(500)
const gone = await page.evaluate(() => ({ copies: document.querySelectorAll("[data-pane-gone]").length, panes: document.querySelectorAll("section[aria-label=Pane]").length,
  frames: document.querySelectorAll("[data-pane-gone] iframe").length, ids: document.querySelectorAll("[data-pane-gone] [id]").length }))
await shot("closing-mid")
check("close: a copy of it fades out, a picture only (no ids, no frames), one pane left", gone.copies === 1 && gone.panes === 1 && !gone.frames && !gone.ids, gone)
await slow(1); await still(); await wait(100)
check("close: then gone, the other pane full width", !(await page.locator("[data-pane-gone]").count()) && Math.abs((await panes())[0].w - W.w) < 2)

// With animations off, a split is there at once.
await page.evaluate(() => fetch("/api/prefs", { method: "GET" }).catch(() => {}))
await page.evaluate(() => { document.documentElement.dataset.animation = "off" })
await page.emulateMedia({ reducedMotion: "reduce" })
await command(page, "Split right", 0)
check("reduced motion: a split moves nothing", await page.evaluate(() => !document.getAnimations().some((a) => a.id === "pane-motion")))
await done()
