// The app's side of Activity in every window's background: what the user opens, runs and drops (batched every 3 s)
// and how fast this window is (every minute). Nothing here may throw into the app: every callback is guarded.
import { useEffect } from "react"
import { appDevice as DEVICE, getTabLayout, onActivity, onTabLayoutChange, type TabLayout } from "@vaultite"

type Note = { action: string; text: string; paths?: string[]; t: number }

const SEND_EVERY = 3000
const PERF_EVERY = 60_000
const SETTLE = 800 // a tab has to stay focused this long to count as opened

const safe = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { try { f(...a) } catch { /* never into the app */ } }

function send(path: string, body: unknown, keepalive = false) {
  return fetch(`api/${path}`, {
    method: "POST", keepalive,
    headers: { "Content-Type": "application/json", "X-Vaultite-Client": `app/${DEVICE}` },
    body: JSON.stringify(body),
  }).then(() => undefined, () => undefined)
}

/** The focused pane's active tab's target ("file:Notes/Idea.md", "view:graph", "settings"). */
function focusedTab(ws: TabLayout): string {
  let found = ""
  const walk = (n: unknown) => {
    const g = n as { id?: string; tabs?: { id: string; to: string }[]; active?: string; kids?: unknown[] }
    if (found || !g) return
    if (Array.isArray(g.tabs)) { if (g.id === ws.focus) found = g.tabs.find((t) => t.id === g.active)?.to ?? "" }
    else g.kids?.forEach(walk)
  }
  walk(ws.root)
  return found
}

const words = (s: string) => s.replace(/[-_]+/g, " ")
/** What opening a tab reads as, or null for nothing worth saying (a blank tab). */
function opened(to: string): Note | null {
  const t = Date.now()
  if (!to || to === "new") return null
  if (to.startsWith("file:")) { const p = to.slice(5); return { action: "open", text: `Opened ${p}`, paths: p.startsWith("/") ? undefined : [p], t } }
  if (to.startsWith("view:")) {
    const [name, ...rest] = to.slice(5).split("/")
    const arg = rest.join("/")
    // A view about a vault file (a file's history): that file is what was opened.
    const file = /\.[a-z0-9]+$/i.test(arg) && !arg.startsWith("/") ? arg : ""
    return { action: "open", text: file ? `Opened ${words(name)} of ${file}` : `Opened ${words(name)} view`, paths: file ? [file] : undefined, t }
  }
  return { action: "open", text: `Opened ${words(to)}`, t }
}

/** An /api/ call's route: the path under /api/ with ids as "*" (words only: /^[a-z][a-z-]*$/, 24 characters at most). */
export function routeOf(url: string): string | null {
  let u: URL
  try { u = new URL(url, location.href) } catch { return null }
  if (u.origin !== location.origin) return null
  const i = u.pathname.indexOf("/api/")
  if (i < 0) return null
  const segs = u.pathname.slice(i + 5).split("/").filter(Boolean)
  if (!segs.length) return null
  return segs.map((s) => (s.length <= 24 && /^[a-z][a-z-]*$/.test(s) ? s : "*")).join("/")
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const r1 = (v: number) => Math.round(v * 10) / 10

function start(): () => void {
  const stops: (() => void)[] = []
  const queue: Note[] = []
  const push = (n: Note) => { if (queue.length < 200) queue.push({ action: n.action, text: n.text, paths: n.paths, t: n.t }) }

  // What's opened: the focused tab, once it has stayed a moment; the same one again isn't news.
  let last = focusedTab(getTabLayout()), timer = 0
  stops.push(onTabLayoutChange(safe(() => {
    clearTimeout(timer)
    timer = window.setTimeout(safe(() => {
      const to = focusedTab(getTabLayout())
      if (to === last) return
      last = to
      const n = opened(to)
      if (n) push(n)
    }), SETTLE)
  })))
  stops.push(() => clearTimeout(timer))
  stops.push(onActivity(safe(push)))

  const flush = (keepalive = false) => {
    if (!queue.length) return
    void send("activity", { device: DEVICE, events: queue.splice(0, queue.length) }, keepalive)
  }
  const sender = setInterval(safe(() => flush()), SEND_EVERY)
  stops.push(() => clearInterval(sender))

  // Timings: API calls by route and long tasks, since the last report.
  const calls = new Map<string, number[]>()
  let stateMs: number | undefined
  let longTasks = 0, longMs = 0, shift = 0, shifts = 0
  const observe = (type: string, fn: (e: PerformanceEntry) => void) => {
    try {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return
      const o = new PerformanceObserver(safe((list: PerformanceObserverEntryList) => list.getEntries().forEach(fn)))
      o.observe({ type, buffered: true })
      stops.push(() => o.disconnect())
    } catch { /* not in this browser */ }
  }
  observe("resource", (e) => {
    const r = e as PerformanceResourceTiming
    if (r.initiatorType !== "fetch" && r.initiatorType !== "xmlhttprequest") return
    const route = routeOf(r.name)
    // Activity's own calls (these reports, the feed's polling) aren't the app's work.
    if (!route || route === "activity" || route.startsWith("activity/")) return
    if (route === "state" && stateMs === undefined) stateMs = r.duration
    const xs = calls.get(route) ?? []
    if (xs.length < 1000) xs.push(r.duration)
    calls.set(route, xs)
  })
  observe("longtask", (e) => { longTasks++; longMs += e.duration })
  observe("layout-shift", (e) => {
    const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean }
    if (s.hadRecentInput || s.value < 0.001) return
    shift += s.value; shifts++
  })

  let first = true
  const report = () => {
    if (document.hidden && !first) return
    const body: Record<string, unknown> = { device: DEVICE, longTasks, longMs: r1(longMs), shift: Math.round(shift * 1000) / 1000, shifts }
    if (first) {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
      if (nav) {
        body.ttfb = r1(nav.responseStart - nav.startTime)
        if (nav.domContentLoadedEventEnd) body.ready = r1(nav.domContentLoadedEventEnd - nav.startTime)
        if (nav.loadEventEnd) body.load = r1(nav.loadEventEnd - nav.startTime)
      }
      if (stateMs !== undefined) body.state = r1(stateMs)
    }
    if (calls.size) {
      body.api = [...calls].map(([route, xs]) => ({ route, n: xs.length, p50: r1(median(xs)), max: r1(Math.max(...xs)) }))
        .sort((a, b) => b.max - a.max).slice(0, 40)
    }
    const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory
    if (mem?.usedJSHeapSize) body.heap = r1(mem.usedJSHeapSize / 1048576)
    first = false
    calls.clear(); longTasks = 0; longMs = 0; shift = 0; shifts = 0
    void send("activity/perf", body)
  }
  // Once after load (when the load's timings are in), then every minute.
  const once = window.setTimeout(safe(report), document.readyState === "complete" ? 2000 : 5000)
  const perf = setInterval(safe(report), PERF_EVERY)
  stops.push(() => { clearTimeout(once); clearInterval(perf) })

  // Leaving: what's queued goes now.
  const hide = safe(() => { if (document.visibilityState === "hidden") flush(true) })
  document.addEventListener("visibilitychange", hide)
  stops.push(() => document.removeEventListener("visibilitychange", hide))

  return () => { flush(); for (const s of stops) try { s() } catch { /* gone */ } }
}

export function Report() {
  useEffect(() => { try { return start() } catch { return undefined } }, [])
  return null
}
