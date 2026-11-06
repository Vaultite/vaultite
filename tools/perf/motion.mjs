// What moving around the app costs its page, step by step (tabs, sidebars, palette, typing, agents, terminals at work).
// WRITES: throwaway only. On Linux, headful under Xvfb (headless paints on its own clock); --gpu draws with the machine's.
import fs from "node:fs"
import { chromium } from "playwright-core"

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d }
const BASE = args.find((a) => /^https?:/.test(a))?.replace(/\/?$/, "/")
const USAGE = `xvfb-run -a node tools/perf/motion.mjs <base> [--runs 3] [--only a,b] [--note <path>] [--term <id>] [--gpu]
  [--origins (what started each render)] [--who=A,B (who renders them)] [--hooks] [--noraf] [--profile <step>]
  [--trace <step>|all] [--shots dir] [--out r.json]`
if (!BASE) { console.error(USAGE); process.exit(2) }
const RUNS = Number(opt("runs", "3")), ONLY = opt("only", "")?.split(",").filter(Boolean), SHOTS = opt("shots", ""), OUT = opt("out", "")
const TRACE = opt("trace", ""), PROFILE = opt("profile", "")
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const INIT = `(() => {
  const P = window.__m = { commits: 0, rendered: 0, frames: [], byName: {}, origins: {} }
  const COMP = new Set([0, 1, 11, 14, 15])
  const named = (t) => t && (t.displayName || t.name)
  const nameOf = (f) => { const t = f.type; return (t && (named(t) || named(t.type) || named(t.render))) || "anonymous" }
  P.paths = {}; const WHO = ${JSON.stringify((process.argv.find((a) => a.startsWith("--who=")) ?? "--who=").slice(6).split(",").filter(Boolean))}
  const count = (f) => { P.rendered++; const n = nameOf(f); P.byName[n] = (P.byName[n] || 0) + 1
    if (WHO.includes(n)) { const up = []; for (let c = f.return; c && up.length < 30; c = c.return) if (COMP.has(c.tag)) up.push(nameOf(c)); const k = up.join(" < "); P.paths[k] = (P.paths[k] || 0) + 1 } }
  const mount = (f) => { for (let c = f; c; c = c.sibling) { if (COMP.has(c.tag)) count(c); if (c.child) mount(c.child) } }
  const walk = (f) => { for (let c = f.child; c; c = c.sibling) { const a = c.alternate
    if (!a) { if (COMP.has(c.tag)) count(c); if (c.child) mount(c.child); continue }
    if (COMP.has(c.tag) && (c.flags & 1)) { count(c); if (c.memoizedProps === a.memoizedProps) { let n = nameOf(c)
      if (${args.includes("--hooks")}) { const ix = []; for (let h = c.memoizedState, g = a.memoizedState, i = 0; h && g && i < 80; h = h.next, g = g.next, i++) if (h.memoizedState !== g.memoizedState && !(h.queue === null && h.memoizedState && typeof h.memoizedState === "object" && "deps" in h.memoizedState)) ix.push(i); n += "#" + ix.join(".") }
      P.origins[n] = (P.origins[n] || 0) + 1 } }
    if (c.child !== a.child) walk(c) } }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), inject() { return 1 }, checkDCE() {},
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { P.commits++; try { const cur = root.current; if (!cur.alternate) mount(cur.child); else if (cur.child !== cur.alternate.child) walk(cur) } catch {} } }
  const tick = (t) => { P.frames.push(t); requestAnimationFrame(tick) }
  if (!${args.includes("--noraf")}) requestAnimationFrame(tick)
})()`

const metrics = async (cdp) => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
const median = (xs) => { const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }

