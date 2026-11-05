// Sidebars beside a terminal: shown and hidden, no frame paints the terminal blank (a new size cleared WebGL's canvas a
// frame before xterm.js drew it again); a drag that shuts the right sidebar ends the resize (the line it began on goes
// mid-drag); a top bar item docked in a sidebar can be hidden. Runs a shell: throwaway server only.
// Writes sidebars.json and appearance.json (put back) and empties the workspaces.
//   node web/qa/sidebarpolish.mjs <base url> <vault>
import fs from "node:fs"
import path from "node:path"
import { PROMPT, qa, terminalText, until, wait, WEBGL } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url, { chrome: { args: WEBGL } })
const SIDEBARS = path.join(VAULT, ".vaultite/sidebars.json"), LOOK = path.join(VAULT, ".vaultite/appearance.json")
const kept = { sidebars: fs.existsSync(SIDEBARS) ? fs.readFileSync(SIDEBARS, "utf8") : null, look: fs.existsSync(LOOK) ? fs.readFileSync(LOOK, "utf8") : null }
const look = kept.look ? JSON.parse(kept.look) : {}
fs.writeFileSync(LOOK, JSON.stringify({ ...look, rails: false, paneCards: true, sidebar: true, rightSidebar: true, fileBarHidden: [] }, null, 2))
// (the sidebars as sidebars.json says: no workspace with a setup of its own)
for (const n of [1, 2, 3, 4, 5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
await fetch(new URL("/api/config/sidebars", B), { method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ left: ["search:search", "pages:pages", "tabs:tabs"], right: ["terminal:sessions", "properties:chips"], collapsed: [], heights: {} }) })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
// Frames painted with a terminal's canvas cleared and not drawn since: counted at the next frame's first callback.
await ctx.addInitScript(() => {
  const S = window.__blank = { on: false, dirty: new Set(), frames: 0 }
  let last = -1
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => raf((ts) => { if (ts !== last) { if (S.on && S.dirty.size) S.frames++; last = ts } return cb(ts) })
  const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")
  Object.defineProperty(HTMLCanvasElement.prototype, "width", { ...d, set(v) { d.set.call(this, v); if (this.__gl && this.closest?.("[data-terminal]")) S.dirty.add(this) } })
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (k, o) { const c = gc.call(this, k, o); if (c && /webgl/.test(k)) this.__gl = true; return c }
  for (const P of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype])
    for (const m of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const f = P[m]; if (f) P[m] = function (...a) { S.dirty.delete(this.canvas); return f.apply(this, a) }
    }
})
const page = watch(await ctx.newPage())
const sid = `qa${Date.now().toString(36)}p`
await page.goto(`${B}#view/terminal%2F${sid}`)
await until(async () => PROMPT.test(await terminalText(page)), 8000)
// (the setup written above, taken in: both sidebars there, cards and no rails)
check("set up: both sidebars, the right one with its panels", await until(() => page.evaluate(() => !!document.querySelector('aside[data-side=right] [data-panel="properties:chips"]') && "noRails" in document.documentElement.dataset), 8000))
const gl = await page.evaluate(() => [...document.querySelectorAll("[data-terminal] canvas")].some((c) => c.__gl))
const toggle = (label) => page.evaluate((l) => document.querySelector(`button[data-sidebar-toggle][aria-label="${l}"]`)?.click(), label)
const cols = () => page.evaluate(() => document.querySelector("[data-terminal] [data-term-screen]")?.getBoundingClientRect().width ?? 0)

if (!gl) console.log("  (no WebGL here: the blank-frame checks are skipped)")
for (const label of ["Hide left sidebar", "Show left sidebar", "Hide right sidebar", "Show right sidebar"]) {
  const before = await cols()
  await page.evaluate(() => { window.__blank.frames = 0; window.__blank.on = true })
  await toggle(label)
  await until(async () => (await cols()) !== before, 3000)
  await wait(400)
  const blank = await page.evaluate(() => { window.__blank.on = false; return window.__blank.frames })
  check(`${label}: the terminal takes its new size`, (await cols()) !== before, { before, after: await cols() })
  if (gl) check(`${label}: no frame shows the terminal blank`, blank === 0, { blank })
}

// The right sidebar's edge dragged past its narrowest: it shuts, and the drag ends when let go.
const edge = await page.getByRole("separator", { name: "Resize the right sidebar" }).boundingBox()
const x = edge.x + edge.width / 2, y = 400
await page.mouse.move(x, y); await page.mouse.down()
for (let x1 = x; x1 < 1279; x1 = Math.min(1279, x1 + 10)) { await page.mouse.move(x1, y); await wait(15) }
const shut = await until(() => page.evaluate(() => !document.querySelector("[role=separator][aria-label='Resize the right sidebar']")), 2000)
await page.mouse.up()
await wait(300)
check("dragged shut: the right sidebar is hidden", shut)
check("let go: nothing is resizing any more", await page.evaluate(() => !("resizing" in document.body.dataset)))
check("let go: the cursor isn't held", await page.evaluate(() => getComputedStyle(document.querySelector("[data-terminal]")).cursor !== "col-resize"))

// A top bar item in a sidebar (the note's properties, as Review in a vault with Activity on) has Hide, which takes it out of the top bar too.
await toggle("Show right sidebar"); await wait(500)
await page.locator('[data-panel="properties:chips"] [data-panel-handle]').first().click({ button: "right" })
const hide = page.getByRole("menuitem", { name: "Hide Note properties" })
check("a top bar item docked in a sidebar: its menu has Hide", await hide.isVisible().catch(() => false))
await hide.click().catch(() => {})
await until(() => JSON.parse(fs.readFileSync(LOOK, "utf8")).fileBarHidden?.includes("properties:chips"), 4000)
check("hidden: out of the sidebar", await until(() => page.evaluate(() => !document.querySelector('[data-panel="properties:chips"]')), 4000))
check("hidden: out of the top bar", JSON.parse(fs.readFileSync(LOOK, "utf8")).fileBarHidden?.includes("properties:chips"))
await page.locator("[data-term]").click()
await page.keyboard.type("exit"); await page.keyboard.press("Enter"); await wait(300)
for (const [f, v] of [[SIDEBARS, kept.sidebars], [LOOK, kept.look]]) { if (v === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, v) }
await done()
