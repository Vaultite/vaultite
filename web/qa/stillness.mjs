// Reduce motion (the system's) and Animations off (Settings) each keep the app still on desktop and phone: tabs,
// sidebars, sheets, menus, the palette, toasts, a dragged tab, the phone's tab list and Back move nothing, scroll
// nothing smoothly. Sets appearance.json's animation (then puts it back), opens tabs: throwaway server only.
//   node web/qa/stillness.mjs <base url>
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { app } from "./lib/app.mjs"
import { apiAt, command, openPalette, qa } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url, { motion: true })
const api = apiAt(B)
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VAULTITE_/.test(k)))
const vau = (...a) => execFileSync("node", [fileURLToPath(new URL("../../bin/vau", import.meta.url)), ...a], { env: { ...clean, VAULTITE_URL: B.replace(/\/$/, "") }, encoding: "utf8" })
const files = (await api("GET", "state")).files.files.filter((f) => f.path.startsWith("Notes/") && f.path.endsWith(".md")).map((f) => f.path)
const look = await api("GET", "config/appearance")

// Every animation the page starts (CSS, Web Animations, view transitions) and every smooth scroll, as they start.
function recorder() {
  if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") }
  const seen = new WeakSet(), out = (window.__moved = [])
  const MOVES = /^(transform|translate|scale|rotate|left|top|right|bottom|inset|width|height|min-|max-|margin|padding|clip-path|background-position|offset)/
  const name = (el) => !el ? "?" : el.nodeType !== 1 ? el.nodeName : `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.attributes].filter((a) => a.name.startsWith("data-") || a.name === "aria-label").slice(0, 3).map((a) => `[${a.name}${a.value && a.value.length < 30 ? `=${a.value}` : ""}]`).join("")}`
  const note = (a) => {
    if (!a || seen.has(a)) return
    seen.add(a)
    const t = a.effect?.getComputedTiming?.() ?? {}, dur = typeof t.duration === "number" ? t.duration : 0
    const props = a.transitionProperty ? [a.transitionProperty]
      : [...new Set((a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k)).filter((k) => !["offset", "computedOffset", "easing", "composite"].includes(k)))]
        .map((k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
    if (dur <= 1 || a.playState === "finished") return
    const moves = props.some((p) => MOVES.test(p)), fade = props.every((p) => p === "opacity")
    // (a spinner says it's working: allowed)
    const spinner = t.iterations === Infinity && /spin|pulse/.test(a.animationName ?? "")
    if (spinner || (fade && dur <= 150) || (!moves && !fade)) return
    out.push(`${a.constructor.name} ${a.animationName || a.id || ""} ${props.join(",")} ${Math.round(dur)}ms on ${name(a.effect?.target)}${a.effect?.pseudoElement ?? ""}`.replace(/\s+/g, " "))
  }
  const sweep = () => { for (const a of document.getAnimations()) note(a) }
  const frame = () => { sweep(); requestAnimationFrame(frame) }
  requestAnimationFrame(frame)
  for (const ev of ["transitionrun", "animationstart"]) addEventListener(ev, (e) => queueMicrotask(() => { for (const a of e.target.getAnimations?.() ?? []) note(a) }), true)
  const animate = Element.prototype.animate
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); queueMicrotask(() => note(a)); return a }
  const vt = document.startViewTransition?.bind(document)
  if (vt) document.startViewTransition = (cb) => { out.push(`view transition ${document.documentElement.dataset.motion ?? ""}`); return vt(cb) }
  const smooth = (o) => o && typeof o === "object" && o.behavior === "smooth"
  for (const [proto, fns] of [[Element.prototype, ["scrollTo", "scrollBy", "scrollIntoView"]], [window, ["scrollTo", "scrollBy"]]])
    for (const fn of fns) { const f = proto[fn]; proto[fn] = function (...a) { if (smooth(a[0])) out.push(`smooth ${fn} on ${name(this === window ? document.documentElement : this)}`); return f.apply(this, a) } }
}

const DESKTOP = { viewport: { width: 1440, height: 900 } }
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

