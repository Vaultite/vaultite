import { useEffect } from "react"
import { appDevice as DEVICE, focusedPane, getTabLayout, shownTab, onActivity, onTabLayoutChange, onTrace, takeSpans, type TabLayout } from "@vaultite"

import type { ClientPerf } from "./model"

type Note = { action: string; text: string; paths?: string[]; t: number }

const SEND_EVERY = 3000
const PERF_EVERY = 60_000
const SETTLE = 800

const safe = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { try { f(...a) } catch {} }

function send(path: string, body: unknown, keepalive = false) {
  const text = JSON.stringify(body)
  // (keepalive takes 64 KB at most: a bigger batch is a plain request)
  return fetch(`api/${path}`, {
    method: "POST", keepalive: keepalive && text.length < 60_000,
    headers: { "Content-Type": "application/json", "X-Vaultite-Client": `app/${DEVICE}` },
    body: text,
  }).then(() => undefined, () => undefined)
}

function focusedTab(ws: TabLayout): string {
  const t = shownTab(ws)
  return t ? focusedPane(t).to : ""
}

const words = (s: string) => s.replace(/[-_]+/g, " ")
function opened(to: string): Note | null {
  const t = Date.now()
  if (!to || to === "new") return null
  if (to.startsWith("file:")) { const p = to.slice(5); return { action: "open", text: `Opened ${p}`, paths: p.startsWith("/") ? undefined : [p], t } }
  if (to.startsWith("view:")) {
    const [name, ...rest] = to.slice(5).split("/")
    const arg = rest.join("/")
    const file = /\.[a-z0-9]+$/i.test(arg) && !arg.startsWith("/") ? arg : ""
    return { action: "open", text: file ? `Opened ${words(name)} of ${file}` : `Opened ${words(name)} view`, paths: file ? [file] : undefined, t }
  }
  return { action: "open", text: `Opened ${words(to)}`, t }
}

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
    if (!(e instanceof PerformanceResourceTiming)) return
    const r = e
    if (r.initiatorType !== "fetch" && r.initiatorType !== "xmlhttprequest") return
    const route = routeOf(r.name)
    if (!route || route === "activity" || route.startsWith("activity/")) return
    if (route === "state" && stateMs === undefined) stateMs = r.duration
    const xs = calls.get(route) ?? []
    if (xs.length < 1000) xs.push(r.duration)
    calls.set(route, xs)
  })
  observe("longtask", (e) => { longTasks++; longMs += e.duration })
  observe("layout-shift", (e) => {
    if (!("value" in e) || typeof e.value !== "number" || ("hadRecentInput" in e && e.hadRecentInput) || e.value < 0.001) return
    shift += e.value; shifts++
  })

  let first = true
  const report = () => {
    if (document.hidden && !first) return
    const body: Partial<ClientPerf> = { device: DEVICE, longTasks, longMs: r1(longMs), shift: Math.round(shift * 1000) / 1000, shifts }
    if (first) {
      const nav = performance.getEntriesByType("navigation")[0]
      if (nav instanceof PerformanceNavigationTiming) {
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
    const mem = "memory" in performance ? performance.memory : null
    const used = mem && typeof mem === "object" && "usedJSHeapSize" in mem ? mem.usedJSHeapSize : 0
    if (typeof used === "number" && used) body.heap = r1(used / 1048576)
    first = false
    calls.clear(); longTasks = 0; longMs = 0; shift = 0; shifts = 0
    void send("activity/perf", body)
  }
  let spanTimer = 0
  stops.push(onTrace(safe((topic: string) => {
    if (topic !== "span" || spanTimer) return
    spanTimer = window.setTimeout(safe(() => { spanTimer = 0; void send("activity/perf", { device: DEVICE, spans: takeSpans() }) }), 1000)
  })), () => clearTimeout(spanTimer))

  const once = window.setTimeout(safe(report), document.readyState === "complete" ? 2000 : 5000)
  const perf = setInterval(safe(report), PERF_EVERY)
  stops.push(() => { clearTimeout(once); clearInterval(perf) })

  const hide = safe(() => { if (document.visibilityState === "hidden") flush(true) })
  document.addEventListener("visibilitychange", hide)
  stops.push(() => document.removeEventListener("visibilitychange", hide))

  return () => { flush(); for (const s of stops) try { s() } catch {} }
}

export function Report() {
  useEffect(() => { try { return start() } catch { return undefined } }, [])
  return null
}
