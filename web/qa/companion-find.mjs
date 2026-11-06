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

// (the same words in two places, styled in parts, a hidden copy and one under a cover; short words inside longer ones)
const put = await page.evaluate(() => {
  const add = (css, html) => { const d = document.createElement("div"); (window.qaFind ??= []).push(d); d.style.cssText = `position:fixed;z-index:99999;font:14px sans-serif;background:white;${css}`; d.innerHTML = html; document.body.append(d); return d }
  const left = add("left:40px;top:300px", "Every <b>thought</b>, your own."), right = add("left:900px;top:300px", "Every <i>thought</i>, your own.")
  add("left:500px;top:500px;visibility:hidden", "Lighthouse beam 7")
  add("left:500px;top:560px", "Lighthouse beam 8")
  add("left:490px;top:550px;width:200px;height:40px;z-index:100000", "")
  add("left:40px;top:620px", "Try agai tomorrow again")
  const ox = window.screenX, oy = window.screenY + Math.max(0, window.outerHeight - window.innerHeight), at = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(ox + b.left), y: Math.round(oy + b.top) } }
  return { left: at(left), right: at(right) }
})
const findAt = async (words, sx, sy) => {
  helper.send(JSON.stringify({ t: "moment", kind: "ask", agent: "Claude", text: "this one", ui, sx, sy }))
  await wait(300)
  const res = await op("companion.draw", { marks: [{ type: "ring", at: { find: words } }] })
  return { res, at: drawing()?.places?.[`find:${words}`] }
}
const nearRight = await findAt("Every thought, your own", put.right.x + 20, put.right.y + 5), nearLeft = await findAt("Every thought, your own", put.left.x + 20, put.left.y + 5)
check("words split by styling are found whole; of two places saying them, the one by their pointer",
  Math.abs((nearRight.at?.x ?? -99) - put.right.x) <= 2 && Math.abs((nearLeft.at?.x ?? -99) - put.left.x) <= 2, { nearRight, nearLeft, put })
const hidden = await findAt("Lighthouse beam 7", 520, 510), covered = await findAt("Lighthouse beam 8", 520, 570), inside = await findAt("gai", 60, 630)
check("words hidden, under something or only inside longer words aren't found", hidden.res.status === 409 && covered.res.status === 409 && inside.res.status === 409, { hidden, covered, inside })
await page.evaluate(() => window.qaFind?.forEach((e) => e.remove()))

// (a web page's own finder, electron/browser/findwords.ts, run as agent:find runs it: in the page)
const { findWords } = await import("../../electron/browser/findwords.ts")
const site = await ctx.newPage()
await site.setContent(`<body style="font:16px sans-serif;margin:0"><p style="position:absolute;left:20px;top:40px">No model, <em>no internet</em>. Your vault changes only when you write in it.</p>
  <p style="position:absolute;left:20px;top:200px;visibility:hidden">Use AI</p><button aria-label="Use AI" style="position:absolute;left:400px;top:200px;width:40px;height:30px">🤖</button>
  <p style="position:absolute;left:20px;top:300px">Again and again</p></body>`)
const inPage = (words) => site.evaluate(`(${findWords})(${JSON.stringify(words)})`)
const [line, label, part] = await Promise.all([inPage("No model, no internet. Your vault changes only when you write in it."), inPage("Use AI"), inPage("ai")])
check("a web page's words are found there whole, across its styling; an element its label names; hidden or inside words, not",
  line.length === 1 && line[0].q === 2 && Math.abs(line[0].x - 20) <= 2 && label.length === 1 && label[0].q === 3 && Math.abs(label[0].x - 400) <= 2 && part.length === 0, { line, label, part })
await site.close()

await op("companion.clear")
helper.close()
await ctx.close()
for (const f of restore) f()
await done()
