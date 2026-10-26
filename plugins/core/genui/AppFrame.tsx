// An <AppBlock>: the model's HTML and script in an iframe of its own (no origin, no network), as tall as it draws, its
// classes compiled by Tailwind; `__bindings` and `__effect` tie it to the program's state, as in ChatGPT.
import { useEffect, useMemo, useRef, useState } from "react"
import { onLook } from "@vaultite"
import type { Host } from "./parts"

type P = Record<string, unknown>
const isDark = () => document.documentElement.classList.contains("dark")

let tw: Promise<(classes: string[]) => string> | null = null
/** Tailwind's compiler, loaded the first time an app needs it. */
function tailwind() {
  return (tw ??= (async () => {
    const [{ compile }, theme, preflight, utilities] = await Promise.all([
      import("tailwindcss"), import("tailwindcss/theme.css?raw"), import("tailwindcss/preflight.css?raw"), import("tailwindcss/utilities.css?raw"),
    ])
    const files: Record<string, string> = { "tailwindcss/theme.css": theme.default, "tailwindcss/preflight.css": preflight.default, "tailwindcss/utilities.css": utilities.default }
    const c = await compile(
      '@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/preflight.css" layer(base);\n@import "tailwindcss/utilities.css" layer(utilities);\n@custom-variant dark (&:where(.dark, .dark *, [data-theme=dark], [data-theme=dark] *));',
      { loadStylesheet: async (id: string) => ({ path: id, base: "", content: files[id] ?? "" }) },
    )
    return (classes: string[]) => c.build(classes)
  })())
}

