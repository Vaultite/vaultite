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
      '@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/preflight.css" layer(base);\n@import "tailwindcss/utilities.css" layer(utilities);\n@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));',
      { loadStylesheet: async (id: string) => ({ path: id, base: "", content: files[id] ?? "" }) },
    )
    return (classes: string[]) => c.build(classes)
  })())
}

/** Every word that could be a class, in its HTML and its script (which may set them). */
const candidates = (html: string) => [...new Set(html.match(/[^\s"'`<>=;{}()]+/g) ?? [])].filter((w) => w.length < 80 && /^[!@\w-]/.test(w))

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; media-src data: blob: https:"
const TOKENS = ["background", "foreground", "card", "muted", "muted-foreground", "border", "primary", "primary-foreground", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "gray", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "font-sans", "font-mono"]

const vars = () => {
  const css = getComputedStyle(document.documentElement)
  return TOKENS.map((t) => `--vau-${t}:${css.getPropertyValue(`--${t}`).trim()};`).join("")
}

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
  const doc = useMemo(() => css === null ? "" : `<!doctype html><html data-theme="${isDark() ? "dark" : "light"}" style="${vars()}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width">` +
    `<style>${css}\nhtml,body{background:transparent;margin:0;color:var(--vau-foreground);font-family:var(--vau-font-sans),system-ui,sans-serif;font-size:15px;color-scheme:${isDark() ? "dark" : "light"}}body{overflow:hidden}</style>` +
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
