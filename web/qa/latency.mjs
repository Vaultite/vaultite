// How instant the core interactions feel, on desktop (1440x900): each timed from its input event to the next frame after
// its result is drawn, with what it cost (React commits and components rendered, through a stand-in for React DevTools'
// hook; script, layout and style time from CDP's Performance.getMetrics; long tasks). Times on a shared machine are
// noisy and headless Chrome paints about every 16-40 ms whatever the page does: lean on the counts and CPU time.
//   load      a cold load and a warm one: to the first file's text drawn, and app.load's parts (core/spans.ts)
//   typing    keys typed in the middle of a long note (~3000 lines): keydown to the next frame, CPU per key
//   open      a file clicked in the file explorer, to its text drawn: files never opened, then ones opened before
//   tabs      switching between tabs by clicking them, to the tab's text drawn
//   panes     a click into the other pane of a split, to its editor focused
//   palette   the command palette (Mod+P) opened, then a query typed; the quick switcher (Mod+O) the same
//   sidebar   the left sidebar hidden and shown (Mod+\)
// --only load: just the loads. --phone: 390x844, touch, CPU 4x slower: load, typing and the quick switcher. --profile <step> saves that step's CPU
// profile (Chrome DevTools opens it) and lists the functions that took the most. --runs N (default 3): medians of N.
// With a vault path, it first adds 20 made-up vault plugins there (~550 KB of bundles, as a big vault has), turned on
// and allowed, so the load waits for bundles as a real one does; they stay (run it again without the path).
// WRITES: a "Latency" folder of notes (600 in its Many folder), workspace 1's tabs (one tab at each run's start, then splits), and with a vault path its plugins: throwaway server only.
//   node web/qa/latency.mjs <base url> [vault path] [--runs 3] [--only load] [--phone] [--profile <step>] [--out r.json] [--compare r.json]
import fs from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"