async function measure(page, cdp, name, act, ms) {
  await page.evaluate(() => { const P = window.__m; P.commits = 0; P.rendered = 0; P.frames = []; P.byName = {}; P.paths = {}; P.origins = {} })
  const a = await metrics(cdp)
  const tracing = TRACE === name || TRACE === "all"
  if (tracing) await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing", transferMode: "ReturnAsStream" })
  if (PROFILE === name) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 100 }); await cdp.send("Profiler.start") }
  const t0 = Date.now()
  await act()
  const left = ms - (Date.now() - t0)
  if (left > 0) await wait(left)
  const b = await metrics(cdp)
  if (PROFILE === name) { const { profile } = await cdp.send("Profiler.stop"); fs.writeFileSync(`/tmp/motion-${name}.cpuprofile`, JSON.stringify(profile)); console.error(selfTimes(profile)) }
  let events = ""
  if (tracing) {
    const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r))
    await cdp.send("Tracing.end")
    const { stream } = await done
    let data = ""
    for (;;) { const c = await cdp.send("IO.read", { handle: stream }); data += c.data; if (c.eof) break }
    fs.writeFileSync(`/tmp/motion-${name}.json`, data)
    const by = {}, evs = JSON.parse(data).traceEvents ?? JSON.parse(data)
    for (const e of evs) if (["DrawFrame", "BeginFrame", "Paint", "Layout", "UpdateLayoutTree", "FireAnimationFrame", "TimerFire", "Commit", "RasterTask", "Animation", "ScheduleStyleRecalculation"].includes(e.name) && e.ph !== "E") by[e.name] = (by[e.name] ?? 0) + 1
    const anims = new Set(evs.filter((e) => e.name === "Animation" && e.args?.data?.name).map((e) => e.args.data.name))
    events = Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ") + (anims.size ? ` | animations: ${[...anims].join(", ")}` : "")
    console.error(`${name}: ${events}`)
  }
  const p = await page.evaluate(() => { const P = window.__m; const top = Object.entries(P.byName).sort((x, y) => y[1] - x[1]).slice(0, 8)
    const origins = Object.entries(P.origins).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([n, c]) => `${n} ${c}`).join(", ")
    return { commits: P.commits, rendered: P.rendered, frames: P.frames.slice(), top, paths: P.paths, origins } })
  if (args.includes("--origins")) console.error(`${name} origins: ${p.origins}`)
  if (Object.keys(p.paths).length) console.error(name, Object.entries(p.paths).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `\n  ${v} ${k}`).join(""))
  const gaps = p.frames.slice(1).map((t, i) => t - p.frames[i])
  const d = (k) => Math.round((b[k] - a[k]) * 1000)
  return {
    name, wallMs: Date.now() - t0, taskMs: d("TaskDuration"), scriptMs: d("ScriptDuration"), styleMs: d("RecalcStyleDuration"), layoutMs: d("LayoutDuration"),
    styles: b.RecalcStyleCount - a.RecalcStyleCount, layouts: b.LayoutCount - a.LayoutCount, commits: p.commits, rendered: p.rendered,
    frames: p.frames.length, long: gaps.filter((g) => g > 20).length, worst: Math.round(Math.max(0, ...gaps)), nodes: b.Nodes, top: p.top.map(([n, c]) => `${n} ${c}`).join(", "),
  }
}

