import { getStore, onStore } from "@/core/data"
import { trace } from "@/core/trace"

type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] }

function named(n: Node | null | undefined): string {
  if (!(n instanceof Element)) return n ? n.nodeName.toLowerCase() : "?"
  const data = [...n.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).slice(0, 3).join("")
  const cls = typeof n.className === "string" ? n.className.split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join("") : ""
  return `${n.tagName.toLowerCase()}${data}${cls}`.slice(0, 160)
}

const REGIONS: [string, string][] = [
  ["aside[data-side=left]", "left sidebar"], ["aside[data-side=right]", "right sidebar"], ["[data-status-bar]", "status bar"],
  ["[data-tab-bar], [role=tablist]", "tabs"], ["[data-pane]", "pane"],
]
function regionOf(n: Node | null | undefined): string {
  const el = n instanceof Element ? n : n?.parentElement
  return (el && REGIONS.find(([sel]) => el.closest(sel))?.[1]) || "page"
}

const LOAD_MS = 10_000
const KEPT = "vaultite.loadshifts"
type Load = { at: string; moved: Record<string, number> }
let readyAt = 0
const load: Record<string, number> = {}

function keep() {
  try {
    const all = [...(JSON.parse(localStorage.getItem(KEPT) ?? "[]") as Load[]), { at: new Date().toISOString(), moved: { ...load } }].slice(-30)
    localStorage.setItem(KEPT, JSON.stringify(all))
  } catch { /* private mode, or full */ }
}

globalThis.__vauLoadShifts = () => {
  let loads: Load[] = []
  try { loads = JSON.parse(localStorage.getItem(KEPT) ?? "[]") } catch { /* none kept */ }
  const moved = loads.filter((l) => Object.keys(l.moved).length).length
  return { loads: loads.length, moved, share: loads.length ? Math.round((moved / loads.length) * 100) / 100 : 0, last: loads.slice(-10) }
}

const stop = onStore(() => {
  if (!getStore() || readyAt) return
  readyAt = performance.now()
  setTimeout(keep, LOAD_MS)
  queueMicrotask(stop)
})

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as Shift[]) {
      if (e.hadRecentInput || !e.value) continue
      const ready = !!readyAt && e.startTime >= readyAt
      const regions = [...new Set((e.sources ?? []).map((s) => regionOf(s.node)))]
      if (ready && e.startTime - readyAt < LOAD_MS) for (const r of regions) load[r] = (load[r] ?? 0) + 1
      trace("shift", { value: Math.round(e.value * 1e4) / 1e4, phase: ready ? "ready" : "loading", regions, moved: (e.sources ?? []).map((s) => named(s.node)) })
    }
  }).observe({ type: "layout-shift", buffered: true })
} catch { /* no layout-shift entries here (WebKit) */ }