const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt }
const flag = (name) => argv.includes(`--${name}`)
const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--phone"].includes(argv[i - 1])))
const { browser, check, done } = await qa(import.meta.url)
const B = pos[0].replace(/\/?$/, "/"), VAULT = pos[1]
const ONLY = opt("only", ""), RUNS = Number(opt("runs", "3")), PHONE = flag("phone"), PROFILE = opt("profile", ""), OUT = opt("out", ""), COMPARE = opt("compare", "")
const H = { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }
const api = async (method, p, body) => {
  const r = await fetch(new URL(`api/${p}`, B), { method, headers: H, body: body == null ? undefined : JSON.stringify(body) })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`)
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text()
}

// ---------- the notes it works on ----------
const DIR = "Latency", NOTES = 12, LONG = `${DIR}/Long note.md`, MANY = `${DIR}/Many`
const words = "the keeper climbs one hundred steps every evening to light the lamp while fog rolls in from the north sea".split(" ")
const line = (i) => Array.from({ length: 8 + (i % 9) }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(" ")
function longNote(n = 3000) {
  const out = ["---", "type: note", "tags: [lighthouse, latency]", "---", ""]
  for (let i = 0; out.length < n; i++) {
    out.push(`## Section ${i}`, "", `${line(i)} [[Latency/Note 0${i % 9 + 1}]] and **bold** and \`code\`.`, "")
    for (let k = 0; k < 6; k++) out.push(`- ${line(i + k)} #tag${k}`)
    out.push(`- [ ] a task ${i} 📅 2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, "", `> ${line(i + 3)}`, "")
    if (i % 5 === 0) out.push("```js", `const x${i} = ${i}`, "```", "", "| a | b |", "| --- | --- |", `| ${i} | ${i * 2} |`, "")
    out.push(line(i + 1), "")
  }
  return out.join("\n")
}
const note = (i) => `---\ntype: note\n---\n\nMarker ${i} lighthouse\n\n${Array.from({ length: 60 }, (_, k) => (k % 10 === 0 ? `## Part ${k}\n` : `${line(i + k)}\n`)).join("\n")}`
const name = (i) => `${DIR}/Note ${String(i).padStart(2, "0")}.md`
for (let i = 1; i <= NOTES; i++) await api("PUT", "file", { path: name(i), text: note(i) })
await api("PUT", "file", { path: LONG, text: longNote() })
// (a big folder for the file explorer: 600 short notes, 25 at a time)
for (let i = 0; i < 600; i += 25) await Promise.all(Array.from({ length: 25 }, (_, k) => api("PUT", "file", { path: `${MANY}/Note ${String(i + k).padStart(3, "0")}.md`, text: `${line(i + k)}\n` })))

// ---------- made-up vault plugins (with a vault path) ----------
if (VAULT) {
  const dir = (id) => path.join(VAULT, ".vaultite/plugins", id)
  const ids = Array.from({ length: 20 }, (_, i) => `latency-${String(i + 1).padStart(2, "0")}`)
  for (const [i, id] of ids.entries()) {
    if (fs.existsSync(dir(id))) continue
    fs.mkdirSync(dir(id), { recursive: true })
    fs.writeFileSync(path.join(dir(id), "manifest.json"), JSON.stringify({ id, name: `Latency ${i + 1}`, description: "A made-up vault plugin with a bundle of a real one's size.", version: "1.0.0", apiVersion: 1, icon: "puzzle" }, null, 2))
    // (the first as big as a drawing plugin's, the others a few dozen KB: ~550 KB in all)
    const rows = Array.from({ length: i === 0 ? 4000 : 250 }, (_, k) => `  "${id} row ${k} ${line(k * (i + 1))}",`).join("\n")
    fs.writeFileSync(path.join(dir(id), "rows.ts"), `export const rows = [\n${rows}\n]\n`)
    fs.writeFileSync(path.join(dir(id), "index.tsx"), `import { definePlugin, notify } from "@vaultite"\nimport { rows } from "./rows"\n\nexport default definePlugin({\n  commands: [{ id: "${id}:say", name: "Say ${id}'s rows", run: () => notify(String(rows.length) + rows[rows.length - 1]) }],\n})\n`)
  }
  const pj = path.join(VAULT, ".vaultite/plugins.json")
  const conf = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, "utf8")) : {}
  const missing = ids.filter((id) => !(conf.enabled ?? []).includes(id))
  if (missing.length) { conf.enabled = [...(conf.enabled ?? []), ...missing]; fs.writeFileSync(pj, `${JSON.stringify(conf, null, 2)}\n`) }
  // Allowed on this machine once built (their hash: what's allowed).
  const ready = await until(async () => {
    const st = (await api("GET", "state?since=0")).state
    const vp = (st.vaultPlugins ?? []).filter((p) => ids.includes(p.id))
    for (const p of vp) if (!p.bundle && p.on && !p.problems?.length) await api("POST", "ops/plugin.allow", { id: p.id, ...(p.hash ? { hash: p.hash } : {}) }).catch(() => {})
    return vp.length === ids.length && vp.every((p) => p.bundle)
  }, 60000, 1000)
  check("the made-up vault plugins are built and allowed", ready)
}

// ---------- in the page ----------
const INIT = () => {
  const P = window.__lat = { commits: 0, rendered: 0, byName: {}, longtasks: [], lastMutation: 0, lastCommit: 0, keys: [], input: null }
  const COMP = new Set([0, 1, 11, 14, 15]) // function, class, forwardRef, memo, simple memo
  const named = (t) => t && (t.displayName || t.name)
  const own = (f) => { const t = f.type; return t && typeof t !== "string" && (named(t) || named(t.type) || named(t.render)) }
  // (an unnamed one, a plugin's inline render, by the nearest named component above it)
  const nameOf = (f) => { const n = own(f); if (n) return n; for (let p = f.return; p; p = p.return) { const m = own(p); if (m) return `(in ${m})` } return "anonymous" }
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
      P.commits++; P.lastCommit = performance.now()
      try { const cur = root.current; if (!cur.alternate) mount(cur.child); else if (cur.child !== cur.alternate.child) walk(cur) } catch {}
    },
  }
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => P.longtasks.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true }) } catch {}
  addEventListener("DOMContentLoaded", () => new MutationObserver(() => { P.lastMutation = performance.now() })
    .observe(document, { childList: true, subtree: true, attributes: true, characterData: true }))
  // The next frame after now: a rAF, then a task (so that frame's paint is done).
  P.nextPaint = () => new Promise((r) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => r(performance.now()); c.port2.postMessage(0) }))
  addEventListener("keydown", (e) => { const t = e.timeStamp; P.nextPaint().then((n) => P.keys.push(n - t)) }, true)
  for (const type of ["pointerdown", "keydown"]) addEventListener(type, (e) => { P.input ??= e.timeStamp }, true)
  P.until = (cond, ms = 20000) => new Promise((resolve) => {
    const end = performance.now() + ms
    const tick = () => {
      let ok = false
      try { ok = cond() } catch {}
      if (ok) return P.nextPaint().then(resolve)
      if (performance.now() > end) return resolve(null)
      requestAnimationFrame(tick)
    }
    tick()
  })
  /** Whether a shown editor has `text` (a pane's tab kept hidden doesn't count). */
  P.shows = (text) => [...document.querySelectorAll(".cm-content")].some((e) => e.getClientRects().length && e.closest("[data-kept]") === null && e.textContent.includes(text))
}

// ---------- helpers ----------
const median = (xs) => { const s = xs.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null }
const busiest = (by) => Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, c]) => `${n} ${c}`).join(", ")

async function session() {
  const ctx = await browser.newContext(PHONE
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
    : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(INIT)
  await ctx.addInitScript(() => localStorage.setItem("vaultite.fileMode", "live"))
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Performance.enable")
  if (PHONE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  return { ctx, page, cdp }
}

async function counters(s) {
  const p = await s.page.evaluate(() => { const P = window.__lat; return { commits: P.commits, rendered: P.rendered, at: performance.now() } })
  const { metrics } = await s.cdp.send("Performance.getMetrics")
  return { ...p, m: Object.fromEntries(metrics.map((x) => [x.name, x.value])) }
}
async function since(s, b) {
  const a = await counters(s)
  const lt = await s.page.evaluate((t) => window.__lat.longtasks.filter(([st]) => st >= t), b.at)
  return {
    commits: a.commits - b.commits, rendered: a.rendered - b.rendered,
    scriptMs: Math.round((a.m.ScriptDuration - b.m.ScriptDuration) * 10000) / 10,
    layoutMs: Math.round((a.m.LayoutDuration - b.m.LayoutDuration) * 10000) / 10,
    styleMs: Math.round((a.m.RecalcStyleDuration - b.m.RecalcStyleDuration) * 10000) / 10,
    longTasks: lt.length, longTaskMs: Math.round(lt.reduce((n, [, d]) => n + d, 0)),
  }
}
/** Done with what came before: no commit and no DOM change for `ms`. */
async function quiet(s, ms = 400, max = 15000) {
  const end = Date.now() + max
  while (Date.now() < end) {
    const idle = await s.page.evaluate(() => performance.now() - Math.max(window.__lat.lastCommit, window.__lat.lastMutation))
    if (idle > ms) return
    await wait(Math.max(50, ms - idle))
  }
}

let profiled = null
async function profiling(s, name, fn) {
  if (PROFILE !== name || profiled) return fn()
  await s.cdp.send("Profiler.enable")
  await s.cdp.send("Profiler.setSamplingInterval", { interval: 200 })
  await s.cdp.send("Profiler.start")
  const r = await fn()
  const { profile } = await s.cdp.send("Profiler.stop")
  profiled = profile
  return r
}

/** `act`, timed from its first input event (else from `act` itself) to the next frame after `cond(arg)` holds in the
 *  page; then what it cost until the page is quiet. */
async function step(s, name, act, cond, arg) {
  await quiet(s)
  return profiling(s, name, async () => {
    await s.page.evaluate(() => { window.__lat.byName = {} })
    const before = await counters(s)
    const start = await s.page.evaluate(() => { window.__lat.input = null; return performance.now() })
    const end = s.page.evaluate(([c, a]) => window.__lat.until(new Function("arg", `return (${c})(arg)`).bind(null, a)), [cond.toString(), arg])
    await act()
    const t = await end
    const from = await s.page.evaluate((x) => window.__lat.input ?? x, start)
    await quiet(s)
    const d = await since(s, before)
    return { ms: t === null ? null : Math.round(t - from), ...d, census: busiest(await s.page.evaluate(() => window.__lat.byName)) }
  })
}

/** Medians of each number over the samples, and the busiest components of the first. */
const combine = (xs) => {
  xs = xs.filter(Boolean)
  if (!xs.length) return null
  const out = {}
  for (const k of Object.keys(xs[0])) out[k] = typeof xs[0][k] === "number" || xs[0][k] === null ? median(xs.map((x) => x[k])) : xs[0][k]
  return out
}

// ---------- a run ----------
const load = (s, reload) => profiling(s, reload ? "warmLoad" : "coldLoad", () => loadOnce(s, reload))
async function loadOnce(s, reload) {
  const go = reload ? s.page.reload({ waitUntil: "commit" }) : s.page.goto(`${B}#file/${encodeURIComponent(name(1))}`, { waitUntil: "commit" })
  await go
  const t = await s.page.evaluate(() => window.__lat.until(() => window.__lat.shows("Marker 1 lighthouse"), 60000))
  await quiet(s, 700)
  return s.page.evaluate((drawn) => {
    const sp = (window.__vauTrace?.span ?? []).filter((e) => e.name === "app.load").pop()
    const lt = window.__lat.longtasks.filter(([st]) => st <= drawn)
    const res = performance.getEntriesByType("resource")
    const bundles = res.filter((r) => /\/api\/plugins\/.+\/bundle\.js/.test(r.name))
    return {
      fileDrawn: Math.round(drawn), appLoad: sp?.ms ?? null, ...Object.fromEntries(Object.entries(sp?.parts ?? {}).map(([k, v]) => [`part:${k}`, v])),
      longTasks: lt.length, longTaskMs: Math.round(lt.reduce((n, [, d]) => n + d, 0)), commits: window.__lat.commits,
      bundles: bundles.length, bundlesFetched: bundles.filter((r) => r.transferSize > 0).length,
      bundlesStart: bundles.length ? Math.round(Math.min(...bundles.map((r) => r.startTime))) : null,
      bundlesEnd: bundles.length ? Math.round(Math.max(...bundles.map((r) => r.responseEnd))) : null,
    }
  }, t)
}

/** The editor's view of the shown note, to put the cursor somewhere without a hundred arrow keys. */
const cursorTo = (s, frac) => s.page.evaluate((f) => {
  const el = [...document.querySelectorAll(".cm-content")].find((e) => e.getClientRects().length && !e.closest("[data-kept]"))
  const view = el?.cmTile?.root?.view
  if (!view) return false
  const pos = view.state.doc.line(Math.floor(view.state.doc.lines * f)).to
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  view.focus()
  return true
}, frac)

async function typing(s, label) {
  await quiet(s)
  return profiling(s, label, async () => {
    const text = " the quick brown fox jumps over"
    await s.page.evaluate(() => { window.__lat.keys = []; window.__lat.byName = {} })
    const before = await counters(s)
    await s.page.keyboard.type(text, { delay: 70 })
    await wait(100)
    const keys = await s.page.evaluate(() => window.__lat.keys)
    const d = await since(s, before)
    const n = text.length
    return { keyMs: median(keys), keyP95: pct(keys, 0.95), keyMax: Math.max(...keys), commitsPerKey: d.commits / n, renderedPerKey: d.rendered / n,
      scriptMsPerKey: Math.round((d.scriptMs / n) * 100) / 100, layoutMsPerKey: Math.round((d.layoutMs / n) * 100) / 100, styleMsPerKey: Math.round((d.styleMs / n) * 100) / 100,
      longTasks: d.longTasks, longTaskMs: d.longTaskMs, census: busiest(await s.page.evaluate(() => window.__lat.byName)) }
  })
}

const treeRow = (p) => `aside [role=tree] [data-tree-path="${p}"] > button`
async function reveal(s, p) {
  const parts = p.split("/")
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join("/")
    if (!(await s.page.locator(treeRow(p)).count())) {
      const row = s.page.locator(`aside [role=tree] [data-tree-path="${dir}"] > button`).first()
      if (await row.count()) { await row.click(); await wait(300) }
    }
  }
  await s.page.locator(treeRow(p)).first().scrollIntoViewIfNeeded()
}
/** A click as a person makes one: the pointer rests on it a moment (as it moves there), then a press. */
async function press(s, sel, middle) {
  await s.page.hover(sel)
  await wait(120)
  await s.page.click(sel, { delay: 50, button: middle ? "middle" : "left" })
}