/** A CPU profile's functions by self time, and by total time (what they call too), the top of each. */
function selfTimes(p) {
  const byId = new Map(p.nodes.map((n) => [n.id, n])), self = new Map(), parent = new Map()
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const dt = new Map(); p.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)))
  const label = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`
  const total = new Map()
  for (const [id, t] of dt) {
    const n = byId.get(id); self.set(label(n), (self.get(label(n)) ?? 0) + t)
    const seen = new Set()
    for (let c = id; c != null; c = parent.get(c)) { const l = label(byId.get(c)); if (!seen.has(l)) { seen.add(l); total.set(l, (total.get(l) ?? 0) + t) } }
  }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, t]) => `  ${(t / 1000).toFixed(1).padStart(7)} ms  ${l}`).join("\n")
  return `self:\n${top(self, 30)}\ntotal:\n${top(total, 45)}`
}

const key = (page, k) => page.keyboard.press(k)
const go = (page, h) => page.evaluate((h) => { location.hash = h }, h)
const file = (p) => `#file/${encodeURIComponent(p)}`, term = (id) => `#view/${encodeURIComponent(`terminal/${id}`)}`
const type = async (page) => { await page.click(".cm-content"); await key(page, "Control+End"); await page.keyboard.type(" the quick brown fox jumps over the lazy dog", { delay: 70 }) }
const op = (id, body) => fetch(new URL(`api/ops/${id}`, BASE), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then((r) => r.text()).then((t) => { if (/error/i.test(t.slice(0, 80))) console.error(id, t.slice(0, 200)) })
const look = (s, as, line) => op("companion.look", { path: s.note, line, as })
const write = (path, text) => fetch(new URL("api/file", BASE), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, text }) })
let writes = 0
const writer = async (n) => { for (let i = 0; i < n; i++) { await write(`Agents/Log ${writes % 3}.md`, `---\ntype: note\n---\n\nStep ${writes++} at ${Date.now()}.\n`); await wait(1000) } }
const STEPS = [
  ["open-tabs", async (page, s) => { const notes = await (await fetch(new URL("api/ops/files", BASE), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: "Notes" }) })).json().catch(() => null)
    const paths = (notes?.files ?? notes?.items ?? []).map((f) => f.path ?? f).filter((p) => typeof p === "string" && p.endsWith(".md")).slice(0, 25)
    for (const path of paths.length ? paths : Array.from({ length: 25 }, (_, i) => `Daily/${i}.md`)) { await op("ui.open", { path, newTab: true }); await wait(120) } }, 8000],
  ["tab-switch", async (page) => { for (let i = 0; i < 6; i++) { const rows = await page.$$("aside [data-open-tab]"); if (rows.length > 6) await rows[3 + (i % 2) * 2].click(); await wait(400) } }, 3000],
  ["idle", async () => {}, 5000],
  ["live-dashboard", async () => writer(5), 6000],
  ["sidebar-hide", async (page) => key(page, "Control+\\"), 1200],
  ["sidebar-show", async (page) => key(page, "Control+\\"), 1200],
  ["right-sidebar", async (page) => key(page, "Control+Shift+\\"), 1200],
  ["right-sidebar-2", async (page) => key(page, "Control+Shift+\\"), 1200],
  ["palette", async (page) => { await key(page, "Control+p"); await wait(500); await key(page, "Escape") }, 1500],
  ["switcher-type", async (page) => { await key(page, "Control+o"); await wait(300); await page.keyboard.type("light", { delay: 80 }); await wait(300); await key(page, "Escape") }, 2000],
  ["open-note", async (page, s) => go(page, file(s.note)), 1500],
  ["typing", type, 4500],
  ["after-typing", async () => {}, 3000],
  ["live-note", async () => writer(5), 6000],
  ["scroll-note", async (page) => { await page.mouse.move(800, 450); for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 120); await wait(30) } }, 1500],
  ["agents-arrive", async (page, s) => { await look(s, "Alice", 20); await look(s, "Bob", 40) }, 2500],
  ["agents-idle", async () => {}, 5000],
  ["agents-moving", async (page, s) => { for (let i = 0; i < 8; i++) { await look(s, i % 2 ? "Bob" : "Alice", 10 + ((i * 17) % 60)); await wait(600) } }, 5000],
  ["agents-say", async (page, s) => op("companion.say", { text: "That date is a Sunday, and the plan for the week moves with it.", path: s.note, line: 30, as: "Alice" }), 3000],
  ["typing-with-agents", type, 4500],
  ["term-open", async (page, s) => s.term && go(page, term(s.term)), 2000],
  ["term-idle", async () => {}, 5000],
  ["note-again", async (page, s) => go(page, file(s.note)), 1500],
  ["note-idle", async () => {}, 5000],
  ["split", async (page) => key(page, "Control+d"), 1500],
  ["split-term", async (page, s) => s.term && go(page, term(s.term)), 2000],
  ["split-idle", async () => {}, 5000],
  ["sidebar-hide-split", async (page) => key(page, "Control+\\"), 1200],
  ["sidebar-show-split", async (page) => key(page, "Control+\\"), 1200],
  ["right-hide-split", async (page) => key(page, "Control+Shift+\\"), 1200],
  ["right-show-split", async (page) => key(page, "Control+Shift+\\"), 1200],
  ["pane-click", async (page) => { const r = await page.evaluate(() => [...document.querySelectorAll("section[data-pane-frame]")].map((e) => e.getBoundingClientRect()).map((b) => [b.x + b.width / 2, b.y + b.height / 2])); if (r[0]) await page.mouse.click(...r[0]); await wait(400); if (r[1]) await page.mouse.click(...r[1]); await wait(400); if (r[0]) await page.mouse.click(...r[0]) }, 1800],
  ["typing-beside-term", type, 4500],
  ["peek", async (page) => { await key(page, "Control+\\"); await wait(600); await page.mouse.move(400, 450); await page.mouse.move(2, 450, { steps: 8 }); await wait(700); await page.mouse.move(900, 450, { steps: 8 }); await wait(500); await key(page, "Control+\\") }, 3000],
]

