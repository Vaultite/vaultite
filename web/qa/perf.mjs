// Web app benchmark: how fast the app loads and answers, on a desktop and on a phone, in times and in counts (requests,
// bytes, React commits, components rendered) so a change can be compared with the build before it.
//   node web/qa/perf.mjs <base url> [<another base url>...] [--runs 3] [--only desktop|phone] [--no-interactions]
//                        [--out result.json] [--compare before.json] [--census]
// With several base URLs (the build before a change on one server, after it on another), runs alternate between them
// (A, B, A, B...), so both see the same machine, and the table compares each with the first; --compare compares with
// an earlier result's first server instead.
// Profiles: desktop (1440x900, no throttling) and phone (390x844, touch, CPU 4x slower, ~40 ms RTT and 20 Mbps: an
// iPhone over Tailscale; its requests carry a proxy's header, so the server compresses and gives ETags as it does there). Each run is a new browser context: a cold load (empty cache and localStorage), then a warm
// load (the same context reloaded), then the interactions, each measured from its input event to the next frame after
// what it waits for is on screen:
//   pages      switching pinned pages (the sidebar's rows on desktop, the drawer's on phones, opened before the timed
//              press): two dashboards (Health and
//              Learning when they're there), then back
//              (jumps: the layout shifts it made, input or not: a page that grows as its blocks' data comes in)
//   open note  a note opened in the editor (live preview), until its lines are drawn
//   typing     50 characters typed at its end: per keystroke latency (keydown to the next frame) and React commits and
//              components rendered per keystroke; then what the autosave and the live refresh after it cost
//   typingLive typing again while another file changes behind the app's back: the keystrokes' latency meanwhile
//   switcher   the quick switcher (Mod+O) opened, then a query typed into it
//   person     People, then a person opened from it (in a tab beside it, on phones too)
//   live       a file changed behind the app's back (as Claude would): what the app refetches and redraws
//   liveSetting  the same for a plugin's settings (.vaultite/plugins/graph/data.json), the kind of hidden file devices
//              and the app itself write often
//   liveNote, livePerson, liveWorkspaces  the same for a note's text edited, a line added to a person's timeline, and
//              the workspace the page is on (made with Ctrl+1) renamed: Workspaces' file, written on every tab change
//              (live steps also count the API's bytes once decoded, and the time parsing the state it was sent takes on
//              that page: stateParseMs)
// Load metrics: TTFB, FCP, LCP, ready (the first page's heading and its dashboard grid drawn), complete (the last DOM
// change before the page went quiet), long tasks and total blocking time (FCP to complete), CLS, requests (by type,
// API vs assets, and on the wire bytes; those done before ready), decoded JS (all, and before ready) and CSS, JS heap, script/layout/style time (Chrome's Performance
// metrics) and React commits (a stand-in React DevTools hook counts commits and the components each one rendered; with
// --census the busiest components per step are listed too).
// Every number is the median over the runs. Timings on a busy machine are noisy: compare servers in one run (above),
// and lean on the counts and on CPU time (scriptMs, taskMs) more than on wall-clock times.
// WRITES to the vault: types into the first note in Notes/, writes "Perf live <time>.md" and "Perf typing <time>.md" at
// the top of the vault (left there), changes the Graph plugin's colouring (then puts it back), adds a line to that note
// and to a person's timeline, and makes workspace 1: throwaway server only.
import fs from "node:fs"
import { launch, wait, workspaceKey } from "./lib/qa.mjs"

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const flag = (name) => args.includes(`--${name}`)
const BASES = (args.filter((a) => /^https?:/.test(a)).length ? args.filter((a) => /^https?:/.test(a)) : [process.env.QA_BASE ?? "http://127.0.0.1:8793/"])
  .map((b) => b.replace(/\/?$/, "/"))