/** Every word that could be a class, in its HTML and its script (which may set them). */
const candidates = (html: string) => [...new Set(html.match(/[^\s"'`<>=;{}()]+/g) ?? [])].filter((w) => w.length < 80 && /^[!@\w-]/.test(w))

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; media-src data: blob: https:"
const TOKENS = ["background", "foreground", "card", "muted", "muted-foreground", "border", "primary", "primary-foreground", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "gray", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "font-sans", "font-mono"]

/** The scheme's colours as `--vau-*`, and under the names ChatGPT's apps are written for (its host's: `--text-primary`,
 *  `--main-surface-*`, shadcn's `--background`..., the kit's `--viz-*`), so an app made there takes this look. */
const vars = () => {
  const css = getComputedStyle(document.documentElement)
  const own = Object.fromEntries(TOKENS.map((t) => [t, css.getPropertyValue(`--${t}`).trim()]))
  const v = (t: string) => `var(--vau-${t})`
  const mix = (a: string, n: number, b = "transparent") => `color-mix(in oklab, ${a} ${n}%, ${b})`
  const as: Record<string, string> = {
    "main-surface-primary": v("background"), "main-surface-secondary": mix(v("foreground"), 4, v("background")), "main-surface-tertiary": mix(v("foreground"), 8, v("background")),
    "text-primary": v("foreground"), "text-secondary": v("muted-foreground"), "text-tertiary": mix(v("muted-foreground"), 70), link: v("primary"),
    "border-light": mix(v("foreground"), 8), "border-medium": mix(v("foreground"), 15), "border-heavy": mix(v("foreground"), 25),
    background: v("background"), foreground: v("foreground"), card: v("card"), "card-foreground": v("foreground"), popover: v("card"), "popover-foreground": v("foreground"),
    primary: v("primary"), "primary-foreground": v("primary-foreground"), secondary: mix(v("foreground"), 7), "secondary-foreground": v("foreground"),
    muted: v("muted"), "muted-foreground": v("muted-foreground"), accent: mix(v("foreground"), 7), "accent-foreground": v("foreground"),
    destructive: v("red"), border: v("border"), input: v("border"), ring: v("primary"), radius: "8px",
    blue: v("blue"), green: v("green"), red: v("red"), orange: v("orange"), purple: v("purple"), yellow: v("yellow"), pink: v("pink"), teal: v("teal"),
    "viz-series-1": v("chart-1"), "viz-series-2": v("chart-2"), "viz-series-3": v("chart-3"), "viz-series-4": v("chart-4"), "viz-series-5": v("chart-5"), "viz-series-6": v("purple"),
    "viz-panel": v("card"), "viz-card": mix(v("foreground"), 3, v("card")), "viz-chip-card": mix(v("foreground"), 6, v("card")), "viz-border": v("border"),
    "viz-text": v("foreground"), "viz-muted": v("muted-foreground"), "viz-accent": v("primary"), "viz-accent-bg": mix(v("primary"), 14), "viz-accent-text": v("primary"),
    "font-sans": v("font-sans"), "font-size-base": "16px", "radius-sm": "4px", "radius-md": "6px", "radius-lg": "8px", "radius-xl": "12px", "radius-2xl": "16px",
  }
  return TOKENS.map((t) => `--vau-${t}:${own[t]};`).join("") + Object.entries(as).map(([k, x]) => `--${k}:${x};`).join("")
}

/** ChatGPT's app kit, as its apps expect it: fields, sliders, cards and badges styled; in the dark, Tailwind's light
 *  greys turned to the scheme's surfaces (an app written light still reads). */
const KIT = `
input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea{border:1px solid var(--border-medium);border-radius:12px;background:var(--vau-card);color:inherit;padding:6px 12px;font:inherit;font-size:14px}
input:focus,select:focus,textarea:focus{outline:2px solid color-mix(in oklab,var(--vau-primary) 45%,transparent);outline-offset:0}
button{cursor:pointer}
input[type=range]{accent-color:var(--vau-primary);width:100%}
input[type=checkbox],input[type=radio]{accent-color:var(--vau-primary)}
a{color:var(--link)}
.card,[data-card]{border:1px solid var(--viz-border);border-radius:16px;padding:12px;background:var(--viz-card)}
.metric-card{border-radius:12px;padding:12px;background:var(--viz-chip-card)}
.viz-stat-value{font-size:20px;font-weight:500;font-variant-numeric:tabular-nums}
.viz-badge{display:inline-flex;align-items:center;gap:4px;border-radius:9999px;padding:0 8px;height:20px;font-size:12px;font-weight:500;background:var(--viz-accent-bg);color:var(--viz-accent-text)}
.viz-callout{border-radius:12px;padding:12px;background:var(--viz-accent-bg)}
[data-tooltip]{position:relative}
`
// (unlayered: over Tailwind's own utilities)
const DARK = `
.dark .bg-white,.dark .bg-gray-50,.dark .bg-slate-50,.dark .bg-neutral-50,.dark .bg-zinc-50{background-color:var(--viz-card)}
.dark .bg-gray-100,.dark .bg-slate-100,.dark .bg-neutral-100,.dark .bg-zinc-100{background-color:var(--viz-chip-card)}
.dark .text-black,.dark .text-gray-900,.dark .text-slate-900,.dark .text-gray-800,.dark .text-slate-800,.dark .text-neutral-900,.dark .text-zinc-900{color:var(--text-primary)}
.dark .text-gray-700,.dark .text-gray-600,.dark .text-slate-600,.dark .text-gray-500,.dark .text-slate-500,.dark .text-neutral-500,.dark .text-zinc-500{color:var(--text-secondary)}
.dark .border-gray-200,.dark .border-gray-100,.dark .border-slate-200,.dark .border-gray-300,.dark .border-neutral-200,.dark .border-zinc-200{border-color:var(--border-light)}
`

// The app's side of the bridge, in the frame: the bindings (setters call back), effects, its height, links.
function bridge() {
  const post = (m: Record<string, unknown>) => parent.postMessage({ ga: 1, ...m }, "*")
  const effects: (() => void)[] = []
  let raw: Record<string, unknown> = {}
  const wrap = (v: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = x && typeof x === "object" && typeof (x as { $fn?: unknown }).$fn === "number" ? (...a: unknown[]) => post({ type: "call", fn: (x as { $fn: number }).$fn, args: JSON.parse(JSON.stringify(a)) }) : x
    return out
  }
  const g = globalThis as unknown as Record<string, unknown>
  g.__bindings = {}
  g.__effect = (f: () => void) => { effects.push(f); try { f() } catch (e) { console.error(e) } }
  const genui = new Proxy({}, { get: (_, name) => (...args: unknown[]) => post({ type: "action", name: String(name), args: JSON.parse(JSON.stringify(args ?? [])) }) })
  g.GenUI = genui
  g.openai = { sendFollowUpMessage: (o: { prompt?: string }) => post({ type: "action", name: "issueNewTurn", args: [o?.prompt ?? ""] }), openExternal: (o: { href?: string }) => post({ type: "action", name: "openUrl", args: [o?.href ?? ""] }) }
  addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || e.data.ga !== 1) return
    if (e.data.type === "bind") {
      raw = e.data.bind ?? {}
      g.__bindings = wrap(raw)
      for (const f of effects) { try { f() } catch (err) { console.error(err) } }
    } else if (e.data.type === "theme") {
      document.documentElement.dataset.theme = e.data.dark ? "dark" : "light"
      document.documentElement.classList.toggle("dark", !!e.data.dark)
      document.documentElement.setAttribute("style", e.data.vars)
    }
  })
  let last = 0
  const size = () => { const h = Math.ceil(document.documentElement.getBoundingClientRect().height); if (h !== last) { last = h; post({ type: "height", h }) } }
  new ResizeObserver(size).observe(document.documentElement)
  addEventListener("load", size)
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null
    if (a && /^https?:/i.test(a.href)) { e.preventDefault(); post({ type: "action", name: "openUrl", args: [a.href] }) }
  })
}