/** One pass: `size` with `reduce` (the system's) or the app's animation `pref`; each step, what moved. */
async function pass(label, size, { reduce = false, pref = null }) {
  await api("PATCH", "config/appearance", { animation: pref })
  await fetch(`${B}api/workspaces/1`, { method: "DELETE" })
  const ctx = await browser.newContext({ ...size, reducedMotion: reduce ? "reduce" : "no-preference" })
  await ctx.addInitScript(recorder)
  const page = watch(await ctx.newPage(), { console: true, label }), ui = app(page)
  const cmd = async (name) => { await command(page, name, 0); await ui.idle() }
  const moved = {}
  const step = async (what, act) => {
    await page.evaluate(() => { window.__moved.length = 0 })
    await act()
    await ui.idle()
    moved[what] = await page.evaluate(() => [...new Set(window.__moved)])
  }
  const phone = size === PHONE
  await page.goto(`${B}#file/${encodeURIComponent(files[0])}`)
  await page.waitForSelector(phone ? "[data-phone-bar]" : "[data-tab-bar]")
  await ui.idle()
  if (pref) check(`${label}: the app's setting is on the page`, await page.evaluate(() => document.documentElement.dataset.animation) === pref)
  const toast = () => step("toast", async () => { vau("notify", "Still here"); await page.waitForSelector("[data-sonner-toast], [role=status]", { timeout: 5000 }).catch(() => {}) })
  if (!phone) {
    const tabs = page.locator("[data-tab-bar] [data-tab-id]")
    await step("new tab", () => page.click("[data-tab-bar] [data-slide=new]"))
    await step("open a file", () => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(files[1])}`))
    await step("switch tabs", () => tabs.first().click())
    await step("left sidebar off and on", async () => { await page.keyboard.press("ControlOrMeta+\\"); await ui.idle(); await page.keyboard.press("ControlOrMeta+\\") })
    await step("right sidebar", async () => { await cmd("Show right sidebar"); await cmd("Hide right sidebar") })
    await step("sheet", async () => { await cmd("Open hotkeys"); await page.waitForSelector("dialog[open]"); await ui.idle(); await page.keyboard.press("Escape") })
    await step("menu", async () => { await tabs.first().click({ button: "right" }); await page.waitForSelector("[role=menu]"); await ui.idle(); await page.keyboard.press("Escape") })
    await step("palette", async () => { await openPalette(page); await page.waitForSelector("[role=dialog] input"); await ui.idle(); await page.keyboard.press("Escape") })
    await toast()
    await step("drag a tab", async () => {
      const b = await tabs.first().boundingBox()
      await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down()
      for (let i = 1; i <= 12; i++) { await page.mouse.move(b.x + 20 + i * 20, b.y + b.height / 2); await page.evaluate(() => new Promise(requestAnimationFrame)) }
      await page.mouse.up()
    })
    await step("split and close a pane", async () => { await cmd("Split right"); await cmd("Close pane") })
    await step("close a tab", () => cmd("Close tab"))
    // (stacked tabs scroll their row to the one picked)
    await step("stacked tabs", async () => {
      for (const f of files.slice(2, 6)) { await page.click("[data-tab-bar] [data-slide=new]"); await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`); await ui.idle() }
      await cmd("Stack tabs")
      await cmd("Go to tab #1")
    })
  } else {
    await step("new tab", () => page.click("[data-bar=new]"))
    await step("open a file", () => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(files[1])}`))
    await step("tab list", async () => { await page.click("[data-tabs-button]"); await page.waitForSelector("dialog[open] [data-tabs-grid]"); await ui.idle(); await page.click("[data-sheet-done]") })
    await step("close a tab in the tab list", async () => {
      await page.click("[data-tabs-button]"); await page.waitForSelector("dialog[open] [data-tabs-grid]"); await ui.idle()
      await page.locator("dialog[open] [data-tab-row] button[aria-label^='Close ']").first().click(); await ui.idle()
      await page.click("[data-sheet-done]")
    })
    await step("back", () => page.click("[data-bar=back]"))
    await step("forward", () => page.click("[data-bar=forward]"))
    await step("left sidebar", async () => { await page.click("[aria-label='Open sidebar']"); await ui.idle(); await page.keyboard.press("Escape") })
    if (await page.locator("[aria-label='Open right sidebar']").count())
      await step("right sidebar", async () => { await page.click("[aria-label='Open right sidebar']"); await ui.idle(); await page.keyboard.press("Escape") })
    await step("sheet", async () => {
      const p = files.find((f) => f !== files[0]) ?? files[0]
      await page.evaluate((p) => { history.pushState({ sheet: 1 }, "", `${location.hash.split("/")[0]}/file/${encodeURIComponent(p)}`); dispatchEvent(new HashChangeEvent("hashchange")) }, p)
      await page.waitForSelector("dialog[open]"); await ui.idle(); await page.click("[data-sheet-done]")
    })
    await step("menu", async () => { await page.click("[data-bar=menu]"); await page.waitForSelector("[role=menu]"); await ui.idle(); await page.keyboard.press("Escape") })
    await toast()
  }
  await ctx.close()
  return moved
}

const show = (m) => Object.entries(m).filter(([, v]) => v.length)
let sane = 0
for (const [where, size] of [["desktop", DESKTOP], ["phone", PHONE]]) {
  // (the recorder sees motion where there is some, so a still pass means still)
  const on = await pass(`${where}, animations on`, size, {})
  sane = Object.values(on).flat().length
  if (process.env.QA_VERBOSE) console.log(JSON.stringify(on, null, 1))
  check(`${where}, animations on: things move (the recorder sees them)`, sane > 0)
  for (const [mode, o] of [["reduce motion", { reduce: true }], ["animations off", { pref: "off" }]]) {
    const m = await pass(`${where}, ${mode}`, size, o)
    for (const [what, list] of Object.entries(m)) check(`${where}, ${mode}: ${what} moves nothing`, !list.length, list)
    console.log(`     ${where}, ${mode}: ${show(m).reduce((n, [, v]) => n + v.length, 0)} moving (with animations on: ${sane})`)
  }
}
await api("PATCH", "config/appearance", { animation: look.animation ?? null })
await done()
