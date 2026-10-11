// Layout shifts the user didn't cause (something came in and pushed the page), traced as "shift" with what moved, to
// check that loading surfaces keep their room: `vau dev eval __vauTrace.shift`. Chromium only (the desktop app).
import { trace } from "@/core/trace"

type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node | null }[] }

/** A moved element as a short name: its tag, data-* names and first classes. */
function named(n: Node | null | undefined): string {
  if (!(n instanceof Element)) return n ? n.nodeName.toLowerCase() : "?"
  const data = [...n.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).slice(0, 3).join("")
  const cls = typeof n.className === "string" ? n.className.split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join("") : ""
  return `${n.tagName.toLowerCase()}${data}${cls}`.slice(0, 160)
}

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as Shift[]) {
      if (e.hadRecentInput || e.value < 0.001) continue
      trace("shift", { value: Math.round(e.value * 1e4) / 1e4, moved: (e.sources ?? []).map((s) => named(s.node)) })
    }
  }).observe({ type: "layout-shift", buffered: true })
} catch { /* no layout-shift entries here (WebKit) */ }