async function run(n) {
  // (each run from one tab in one pane: the last run's tabs and splits are kept in the workspace's file)
  const one = { root: { id: "g0", tabs: [{ id: "tlat0", to: `file:${name(1)}` }], active: "tlat0" } }
  await api("PUT", "workspaces/1", { layout: one, focus: "g0" })
  await wait(500)
  const s = await session()
  const r = {}
  r.coldLoad = await load(s, false)
  r.warmLoad = await load(s, true)
  if (ONLY === "load") { await s.ctx.close(); console.log(`run ${n + 1}/${RUNS} done`); return r }

  // Typing in the middle of a long note.
  await s.page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, LONG)
  await until(() => s.page.evaluate(() => window.__lat.shows("Section 0")), 15000)
  await quiet(s)
  check("the cursor put in the middle of the long note", await cursorTo(s, 0.5))
  r.typing = await typing(s, "typing")
  await wait(1500) // (its autosave)

  if (!PHONE) {
    // Opening files from the explorer: ones not opened this session, then the same again.
    await reveal(s, name(2))
    const fresh = [], again = []
    for (const i of [2, 3, 4, 5, 6]) fresh.push(await step(s, "open", () => press(s, treeRow(name(i))), (m) => window.__lat.shows(m), `Marker ${i} lighthouse`))
    for (const i of [2, 3, 4, 5, 6]) again.push(await step(s, "openAgain", () => press(s, treeRow(name(i))), (m) => window.__lat.shows(m), `Marker ${i} lighthouse`))
    r.open = combine(fresh)
    r.openAgain = combine(again)

    // Tabs: four, opened with a middle click, then switched between by clicking them.
    for (const i of [7, 8, 9]) { await press(s, treeRow(name(i)), true); await wait(400) }
    // (each tab's note by its label: done when its text is drawn)
    const tabs = await s.page.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((e) => [e.dataset.tabId, /Note (\d+)/.exec(e.textContent)?.[1]]))
    const sw = []
    for (let k = 0; k < 8 && tabs.length > 1; k++) {
      const [id, num] = tabs[(k + 1) % tabs.length]
      sw.push(await step(s, "tabs", () => press(s, `[data-tab-bar] [data-tab-id="${id}"]`),
        ([tid, m]) => !!document.querySelector(`[data-tab-bar] [data-tab-id="${tid}"] [aria-selected=true]`) && (!m || window.__lat.shows(m)),
        [id, num ? `Marker ${Number(num)} lighthouse` : null]))
    }
    r.tabs = combine(sw)
    r.tabCount = tabs.length

    // Panes: split right, then clicks between the two panes' editors.
    await s.page.keyboard.press("ControlOrMeta+Alt+\\")
    await wait(800)
    const panes = await s.page.$$eval("[data-pane]", (els) => els.filter((e) => e.getClientRects().length).map((e, i) => { e.setAttribute("data-lat-pane", String(i)); return i }))
    const pp = []
    for (let k = 0; k < 4 && panes.length > 1; k++) {
      const i = k % 2 ? 0 : 1
      pp.push(await step(s, "panes", () => press(s, `[data-lat-pane="${i}"] .cm-content`),
        (j) => !!document.activeElement?.closest(`[data-lat-pane="${j}"]`), i))
    }
    r.panes = combine(pp)
    r.paneCount = panes.length

    // The left sidebar hidden, then shown again.
    const sb = []
    for (let k = 0; k < 2; k++) {
      sb.push(await step(s, "sidebar", () => s.page.keyboard.press("ControlOrMeta+\\"), () => !document.querySelector("aside [role=tree]")))
      sb.push(await step(s, "sidebar", () => s.page.keyboard.press("ControlOrMeta+\\"), () => !!document.querySelector("aside [role=tree]")))
    }
    r.sidebar = combine(sb)

    // A folder of 600 notes in the file explorer opened, then closed.
    await reveal(s, MANY)
    const big = await s.page.locator(treeRow(MANY)).count() ? MANY : null
    if (big) {
      const fo = []
      const open = () => !!document.querySelector('aside [role=tree] [data-tree-path^="Latency/Many/"]')
      if (await s.page.evaluate(open)) { await press(s, treeRow(big)); await wait(300) } // (open from the last run)
      for (let k = 0; k < 2; k++) {
        fo.push(await step(s, "folder", () => press(s, treeRow(big)), () => document.querySelectorAll('aside [role=tree] [data-tree-path^="Latency/Many/"]').length > 20))
        await step(s, "folderClose", () => press(s, treeRow(big)), () => !document.querySelector('aside [role=tree] [data-tree-path^="Latency/Many/"]'))
      }
      r.folder = combine(fo)
    }

    // The command palette: opened, a query typed, closed.
    const pal = [], palType = []
    for (let k = 0; k < 3; k++) {
      check("the cursor put in the middle of the long note", await cursorTo(s, 0.5))
      pal.push(await step(s, "palette", () => s.page.keyboard.press("ControlOrMeta+p"), () => !!document.querySelector("[role=dialog] [role=option]")))
      palType.push(await step(s, "paletteType", () => s.page.keyboard.type("split", { delay: 60 }), () => [...document.querySelectorAll("[role=dialog] [role=option]")].some((o) => /split/i.test(o.textContent))))
      await s.page.keyboard.press("Escape")
    }
    r.palette = combine(pal)
    r.paletteType = combine(palType)
  }

  // The quick switcher: opened, a name typed.
  const qs = [], qsType = []
  for (let k = 0; k < 3; k++) {
    await quiet(s)
    qs.push(await step(s, "switcher", () => s.page.keyboard.press("ControlOrMeta+o"), () => !!document.querySelector("[role=dialog] input[role=combobox]")))
    qsType.push(await step(s, "switcherType", () => s.page.keyboard.type("note 07", { delay: 60 }), () => [...document.querySelectorAll("[role=dialog] [role=option]")].some((o) => /Note 07/.test(o.textContent))))
    await s.page.keyboard.press("Escape")
  }
  r.switcher = combine(qs)
  r.switcherType = combine(qsType)

  await s.ctx.close()
  console.log(`run ${n + 1}/${RUNS} done`)
  return r
}

