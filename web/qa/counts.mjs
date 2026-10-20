// Counts that can only go down: how many components React renders per keystroke in a note and in the quick switcher,
// and when a note that isn't open changes behind the app (as Claude would write it). Counted, not timed (a stand-in for
// React DevTools' hook, as perf.mjs's), so it's the same run after run and can fail a change: above its limit in
// counts.json, it fails. Each limit is 5% over the best count seen (commits per key wobbled more: left out). With
// --ratchet, a count that went down lowers its limit there (commit it), so a win stays won.
//   node web/qa/counts.mjs <base url> [--ratchet] [--census]
// WRITES: types into a note and changes another one: throwaway server.
import fs from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B0], browser, check, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const RATCHET = process.argv.includes("--ratchet"), CENSUS = process.argv.includes("--census")
const LIMITS = new URL("./counts.json", import.meta.url)
const NOTE = "Notes/How this vault works.md", OTHER = "Notes/Counted elsewhere.md"

const HOOK = () => {
  const P = window.__counts = { commits: 0, rendered: 0, byName: {} }
  const COMP = new Set([0, 1, 11, 14, 15]) // function, class, forwardRef, memo, simple memo
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
await ctx.addInitScript(() => localStorage.setItem("vaultite.fileMode", "live"))
const page = await ctx.newPage()
const put = (path, text) => fetch(new URL("/api/file", B), { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
await put(OTHER, "A note no tab shows.\n")
const reset = () => page.evaluate(() => Object.assign(window.__counts, { commits: 0, rendered: 0, byName: {} }))
const read = () => page.evaluate(() => window.__counts)
/** The page done with what came before: nothing committed for a while. */
const quiet = async (ms = 600) => {
  for (let i = 0; i < 40; i++) {
    const a = (await read()).commits
    await wait(ms)
    if ((await read()).commits === a) return
  }
}
const busiest = (c) => Object.entries(c.byName).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `${n} ${k}`).join(", ")

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await until(() => page.evaluate(() => document.querySelectorAll(".cm-content .cm-line").length > 2), 15000)
await page.click(".cm-content")
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.press("End")
await quiet()

const now = {}, why = {}
// Typing: per keystroke, the commits and components rendered (before the autosave: its own after a pause). Keys 200 ms
// apart, so each one's deferred renders are done before the next (at typing speed they merge, by timing).
// (its saves held till the keys are counted: a key late on a busy machine leaves the 600 ms pause that saves, and the
// store's refresh after it is what elsewhere.rendered counts)
const saves = []
await page.route("**/api/file", (r) => (r.request().method() === "PUT" ? saves.push(r) : r.continue()))
const typed = " the quick brown fox jumps"
await reset()
await page.keyboard.type(typed, { delay: 200 })
let c = await read()
now["typing.renderedPerKey"] = c.rendered / typed.length
why.typing = `${busiest(c)}${saves.length ? `; ${saves.length} saves held` : ""}`
await page.unroute("**/api/file")
for (const r of saves) await r.continue()
await wait(1500)
await quiet()

// A note no tab shows, changed behind the app: what redraws for it. The fewest of three (what else the page was doing
// only adds: the least is the change's own).
for (let i = 0; i < 3; i++) {
  await reset()
  await put(OTHER, `A note no tab shows, changed ${Date.now()}.\n`)
  await wait(1500)
  await quiet()
  c = await read()
  if (!(c.rendered >= now["elsewhere.rendered"])) { now["elsewhere.rendered"] = c.rendered; why.elsewhere = busiest(c) }
}

// The quick switcher, then a name typed into it: per keystroke.
await page.keyboard.press("ControlOrMeta+o")
await until(() => page.evaluate(() => !!document.querySelector("[role=dialog] input[role=combobox]")), 5000)
await quiet()
const query = "vault"
await reset()
await page.keyboard.type(query, { delay: 120 })
await wait(300)
c = await read()
now["switcher.renderedPerKey"] = c.rendered / query.length
why.switcher = busiest(c)
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
