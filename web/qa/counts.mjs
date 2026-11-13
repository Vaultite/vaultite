// Counts that only go down (React renders per keystroke, palette, outside change), against counts.json's limits.
// --ratchet lowers a limit a win beat (commit it). WRITES: types into notes on a throwaway server.
//   node web/qa/counts.mjs <base url> [--ratchet] [--census]
// Paths: web/src/App.tsx, web/src/core/plugins.ts, web/src/core/data.ts, web/src/editor/Editor.tsx
import fs from "node:fs"
import { qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B0], browser, check, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const RATCHET = process.argv.includes("--ratchet"), CENSUS = process.argv.includes("--census")
const LIMITS = new URL("./counts.json", import.meta.url)
const NOTE = "Notes/How this vault works.md", OTHER = "Notes/Counted elsewhere.md"

const HOOK = () => {
  const P = window.__counts = { commits: 0, rendered: 0, byName: {} }
  const COMP = new Set([0, 1, 11, 14, 15]) // (React's fiber tags: function, class, forwardRef, memo, simple memo)
  const nameOf = (f) => { const t = f.type; return (t && (t.displayName || t.name || t.type?.displayName || t.type?.name || t.render?.name)) || "anonymous" }
  const count = (f) => { P.rendered++; const n = nameOf(f); P.byName[n] = (P.byName[n] || 0) + 1 }
  const mount = (f) => { for (let c = f; c; c = c.sibling) { if (COMP.has(c.tag)) count(c); if (c.child) mount(c.child) } }
  const walk = (f) => {
    for (let c = f.child; c; c = c.sibling) {
      const a = c.alternate
      if (!a) { if (COMP.has(c.tag)) count(c); if (c.child) mount(c.child); continue }
      if (COMP.has(c.tag) && (c.flags & 1)) count(c)
      if (c.child !== a.child) walk(c)
    }
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(), inject() { return 1 }, checkDCE() {},
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      P.commits++
      try { const cur = root.current; if (!cur.alternate) mount(cur.child); else if (cur.child !== cur.alternate.child) walk(cur) } catch {}
    },
  }
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(HOOK)
const page = await ctx.newPage(), ui = app(page)
const put = (path, text) => fetch(new URL("/api/file", B), { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
await put(OTHER, "A note no tab shows.\n")
const reset = () => page.evaluate(() => Object.assign(window.__counts, { commits: 0, rendered: 0, byName: {} }))
const read = () => page.evaluate(() => window.__counts)
const busiest = (c) => Object.entries(c.byName).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `${n} ${k}`).join(", ")

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await until(() => page.evaluate(() => document.querySelectorAll(".cm-content .cm-line").length > 2), 15000)
await page.click(".cm-content")
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.press("End")
await ui.idle()

const now = {}, why = {}
const typeCounted = async (name, typed) => {
  for (const words of [typed, typed.split("").reverse().join("")]) {
    const saves = []
    let holding = true
    await page.route("**/api/file", (r) => (holding && r.request().method() === "PUT" ? saves.push(r) : r.continue()))
    await reset()
    await page.keyboard.type(words, { delay: 200 })
    const c = await read(), k = `${name}.renderedPerKey`
    if (!(c.rendered / words.length >= now[k])) { now[k] = c.rendered / words.length; why[name] = `${busiest(c)}${saves.length ? `; ${saves.length} saves held` : ""}` }
    holding = false
    for (const r of saves) await r.continue()
    await page.unroute("**/api/file")
    await ui.idle()
  }
}
await typeCounted("typing", " the quick brown fox jumps")

const op = (id, params = {}) => fetch(new URL(`/api/ops/${id}`, B), { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const SPOT = "Where this vault keeps things"
await op("companion.look", { path: NOTE, find: SPOT })
await op("companion.comment", { path: NOTE, find: SPOT, text: "A comment the keys don't move." })
await until(() => page.evaluate(() => !!document.querySelector(".companion-cursor") && !!document.querySelector("[data-companion-note], [data-companion-gutter]")), 8000)
await page.click(".cm-content")
await page.keyboard.press("ControlOrMeta+End")
await ui.idle()
await typeCounted("companion", " over the lazy dog")
await op("companion.clear")
await page.waitForFunction(() => !document.querySelector("[data-companion-note], [data-companion-gutter]"))
await ui.idle()
let c

for (let i = 0; i < 3; i++) {
  await reset()
  await ui.sees(OTHER, () => put(OTHER, `A note no tab shows, changed ${Date.now()}.\n`))
  c = await read()
  if (!(c.rendered >= now["elsewhere.rendered"])) { now["elsewhere.rendered"] = c.rendered; why.elsewhere = busiest(c) }
}

await page.keyboard.press("ControlOrMeta+o")
await until(() => page.evaluate(() => !!document.querySelector("[role=dialog] input[role=combobox]")), 5000)
await ui.idle()
const query = "vault", found = []
await page.route("**/api/search?*", (r) => found.push(r))
await reset()
await page.keyboard.type(query, { delay: 120 })
await ui.idle({ held: (r) => r.url().includes("/api/search?") })
c = await read()
now["switcher.renderedPerKey"] = c.rendered / query.length
why.switcher = busiest(c)
await page.unroute("**/api/search?*")
for (const r of found) await r.continue().catch(() => {})
await page.keyboard.press("Escape")

await ui.idle()
await reset()
await page.keyboard.press("ControlOrMeta+p")
await until(() => page.evaluate(() => !!document.querySelector("[role=dialog] [role=option]")), 5000)
await ui.idle()
c = await read()
now["palette.rendered"] = c.rendered
why.palette = busiest(c)
await page.keyboard.press("Escape")

const limits = JSON.parse(fs.readFileSync(LIMITS, "utf8"))
const round = (n) => Math.round(n * 10) / 10
console.table(Object.fromEntries(Object.keys(now).map((k) => [k, { now: round(now[k]), limit: limits[k] }])))
if (CENSUS) for (const [k, v] of Object.entries(why)) console.log(`${k}: ${v}`)
for (const [k, v] of Object.entries(now)) check(`${k} stays at ${limits[k]} or under`, limits[k] !== undefined && round(v) <= limits[k], { now: round(v), limit: limits[k], busiest: why[k.split(".")[0]] })
if (RATCHET) {
  const next = Object.fromEntries(Object.entries(limits).map(([k, l]) => [k, now[k] === undefined ? l : Math.min(l, Math.ceil(now[k] * 1.05 * 10) / 10)]))
  if (JSON.stringify(next) !== JSON.stringify(limits)) { fs.writeFileSync(LIMITS, `${JSON.stringify(next, null, 2)}\n`); console.log("lowered: counts.json") }
}
await done()