const GPU = args.includes("--gpu") ? ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] : []
const browser = await chromium.launch({ headless: false, args: [...GPU, "--mute-audio", "--window-size=1440,960", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"] })
const results = {}
try {
  const subjects = { note: opt("note", "Notes/Long draft.md"), term: opt("term", "") }
  // (a long note to type in, made up when the vault hasn't one)
  if (!(await fetch(new URL(`api/file?path=${encodeURIComponent(subjects.note)}`, BASE))).ok) {
    const words = "the a small app idea launch design book coffee trip project draft notes week plan review focus".split(" ")
    const line = (i, n) => Array.from({ length: n }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" ") + "."
    const parts = Array.from({ length: 14 }, (_, i) => `## Section ${i + 1}\n\n${Array.from({ length: 5 }, (_, j) => line(i + j, 12)).join(" ")}\n\n` +
      `${Array.from({ length: 4 }, (_, j) => `- [ ] ${line(i * j, 6)}`).join("\n")}\n\n| a | b | c |\n|---|---|---|\n| ${line(i, 2)} | ${line(i + 1, 2)} | ${i} |\n`)
    await write(subjects.note, `---\ntype: note\n---\n\n# Long draft\n\n${parts.join("\n")}`)
  }
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    await ctx.addInitScript(INIT)
    const page = await ctx.newPage()
    page.on("pageerror", (e) => console.error("pageerror", String(e).slice(0, 200)))
    const cdp = await ctx.newCDPSession(page)
    await cdp.send("Performance.enable")
    await page.goto(BASE)
    await page.waitForSelector("aside[data-side]", { timeout: 60000 })
    await wait(6000)
    console.error("gl:", await page.evaluate(() => { const c = document.createElement("canvas").getContext("webgl2"); const e = c?.getExtension("WEBGL_debug_renderer_info"); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : "none" }))
    for (const [name, act, ms] of STEPS) {
      if (ONLY?.length && !ONLY.includes(name)) continue
      try {
        const r = await measure(page, cdp, name, () => act(page, subjects), ms)
        ;(results[name] ??= []).push(r)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
      } catch (e) { console.error(name, String(e).slice(0, 200)) }
      await wait(700)
    }
    await ctx.close()
  }
} finally { await browser.close() }

const keys = ["taskMs", "scriptMs", "styleMs", "layoutMs", "styles", "layouts", "commits", "rendered", "frames", "long", "worst"]
const table = Object.fromEntries(Object.entries(results).map(([n, rs]) => [n, { ...Object.fromEntries(keys.map((k) => [k, median(rs.map((r) => r[k]))])), top: rs.at(-1).top }]))
console.log(["step".padEnd(20), ...keys.map((k) => k.padStart(8))].join(""))
for (const [n, r] of Object.entries(table)) console.log([n.padEnd(20), ...keys.map((k) => String(r[k]).padStart(8))].join(""))
for (const [n, r] of Object.entries(table)) console.log(`${n}: ${r.top}`)
if (OUT) fs.writeFileSync(OUT, JSON.stringify(table, null, 2))