export function AppFrame({ p, html, host }: { p: P; html: string; host: Host }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [css, setCss] = useState<string | null>(null)
  const [h, setH] = useState(0)
  const bind = (p.bind && typeof p.bind === "object" ? p.bind : {}) as P
  const bindKey = JSON.stringify(bind)
  useEffect(() => {
    let live = true
    tailwind().then((build) => { if (live) setCss(build(candidates(html))) }).catch(() => { if (live) setCss("") })
    return () => { live = false }
  }, [html])
  const doc = useMemo(() => css === null ? "" : `<!doctype html><html data-theme="${isDark() ? "dark" : "light"}" class="${isDark() ? "dark" : ""}" data-app-block-surface="inline" style="${vars().replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width">` +
    `<style>${css}\n@layer base{${KIT}}\n${DARK}\nhtml,body{background:transparent;margin:0;color:var(--vau-foreground);font-family:var(--vau-font-sans),system-ui,sans-serif;font-size:15px;color-scheme:${isDark() ? "dark" : "light"}}body{overflow:hidden}</style>` +
    `<script>(${bridge.toString()})()</script></head><body>${html}</body></html>`, [css, html])
  // Its bindings: sent once it's up and whenever they change.
  const send = () => frame.current?.contentWindow?.postMessage({ ga: 1, type: "bind", bind: JSON.parse(bindKey) }, "*")
  useEffect(send, [bindKey])
  useEffect(() => onLook(() => frame.current?.contentWindow?.postMessage({ ga: 1, type: "theme", dark: isDark(), vars: vars() }, "*")), [])
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || e.data.ga !== 1) return
      const d = e.data
      if (d.type === "height" && typeof d.h === "number") setH(Math.min(4000, d.h))
      else if (d.type === "call" && typeof d.fn === "number") host.call(d.fn, Array.isArray(d.args) ? d.args : [])
      else if (d.type === "action" && typeof d.name === "string") host.action(d.name, Array.isArray(d.args) ? d.args : [])
    }
    addEventListener("message", on)
    return () => removeEventListener("message", on)
  }, [host])
  if (!doc) return <div className="h-40 animate-pulse rounded-[12px] bg-foreground/[0.04]" />
  return (
    <iframe ref={frame} srcDoc={doc} sandbox="allow-scripts" title={typeof p.title === "string" ? p.title : "Interactive view"}
      onLoad={send} referrerPolicy="no-referrer" className="block w-full border-0 bg-transparent"
      style={{ height: h || 160, colorScheme: isDark() ? "dark" : "light" }} />
  )
}
