// A companion's mark names what's on Vaultite's own window by its words (plugins/core/companion/locate.ts): asked over the
// app's UI, a ring at {"find": words} lands on the element or text saying them, in screen points. A stand-in helper (a
// socket) asks; nothing shows outside the headless page. WRITES the companion's data.json: throwaway server only.
//   node web/qa/companion-find.mjs <base url> <vault path>
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { WebSocket } from "ws"
import { qa, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then(async (r) => ({ status: r.status, ...(await r.json()) }))
const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }

const plugins = JSON.parse(existsSync(file(".vaultite/plugins.json")) ? readFileSync(file(".vaultite/plugins.json"), "utf8") : "{}")
if (!(plugins.enabled ?? []).includes("companion")) { writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "companion"] }, null, 2)); await wait(1500) }
await api("PATCH", "config/plugin/companion", { mode: "quiet", summoned_model: "companion" })
await op("companion.next", { timeout: 0 })

const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } })
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(B)
check("the app's UI drawn", await until(async () => (await page.locator("[data-ui^='button:']").count()) > 0))
await wait(800)

// (the helper's socket: it asks, and is sent the drawing with its places)
const helper = new WebSocket(`${B.replace(/^http/, "ws")}/api/companion/live?screen=1`)
const got = []
helper.on("message", (d) => { try { got.push(JSON.parse(String(d))) } catch { /* not JSON */ } })
await new Promise((ok, no) => { helper.once("open", ok); helper.once("error", no) })
const ui = await page.evaluate(() => [...document.querySelectorAll("[data-ui^='button:']")].find((e) => e.getClientRects().length)?.getAttribute("data-ui"))
helper.send(JSON.stringify({ t: "moment", kind: "ask", agent: "Claude", text: "what are these?", ui, sx: 20, sy: 20 }))
await wait(400)

// (where the page's own sums put an element: its rect from the window's top left, a CSS px a point at actual size)
const named = await page.evaluate(() => {
  const ox = window.screenX, oy = window.screenY + Math.max(0, window.outerHeight - window.innerHeight)
  const at = (r) => ({ x: Math.round(ox + r.left), y: Math.round(oy + r.top), w: Math.round(r.width), h: Math.round(r.height) })
  const el = [...document.querySelectorAll("button[aria-label]")].find((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.top >= 0 && r.bottom <= innerHeight && !e.closest(".companion-overlay") })
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let text = null
  for (let n = walk.nextNode(); n && !text; n = walk.nextNode()) {
    const w = (n.nodeValue ?? "").trim()
    // (words of their own, not an element's name: those are found as that element)
    const p = n.parentElement, named = (e) => e.getAttribute("aria-label")?.trim() === w || e.dataset.tip?.trim() === w
    if (w.length < 5 || w.length > 30 || /\s{2}/.test(w) || document.body.innerText.split(w).length !== 2 || !p || p.closest(".companion-overlay") ||
      (p.matches("[aria-label], [data-tip], button, a, [role]") && !p.children.length) || [...document.querySelectorAll("[aria-label], [data-tip]")].some(named)) continue
    const range = document.createRange(); range.selectNodeContents(n)
    const r = range.getBoundingClientRect()
    if (r.width > 4 && r.top >= 0 && r.bottom <= innerHeight) text = { words: w, at: at(r) }
  }
  return { label: el?.getAttribute("aria-label"), at: el ? at(el.getBoundingClientRect()) : null, text }
})
const drawing = () => got.filter((m) => m.t === "drawing" && m.drawing).at(-1)?.drawing
const near = (a, b) => !!a && !!b && ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) <= 2)
let r = await op("companion.draw", { marks: [{ type: "ring", at: { find: named.label } }] })
await until(() => !!drawing()?.places?.[`find:${named.label}`], 3000)
check("a ring at a button's words lands on that button", r.status === 200 && near(drawing()?.places?.[`find:${named.label}`], named.at), { r, named, places: drawing()?.places })
check("words to look for, on screen", !!named.text, named)
if (named.text) {
  r = await op("companion.draw", { marks: [{ type: "frame", at: { find: named.text.words } }] })
  await until(() => !!drawing()?.places?.[`find:${named.text.words}`], 3000)
  check("a frame at words the window shows lands on them", r.status === 200 && near(drawing()?.places?.[`find:${named.text.words}`], named.text.at), { r, text: named.text, places: drawing()?.places })
}
r = await op("companion.draw", { marks: [{ type: "ring", at: { find: "words nowhere on this screen 41" } }] })
check("words the window doesn't show aren't drawn, and it says so", r.status === 409 && /nothing on the user's screen says/.test(r.error ?? ""), r)

await op("companion.clear")
helper.close()
await ctx.close()
for (const f of restore) f()
await done()