const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await run(i))
const result = {}
for (const k of Object.keys(runs[0])) result[k] = typeof runs[0][k] === "object" && runs[0][k] ? combine(runs.map((r) => r[k])) : median(runs.map((r) => r[k]))

const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")) : null
for (const [k, v] of Object.entries(result)) {
  if (!v || typeof v !== "object") { console.log(`${k}: ${v}`); continue }
  const { census, ...nums } = v
  const row = Object.entries(nums).map(([m, x]) => {
    const b = before?.[k]?.[m]
    const r1 = (y) => (typeof y === "number" ? Math.round(y * 10) / 10 : y)
    return `${m} ${r1(x)}${typeof b === "number" ? ` (was ${r1(b)})` : ""}`
  })
  console.log(`\n${k}: ${row.join(", ")}${census ? `\n  rendered: ${census}` : ""}`)
}
if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`)
if (profiled) {
  const file = path.resolve(`latency-${PROFILE}.cpuprofile`)
  fs.writeFileSync(file, JSON.stringify(profiled))
  // Self time by function, from the samples.
  const self = new Map(), byId = new Map(profiled.nodes.map((nd) => [nd.id, nd]))
  const dt = (profiled.endTime - profiled.startTime) / 1000 / Math.max(1, profiled.samples.length)
  for (const id of profiled.samples) {
    const f = byId.get(id).callFrame
    const key = `${f.functionName || "(anonymous)"} ${f.url ? `${f.url.split("/").pop()}:${f.lineNumber + 1}` : ""}`
    self.set(key, (self.get(key) ?? 0) + dt)
  }
  console.log(`\nCPU profile of ${PROFILE}: ${file}`)
  for (const [k, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${ms.toFixed(1).padStart(8)} ms  ${k}`)
}
check("every interaction finished", Object.values(result).every((v) => v === null || typeof v !== "object" || !("ms" in v) || v.ms !== null))
await done()