const RUNS = Number(opt("runs", "3")), OUT = opt("out", ""), COMPARE = opt("compare", ""), ONLY = opt("only", "")
const INTERACT = !flag("no-interactions"), CENSUS = flag("census")

const PROFILES = {
  desktop: { ctx: { viewport: { width: 1440, height: 900 } } },
  phone: {
    // (through a proxy's header, like Tailscale Serve's: the server compresses and gives ETags as it does for a phone)
    ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, extraHTTPHeaders: { "X-Forwarded-For": "100.64.0.2" } },
    cpu: 4, net: { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 10e6 / 8 },
  },
}

// ---------- in the page, before the app's scripts ----------
// Commits and components rendered, through a stand-in for React DevTools' global hook (React calls it after every
// commit). A component rendered in a commit is one whose fiber has React's PerformedWork flag; subtrees React bailed
// out of (the child pointer unchanged) aren't walked, so counting costs about what the commit did.
const INIT = `(() => {
  const P = window.__perf = { commits: 0, rendered: 0, byName: {}, census: ${CENSUS}, cls: 0, lcp: 0, longtasks: [], lastMutation: 0, keys: [] }
  const COMP = new Set([0, 1, 11, 14, 15]) // function, class, forwardRef, memo, simple memo
  const named = (t) => t && (t.displayName || t.name)
  const nameOf = (f) => { const t = f.type; return (t && (named(t) || named(t.type) || named(t.render))) || "anonymous" } // (memo, forwardRef)
  const count = (f) => { P.rendered++; if (P.census) { const n = nameOf(f); P.byName[n] = (P.byName[n] || 0) + 1 } }
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
  const observe = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }) } catch {} }
  observe("layout-shift", (e) => { if (!e.hadRecentInput) P.cls += e.value; P.jumps = (P.jumps || 0) + e.value })
  observe("largest-contentful-paint", (e) => { P.lcp = e.startTime })
  observe("longtask", (e) => { P.longtasks.push([e.startTime, e.duration]) })
  new MutationObserver(() => { P.lastMutation = performance.now() })
    .observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
  // Live changes the server pushed (/api/events): a step can wait for one.
  P.changes = 0
  const WS = window.WebSocket
  window.WebSocket = class extends WS {
    constructor(...a) { super(...a); this.addEventListener("message", (e) => { if (String(e.data).includes('"change"')) P.changes++ }) }
  }
  // The next frame after now: a rAF, then a task (so that frame's paint is done).
  P.nextPaint = () => new Promise((r) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => r(performance.now()); c.port2.postMessage(0) }))
  // Keystrokes: keydown to the next frame.
  addEventListener("keydown", (e) => { const t = e.timeStamp; P.nextPaint().then((n) => P.keys.push(n - t)) }, true)
  // Input events, so a step can be timed from the one that started it.
  for (const type of ["pointerdown", "keydown", "click"]) addEventListener(type, (e) => { P.input ??= e.timeStamp }, true)
  // Resolves with the time of the next frame after cond() first holds (checked every frame).
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
  // The app is ready when the page it opened has its heading and a dashboard grid with something in it.
  P.ready = null
  const isReady = () => !!document.querySelector("h1") && !!document.querySelector('[class~="@container"] > .grid > *')
  const check = () => { if (P.ready === null && isReady()) { P.nextPaint().then((t) => { P.ready ??= t }) ; return } if (P.ready === null) requestAnimationFrame(check) }
  requestAnimationFrame(check)
})()`

