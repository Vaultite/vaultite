import { useEffect, useSyncExternalStore, type CSSProperties } from "react"
import { get, op } from "@vaultite"

export type Screen = { lines: Run[][]; cols: number }
export type Run = { text: string; style?: CSSProperties }
type Captured = { text?: string; cols?: number }

const EVERY = 2500, AT_ONCE = 2, AFTER_FAILING = 30_000, LINES = 40, KEPT = 30
type Kept = { screen: Screen | null; at: number; failed: boolean }
const kept = new Map<string, Kept>()
const drawn = new Map<string, number>()
const subs = new Set<() => void>()
const changed = () => subs.forEach((f) => f())
const asking = new Set<string>()
let wanted: string[] = []
let timer = 0

export const paletteBeyondTheme: Record<string, string> = {}

const STYLES = { color: "color", "background-color": "backgroundColor", "font-weight": "fontWeight", "font-style": "fontStyle", opacity: "opacity", "text-decoration-line": "textDecorationLine" } as const

function runOf(text: string, el: Element | null): Run {
  if (!(el instanceof HTMLElement)) return { text }
  const style: CSSProperties = {}
  for (const [css, key] of Object.entries(STYLES)) { const v = el.style.getPropertyValue(css); if (v) style[key] = v }
  return { text, style }
}

export function parseScreen(html: string, cols: number): Screen {
  for (const [, n, c] of html.matchAll(/--vt-palette-(\d+):\s*(#[0-9a-fA-F]{3,8})/g)) if (Number(n) >= 16) paletteBeyondTheme[`--vt-palette-${n}`] = c
  const doc = new DOMParser().parseFromString(html.replace(/<style>[\s\S]*?<\/style>/g, ""), "text/html")
  const lines: Run[][] = [[]]
  for (const node of doc.body.firstElementChild?.childNodes ?? []) {
    const el = node instanceof Element ? node : null
    for (const [i, part] of (node.textContent ?? "").split("\n").entries()) {
      if (i) lines.push([])
      if (part) lines[lines.length - 1].push(runOf(part, el))
    }
  }
  while (lines.length > 1 && !lines[lines.length - 1].some((r) => r.text.trim())) lines.pop()
  return { lines: lines.slice(-LINES), cols }
}

const capture = (id: string) => (id.includes("@")
  ? op<Captured>("terminal.capture", { id, format: "html", lines: LINES })
  : get<Captured>(`terminals/${encodeURIComponent(id)}/capture?format=html&lines=${LINES}`))

function pump() {
  while (asking.size < AT_ONCE && wanted.length) {
    const id = wanted.shift()!
    if (asking.has(id)) continue
    asking.add(id)
    capture(id)
      .then((c) => { kept.set(id, { screen: parseScreen(c.text ?? "", c.cols ?? 80), at: Date.now(), failed: false }) })
      .catch(() => { kept.set(id, { screen: kept.get(id)?.screen ?? null, at: Date.now(), failed: true }) })
      .finally(() => { asking.delete(id); forget(); changed(); pump() })
  }
}

const stale = (id: string, now = Date.now()) => { const k = kept.get(id); return !k || now - k.at >= (k.failed ? AFTER_FAILING : EVERY) }
function want(ids: string[]) {
  wanted = [...wanted, ...ids.filter((id) => !wanted.includes(id) && !asking.has(id))]
  pump()
}

function askStalestDrawn() {
  if (document.visibilityState !== "visible") return
  const now = Date.now()
  want([...drawn.keys()].filter((id) => stale(id, now)).sort((a, b) => (kept.get(a)?.at ?? 0) - (kept.get(b)?.at ?? 0)).slice(0, AT_ONCE))
}

function forget() {
  for (const id of kept.keys()) if (kept.size > KEPT && !drawn.has(id)) kept.delete(id)
}

function draw(id: string) {
  drawn.set(id, (drawn.get(id) ?? 0) + 1)
  if (stale(id)) want([id])
  if (!timer) timer = window.setInterval(askStalestDrawn, EVERY)
  return () => {
    const n = (drawn.get(id) ?? 1) - 1
    if (n) drawn.set(id, n); else drawn.delete(id)
    if (!drawn.size) { clearInterval(timer); timer = 0; wanted = [] }
  }
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

export function useScreen(id: string): Screen | null {
  useEffect(() => draw(id), [id])
  return useSyncExternalStore(subscribe, () => kept.get(id)?.screen ?? null)
}