// ---------- helpers ----------
const median = (xs) => { const s = xs.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null }
const api = async (B, method, p, body) => {
  const r = await fetch(new URL(`api/${p}`, B), { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
  return r.json()
}

/** Requests the page makes (CDP): count, type, bytes on the wire; in flight. */
function tracker(cdp) {
  const reqs = new Map()
  let ws = 0
  cdp.on("Network.requestWillBeSent", (e) => {
    if (e.request.url.startsWith("data:")) return
    reqs.set(e.requestId, { id: e.requestId, url: e.request.url, method: e.request.method, type: e.type ?? "Other", done: false, bytes: 0, decoded: 0, status: 0, cached: false })
  })
  cdp.on("Network.requestServedFromCache", (e) => { const r = reqs.get(e.requestId); if (r) r.cached = true })
  cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.cached ||= !!e.response.fromDiskCache } })
  cdp.on("Network.dataReceived", (e) => { const r = reqs.get(e.requestId); if (r) r.decoded += e.dataLength })
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.done = true; r.bytes = e.encodedDataLength } })
  cdp.on("Network.loadingFailed", (e) => { const r = reqs.get(e.requestId); if (r) r.done = true })
  cdp.on("Network.webSocketCreated", () => { ws++ })
  return {
    reset() { reqs.clear(); ws = 0 },
    inflight: () => [...reqs.values()].filter((r) => !r.done).length,
    summary() {
      const all = [...reqs.values()]
      const isApi = (r) => new URL(r.url).pathname.includes("/api/")
      const by = {}
      for (const r of all) by[r.type] = (by[r.type] ?? 0) + 1
      return {
        requests: all.length, api: all.filter(isApi).length, assets: all.filter((r) => !isApi(r)).length,
        notModified: all.filter((r) => r.status === 304).length, fromCache: all.filter((r) => r.cached).length,
        bytes: all.reduce((n, r) => n + r.bytes, 0), apiBytes: all.filter(isApi).reduce((n, r) => n + r.bytes, 0),
        apiDecoded: all.filter(isApi).reduce((n, r) => n + r.decoded, 0),
        stateIds: all.filter((r) => /\/api\/state\b/.test(r.url) && r.status === 200).map((r) => r.id),
        websockets: ws, byType: by,
        apiPaths: all.filter(isApi).map((r) => `${r.method} ${decodeURIComponent(new URL(r.url).pathname.replace(/^.*\/api\//, ""))}`),
      }
    },
  }
}

/** Wait until nothing is in flight and the DOM has been still for `quiet` ms (at most `ms`). */
async function settle(page, net, quiet = 500, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const still = await page.evaluate(() => performance.now() - window.__perf.lastMutation)
    if (net.inflight() === 0 && still > quiet) return
    await wait(100)
  }
}

async function perfMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics")
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}

/** Counters before a step, and what they moved by after it. */
async function snapshot(page, cdp) {
  const p = await page.evaluate(() => { const P = window.__perf; return { commits: P.commits, rendered: P.rendered, jumps: P.jumps || 0 } })
  return { ...p, m: await perfMetrics(cdp) }
}
async function delta(page, cdp, before) {
  const after = await snapshot(page, cdp)
  return {
    commits: after.commits - before.commits, rendered: after.rendered - before.rendered, jumps: after.jumps - before.jumps,
    scriptMs: Math.round((after.m.ScriptDuration - before.m.ScriptDuration) * 1000),
    layoutMs: Math.round((after.m.LayoutDuration - before.m.LayoutDuration) * 1000),
    styleMs: Math.round((after.m.RecalcStyleDuration - before.m.RecalcStyleDuration) * 1000),
  }
}
const census = async (page) => {
  if (!CENSUS) return undefined
  const by = await page.evaluate(() => { const b = window.__perf.byName; window.__perf.byName = {}; return b })
  return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n} ${c}`).join(", ")
}
const resetCensus = (page) => page.evaluate(() => { window.__perf.byName = {} })

// ---------- a load ----------
async function load(B, page, cdp, net, reload) {
  net.reset()
  if (reload) await page.reload({ waitUntil: "commit" })
  else await page.goto(B, { waitUntil: "commit" })
  await page.waitForFunction(() => window.__perf?.ready != null, null, { timeout: 60000, polling: 50 })
  await settle(page, net, 700)
  const p = await page.evaluate(() => {
    const P = window.__perf, nav = performance.getEntriesByType("navigation")[0]
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null
    const complete = Math.max(P.ready, P.lastMutation)
    const tasks = P.longtasks.filter(([s]) => s < complete)
    const res = performance.getEntriesByType("resource")
    const size = (re, until = Infinity) => res.filter((r) => re.test(new URL(r.name).pathname) && r.responseEnd <= until).reduce((n, r) => n + r.decodedBodySize, 0)
    return {
      ttfb: nav.responseStart, fcp, lcp: P.lcp || null, ready: P.ready, complete, dcl: nav.domContentLoadedEventEnd,
      longTasks: tasks.length, longTaskMs: tasks.reduce((n, [, d]) => n + d, 0),
      tbt: tasks.filter(([s]) => fcp === null || s >= fcp).reduce((n, [, d]) => n + Math.max(0, d - 50), 0),
      cls: P.cls, commits: P.commits, rendered: P.rendered, jsKB: size(/\.m?js$/) / 1024, jsReadyKB: size(/\.m?js$/, P.ready) / 1024,
      cssKB: size(/\.css$/) / 1024, requestsReady: res.filter((r) => r.responseEnd <= P.ready).length,
    }
  })
  const m = await perfMetrics(cdp)
  return {
    ...p, ...net.summary(), heapMB: m.JSHeapUsedSize / 1e6, scriptMs: m.ScriptDuration * 1000, layoutMs: m.LayoutDuration * 1000,
    styleMs: m.RecalcStyleDuration * 1000, taskMs: m.TaskDuration * 1000, nodes: m.Nodes, census: await census(page),
  }
}

// ---------- interactions ----------
/** Run `act`, time from its first input event (or from `act` itself when it has none) to the next frame after `cond`
 *  holds, then let the page settle; with what it cost. `cond` runs in the page. */
async function step(page, cdp, net, act, cond, arg, quiet = 500, linger = 0) {
  await settle(page, net, 300)
  await resetCensus(page)
  const before = await snapshot(page, cdp)
  net.reset()
  const start = await page.evaluate(() => { window.__perf.input = null; window.__perf.keys = []; return performance.now() })
  const done = page.evaluate(([c, a]) => window.__perf.until(new Function("arg", `return (${c})(arg)`).bind(null, a)), [cond.toString(), arg])
  await act()
  const end = await done
  const from = await page.evaluate((s) => window.__perf.input ?? s, start)
  const ms = end === null ? null : end - from
  await wait(linger) // (what may still start after it: the store reloads at most once a second)
  await settle(page, net, quiet)
  const d = await delta(page, cdp, before)
  const n = net.summary()
  // What parsing the state the app was sent costs, on this page (the phone's CPU is throttled): its bodies parsed again.
  let stateParseMs = 0
  for (const requestId of n.stateIds) {
    try {
      const { body } = await cdp.send("Network.getResponseBody", { requestId })
      stateParseMs += await page.evaluate((t) => { const s = performance.now(); JSON.parse(t); return performance.now() - s }, body)
    } catch { /* gone from the browser's buffer */ }
  }
  return { ms, ...d, requests: n.requests, apiRequests: n.api, apiBytes: n.apiBytes, apiDecoded: n.apiDecoded, stateParseMs,
    apiPaths: n.apiPaths, census: await census(page) }
}

/** A click the way a person makes one: the pointer rests on it a moment, then a press of about 60 ms (the step is timed
 *  from the press). */
async function press(page, sel) {
  await page.hover(sel)
  await wait(150)
  await page.click(sel, { delay: 60 })
}

/** Phones: the pinned pages are in the left drawer, drawn only while it's out. Open it (untimed) and wait for its rows. */
async function openDrawer(page) {
  await page.click("[data-phone-header] button[aria-label='Open sidebar']")
  await page.waitForSelector("[data-phone-drawer=left] [data-pin]")
  await wait(350) // its slide
}
/** A pinned page's row: the sidebar's (desktop) or the drawer's (phones). */
const pinSel = (phone, path) => (phone ? `[data-phone-drawer=left] [data-pin="${path}"]` : `aside [data-pin="${path}"]`)

async function interactions(B, page, cdp, net, phone, subjects) {
  const out = {}
  // Pages: through the sidebar (desktop) or the phone's drawer.
  const pages = []
  // Two dashboards the sidebar (or the drawer) has, Health and Learning when they're there, then back to the first.
  if (phone) await openDrawer(page)
  const shown = await page.evaluate((phone) => [...document.querySelectorAll(phone ? "[data-phone-drawer=left] [data-pin]" : "aside [data-pin]")]
    .map((e) => e.dataset.pin).filter((p) => p.startsWith("Dashboards/")), phone)
  if (phone) { await page.keyboard.press("Escape"); await wait(350) }
  const others = shown.filter((p) => p !== subjects.first)
  const two = [...new Set([...others.filter((p) => /\/(Health|Learning)\.md$/.test(p)), ...others])].slice(0, 2)
  for (const path of [...two, subjects.first]) {
    const name = path.split("/").pop().replace(/\.md$/, "")
    const cond = (n) => [...document.querySelectorAll("h1")].some((h) => h.textContent.trim() === n && h.getClientRects().length) && !!document.querySelector('[class~="@container"] > .grid > *')
    if (phone) await openDrawer(page)
    pages.push(await step(page, cdp, net, () => press(page, pinSel(phone, path)), cond, name))
  }
  out.pages = combine(pages)

  // A note in the editor (live preview on both), then typing at its end.
  await page.evaluate(() => { localStorage.setItem("vaultite.fileMode", "live") })
  const note = subjects.note
  out.openNote = await step(page, cdp, net,
    () => page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, note),
    () => document.querySelectorAll(".cm-content .cm-line").length > 2)
  await page.click(".cm-content")
  await page.keyboard.press(phone ? "ControlOrMeta+ArrowDown" : "ControlOrMeta+ArrowDown")
  await page.keyboard.press("End")
  await settle(page, net, 300)
  const text = " the quick brown fox jumps over the lazy dog again"
  await resetCensus(page)
  let before = await snapshot(page, cdp)
  await page.evaluate(() => { window.__perf.keys = [] })
  net.reset()
  await page.keyboard.type(text, { delay: 60 })
  await wait(150)
  const keys = await page.evaluate(() => window.__perf.keys)
  let d = await delta(page, cdp, before)
  const typedCensus = await census(page)
  const n = text.length
  // What happens after: the autosave, the live refresh it causes.
  before = await snapshot(page, cdp)
  await wait(700)
  await settle(page, net, 1500)
  const after = await delta(page, cdp, before)
  const sum = net.summary()
  out.typing = {
    keyMs: median(keys), keyP95: pct(keys, 0.95), commitsPerKey: d.commits / n, renderedPerKey: d.rendered / n, scriptMsPerKey: d.scriptMs / n,
    census: typedCensus, saveRequests: sum.requests, saveApiBytes: sum.apiBytes, saveCommits: after.commits, saveRendered: after.rendered,
    savePaths: sum.apiPaths, saveCensus: await census(page),
  }

  // Typing while another file changes (Claude writing): the keystrokes' latency while the app refetches and redraws.
  await page.evaluate(() => { window.__perf.keys = [] })
  const typing = page.keyboard.type(" and more words typed while another file in the vault changes", { delay: 80 })
  await wait(800)
  await fetch(new URL("api/file", B), { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: `Perf typing ${Date.now()}.md`, text: "Written while typing.\n" }) })
  await typing
  const lk = await page.evaluate(() => window.__perf.keys)
  out.typingLive = { keyMs: median(lk), keyP95: pct(lk, 0.95), keyMax: Math.max(...lk) }
  await wait(700)
  await settle(page, net, 1500)

  // The quick switcher, then a query.
  out.switcher = await step(page, cdp, net, () => page.keyboard.press("ControlOrMeta+o"), () => !!document.querySelector('[role="dialog"] input[role="combobox"]'))
  await resetCensus(page)
  before = await snapshot(page, cdp)
  await page.evaluate(() => { window.__perf.keys = [] })
  await page.keyboard.type("light", { delay: 80 })
  await wait(200)
  const qkeys = await page.evaluate(() => window.__perf.keys)
  d = await delta(page, cdp, before)
  out.switcherTyping = { keyMs: median(qkeys), keyP95: pct(qkeys, 0.95), commitsPerKey: d.commits / 5, renderedPerKey: d.rendered / 5, census: await census(page) }
  await page.keyboard.press("Escape")

  // People, then a person from it.
  const people = "Dashboards/People.md"
  if (phone) await openDrawer(page)
  const sel = pinSel(phone, people)
  if (!(await page.$(sel))) { if (phone) await page.keyboard.press("Escape"); await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, people) }
  else await page.click(sel)
  await page.waitForFunction(() => [...document.querySelectorAll("h1")].some((h) => h.textContent.trim() === "People"))
  await settle(page, net, 300)
  const person = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[class~="@container"] button')].find((x) => x.textContent.trim().length > 2 && x.querySelector("svg") && x.closest(".grid"))
    if (!b) return null
    b.setAttribute("data-perf-person", "")
    return b.querySelector(".line-clamp-2")?.textContent.trim() ?? null
  })
  if (person) {
    // (the person's file drawn in a tab beside People, on phones too; its text in the editor)
    out.person = await step(page, cdp, net, () => press(page, "[data-perf-person]"),
      (phone) => (phone ? !document.querySelector("dialog[open]") && !!document.querySelector("main .cm-line") : !!document.querySelector("textarea") && !!document.querySelector(".cm-line")), phone)
    if (phone) { await page.goBack(); await settle(page, net, 300) }
  }

  // A change behind the app's back, on a dashboard.
  if (phone) await openDrawer(page).catch(() => {})
  await page.click(pinSel(phone, subjects.first)).catch(() => {})
  await settle(page, net, 500)
  const stamp = Date.now()
  const seen = await page.evaluate(() => window.__perf.changes)
  out.live = await step(page, cdp, net,
    () => fetch(new URL("api/file", B), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `Perf live ${stamp}.md`, text: `Written at ${stamp}.\n` }) }),
    // (timed to the server's word that it changed; what it cost is what follows, until the page is quiet: the store
    // reloads at most once a second, so a moment longer)
    (n) => window.__perf.changes > n, seen, 500, 1100)
  // A plugin's settings changed behind its back (another device, an AI): the Graph plugin's colouring, then back.
  const setting = await api(B, "GET", "graph/settings")
  out.liveSetting = await step(page, cdp, net,
    () => api(B, "PUT", "graph/settings", { colorBy: setting.colorBy === "type" ? "folder" : "type" }),
    (n) => window.__perf.changes > n, await page.evaluate(() => window.__perf.changes), 500, 1100)
  await api(B, "PUT", "graph/settings", { colorBy: setting.colorBy ?? null })
  // A note's text changed behind the app's back (an AI's edit), a line added to a person's timeline (POST
  // /api/interactions), and the workspace this page is on renamed (Workspaces' file, which every tab change writes).
  const changed = async (act) => {
    await wait(1100) // (the change before it told, and refetched for: the store reloads at most once a second)
    await settle(page, net, 500)
    return step(page, cdp, net, act, (n) => window.__perf.changes > n, await page.evaluate(() => window.__perf.changes), 500, 1100)
  }
  const was = await api(B, "GET", `file?path=${encodeURIComponent(subjects.note)}`)
  out.liveNote = await changed(() => api(B, "PUT", "file", { path: subjects.note, text: `${was.text}\nEdited at ${stamp}.\n`, base: was.text }))
  out.livePerson = await changed(() => api(B, "POST", "interactions", { person: subjects.person, date: "2026-09-30", kind: "note", notes: `Perf ${stamp}` }))
  await page.keyboard.press(workspaceKey(1))
  await settle(page, net, 1500)
  out.liveWorkspaces = await changed(() => api(B, "PUT", "workspaces/1", { name: `Perf ${stamp}` }))
  await api(B, "DELETE", "workspaces/1") // (the next run's page opens on its dashboard, not these tabs)
  return out
}

/** Several steps of one kind: the median of each number (jumps: their sum). */
function combine(steps) {
  const keys = Object.keys(steps[0] ?? {}).filter((k) => typeof steps[0][k] === "number" || steps[0][k] === null)
  const o = Object.fromEntries(keys.map((k) => [k, k === "jumps" ? steps.reduce((n, s) => n + s[k], 0) : median(steps.map((s) => s[k]))]))
  o.census = steps.map((s) => s.census).filter(Boolean).join(" | ") || undefined
  o.apiPaths = steps.flatMap((s) => s.apiPaths ?? [])
  return o
}

// ---------- a run ----------
async function run(browser, B, name, subjects) {
  const prof = PROFILES[name]
  const ctx = await browser.newContext(prof.ctx)
  await ctx.addInitScript(INIT)
  const page = await ctx.newPage()
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e)))
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Performance.enable")
  if (prof.cpu) await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu })
  if (prof.net) await cdp.send("Network.emulateNetworkConditions", prof.net)
  const net = tracker(cdp)
  const cold = await load(B, page, cdp, net, false)
  const warm = await load(B, page, cdp, net, true)
  const inter = INTERACT ? await interactions(B, page, cdp, net, name === "phone", subjects) : {}
  await ctx.close()
  return { cold, warm, ...inter, errors: errs }
}

/** Medians over runs, key by key (nested one level: interactions have their own numbers). */
function medians(runs) {
  const out = {}
  for (const k of Object.keys(runs[0])) {
    const vs = runs.map((r) => r[k])
    if (typeof vs[0] === "number" || vs[0] === null) out[k] = median(vs)
    else if (Array.isArray(vs[0])) out[k] = vs.flat()
    else if (vs[0] && typeof vs[0] === "object") out[k] = medians(vs)
    else out[k] = vs.find(Boolean)
  }
  return out
}

// ---------- report ----------
const ROWS = {
  cold: ["ttfb", "fcp", "lcp", "ready", "complete", "tbt", "longTaskMs", "cls", "requests", "requestsReady", "api", "assets", "bytes", "apiBytes", "jsKB", "jsReadyKB", "cssKB", "heapMB", "scriptMs", "layoutMs", "styleMs", "commits", "rendered", "nodes"],
  warm: ["ttfb", "fcp", "lcp", "ready", "complete", "tbt", "requests", "api", "notModified", "bytes", "scriptMs", "commits", "rendered"],
  pages: ["ms", "commits", "rendered", "scriptMs", "apiRequests", "apiBytes", "jumps"],
  openNote: ["ms", "commits", "rendered", "scriptMs", "apiRequests"],
  typing: ["keyMs", "keyP95", "commitsPerKey", "renderedPerKey", "scriptMsPerKey", "saveRequests", "saveApiBytes", "saveCommits", "saveRendered"],
  typingLive: ["keyMs", "keyP95", "keyMax"],
  switcher: ["ms", "commits", "rendered", "scriptMs"],
  switcherTyping: ["keyMs", "keyP95", "commitsPerKey", "renderedPerKey"],
  person: ["ms", "commits", "rendered", "scriptMs", "apiRequests", "jumps"],
  live: ["commits", "rendered", "scriptMs", "apiRequests", "apiBytes", "apiDecoded", "stateParseMs"],
  liveSetting: ["commits", "rendered", "scriptMs", "apiRequests", "apiBytes", "apiDecoded", "stateParseMs"],
  liveNote: ["commits", "rendered", "scriptMs", "apiRequests", "apiBytes", "apiDecoded", "stateParseMs"],
  livePerson: ["commits", "rendered", "scriptMs", "apiRequests", "apiBytes", "apiDecoded", "stateParseMs"],
  liveWorkspaces: ["commits", "rendered", "scriptMs", "apiRequests", "apiBytes", "apiDecoded", "stateParseMs"],
}
const fmt = (v) => v === null || v === undefined ? "-" : typeof v !== "number" ? String(v) : Math.abs(v) >= 100 ? String(Math.round(v)) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(v % 1 ? 3 : 0)
function table(res, before) {
  const lines = []
  for (const [prof, r] of Object.entries(res.profiles)) {
    for (const [sec, keys] of Object.entries(ROWS)) {
      if (!r[sec]) continue
      lines.push(`\n${prof} · ${sec}`)
      for (const k of keys) {
        const v = r[sec][k], b = before?.profiles?.[prof]?.[sec]?.[k]
        const ratio = typeof v === "number" && typeof b === "number" && v !== 0 ? `  ${(b / v).toFixed(2)}x` : ""
        lines.push(`  ${k.padEnd(16)} ${before ? `${fmt(b).padStart(9)} -> ` : ""}${fmt(v).padStart(9)}${ratio}`)
      }
      if (r[sec].census) lines.push(`  census: ${r[sec].census}`)
      if (sec === "cold" || sec === "warm") lines.push(`  api: ${[...new Set(r[sec].apiPaths)].join(", ")}`)
      if (sec === "typing" || sec.startsWith("live")) lines.push(`  api: ${(r[sec].savePaths ?? r[sec].apiPaths ?? []).join(", ")}`)
    }
  }
  return lines.join("\n")
}

// ---------- main ----------
/** What a server's vault gives the interactions: its first pinned dashboard and a note. */
async function subjectsOf(B) {
  const state = await api(B, "GET", "state")
  const pinned = JSON.parse((await api(B, "GET", `file?path=${encodeURIComponent(".vaultite/pages.json")}`)).text).pinned
  const notes = state.notes.filter((n) => n.id.startsWith("Notes/")).sort((a, b) => a.id.localeCompare(b.id))
  return { first: pinned.find((p) => p.startsWith("Dashboards/")) ?? "Dashboards/Today.md", note: `${notes[0].id}.md`, person: state.people[0]?.name }
}
const browser = await launch()
const targets = await Promise.all(BASES.map(async (base) => ({ base, subjects: await subjectsOf(base), profiles: {}, raw: {} })))
for (const name of Object.keys(PROFILES)) {
  if (ONLY && ONLY !== name) continue
  for (const t of targets) t.raw[name] = []
  for (let i = 0; i < RUNS; i++) {
    for (const t of targets) {
      const r = await run(browser, t.base, name, t.subjects)
      console.error(`${name} run ${i + 1} ${t.base}: ready cold ${fmt(r.cold.ready)} warm ${fmt(r.warm.ready)}${r.errors.length ? `, errors: ${r.errors.join("; ")}` : ""}`)
      t.raw[name].push(r)
    }
  }
  for (const t of targets) t.profiles[name] = medians(t.raw[name])
}
await browser.close()
const result = { date: new Date().toISOString(), runs: RUNS, targets: targets.map(({ subjects: _s, ...t }) => t) }
const earlier = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")) : null
const first = earlier ? (earlier.targets?.[0] ?? earlier) : null
for (const [i, t] of result.targets.entries()) {
  const before = i > 0 ? result.targets[0] : first
  console.log(`\n=== ${t.base}${before ? ` (against ${before.base ?? "the earlier result"})` : ""}`)
  console.log(table(t, before))
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1))
