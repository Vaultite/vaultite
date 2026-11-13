import { getPrefs, onPrefs, type Prefs } from "@/core/prefs"
import { SCHEMES, schemeId } from "@/themes/schemes"
import { signal } from "@/core/signal"
import type { DesktopApi, Translucency } from "@/core/desktop"

type VaultTheme = { name: string; author: string; version: string; modes: ("light" | "dark")[]; mtime: number; problem?: string }
type VaultSnippet = { name: string; mtime: number; path: string }
export type VaultAppearance = { themes: VaultTheme[]; snippets: VaultSnippet[] }

const THEMES = ".vaultite/themes", SNIPPETS = ".vaultite/snippets"
export { SNIPPETS as SNIPPETS_FOLDER, THEMES as THEMES_FOLDER }

let vault: VaultAppearance = { themes: [], snippets: [] }
const subs = signal()

export function setVaultAppearance(next: VaultAppearance | undefined) {
  if (!next || JSON.stringify(next) === JSON.stringify(vault)) return
  vault = next
  apply()
  subs.notify()
}

export const getVaultAppearance = () => vault

export function useVaultAppearance() {
  return subs.use(() => vault)
}

/** The one mode a scheme has, if it has only one (Dracula: dark). */
export function onlyMode(scheme: string): "light" | "dark" | undefined {
  if (scheme.startsWith("theme:")) {
    const t = vault.themes.find((x) => x.name === scheme.slice(6))
    return t && t.modes.length === 1 ? t.modes[0] : undefined
  }
  return SCHEMES.find((s) => s.id === scheme)?.only
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
function family(v: unknown) {
  const s = str(v).replace(/[;{}]/g, "")
  return s && !/[,'"]/.test(s) && /\s/.test(s) ? `"${s}"` : s
}

function syncLinks(kind: string, wanted: { key: string; href: string }[]) {
  const head = document.head
  const have = new Map([...head.querySelectorAll<HTMLLinkElement>(`link[data-vau="${kind}"]`)].map((l) => [l.dataset.key!, l]))
  for (const w of wanted) {
    let l = have.get(w.key)
    have.delete(w.key)
    if (!l) {
      l = document.createElement("link")
      l.rel = "stylesheet"
      l.dataset.vau = kind
      l.dataset.key = w.key
      l.addEventListener("load", lookChanged)
    }
    if (l.getAttribute("href") !== w.href) l.setAttribute("href", w.href)
    head.appendChild(l)
  }
  for (const l of have.values()) l.remove()
}

export const fontStack = (v: unknown, mono = false) => `${family(v)}, ${mono ? "ui-monospace, monospace" : "system-ui, sans-serif"}`

export const DEFAULT_FONTS = {
  ui: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif, 'Noto Color Emoji'",
  code: "ui-monospace, 'SF Mono', Menlo, 'DejaVu Sans Mono', 'Noto Sans Mono', 'Liberation Mono', 'Ubuntu Mono', monospace",
}

const system = matchMedia("(prefers-color-scheme: dark)")
const LOOK = "vaultite.look"
const ROOM = new Set(["--vvh", "--vvtop", "--tab-aspect", "--mto", "--mfrom", "--scrollbar-room", "--window-controls", "--mini-player",
  "--corner-cards", "--trial-bar"])

const looks = new Set<() => void>()
let looking = false
function lookChanged() {
  if (looking) return
  looking = true
  queueMicrotask(() => { looking = false; for (const fn of [...looks]) fn() })
}
/** Calls `fn` whenever the look changes (light or dark, colour scheme, a theme, a snippet, fonts), once it applies:
 *  read the colour tokens again there. Returns a function that stops. */
export function onLook(fn: () => void): () => void {
  looks.add(fn)
  return () => { looks.delete(fn) }
}

export type LookPreview = Partial<Pick<Prefs, "theme" | "scheme" | "density" | "interfaceFont" | "textFont" | "monoFont" | "translucency" | "pageTranslucency">>
let previewing: LookPreview | null = null
export function previewLook(look: LookPreview | null) {
  if (JSON.stringify(previewing) === JSON.stringify(look)) return
  previewing = look
  apply()
}

const glassLevel = (v: unknown) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50
  return n === 50 ? "" : String(n / 50)
}

function apply() {
  const p = { ...getPrefs(), ...previewing }
  const root = document.documentElement
  const scheme = schemeId(str(p.scheme))
  const only = onlyMode(scheme)
  const dark = only ? only === "dark" : p.theme === "dark" || (p.theme === "system" && system.matches)
  root.classList.toggle("dark", dark)
  if (scheme === "default") delete root.dataset.scheme
  else root.dataset.scheme = scheme
  if (p.density === "comfortable") root.dataset.density = "comfortable"
  else delete root.dataset.density
  root.dataset.animation = p.animation === "snappy" || p.animation === "off" ? p.animation : "natural"
  askTranslucent(p.translucent)
  root.toggleAttribute("data-translucent-pages", p.translucent && p.translucentPages)
  root.toggleAttribute("data-dim-panes", p.dimPanes)
  root.toggleAttribute("data-pane-cards", p.paneCards)
  const glass = glassLevel(p.translucency), pageGlass = glassLevel(p.pageTranslucency)
  const look = { dark: only || p.theme !== "system" ? dark : "system", scheme: root.dataset.scheme ?? "", density: root.dataset.density ?? "",
    ...(translucency.on ? { translucent: true, ...(p.translucentPages ? { pages: true } : {}), ...(glass ? { glass } : {}), ...(pageGlass ? { pageGlass } : {}) } : {}) }
  if (previewing === null) try { localStorage.setItem(LOOK, JSON.stringify(look)) } catch { /* private mode */ }
  for (const [k, v] of [["--glass-level", glass], ["--page-glass-level", pageGlass]] as const) {
    if (v) root.style.setProperty(k, v)
    else root.style.removeProperty(k)
  }
  const vars: [string, string][] = [["--font-ui", p.interfaceFont], ["--font-text", p.textFont], ["--font-code", p.monoFont]]
  for (const [k, v] of vars) {
    if (family(v)) root.style.setProperty(k, fontStack(v, k === "--font-code"))
    else root.style.removeProperty(k)
  }
  const on = new Set(Array.isArray(p.snippets) ? p.snippets : [])
  const themes = vault.themes.filter((t) => !t.problem).map((t) => ({ key: t.name, href: `api/themes/${encodeURIComponent(t.name)}.css?v=${t.mtime}` }))
  const snippets = vault.snippets.filter((s) => on.has(s.name)).map((s) => ({ key: s.name, href: `api/snippets/${encodeURIComponent(s.name)}.css?v=${s.mtime}` }))
  const sig = JSON.stringify([themes, snippets])
  if (sig !== linked) { // moving a <link> re-applies its sheet
    linked = sig
    syncLinks("theme", themes)
    syncLinks("snippet", snippets)
  }
  const now = JSON.stringify([look, [...root.style].filter((k) => !ROOM.has(k)).map((k) => `${k}:${root.style.getPropertyValue(k)}`), sig])
  if (now !== applied) { applied = now; lookChanged() }
}
let linked = "", applied = ""

declare const __DEMO_OFFICIAL__: unknown
const demoGlass: DesktopApi["translucent"] = typeof __DEMO_OFFICIAL__ === "undefined" ? undefined : { set: async (on) => ({ on }), on: () => {} }
const native = window.vaultite?.translucent ?? demoGlass
const reduced = matchMedia("(prefers-reduced-transparency: reduce)")
let translucency: Translucency = { on: document.documentElement.hasAttribute("data-translucent") }
let asked: boolean | null = null
const translucencyChanged = signal()
function setTranslucency(t: Translucency) {
  const next = { on: t.on, ...(t.why ? { why: t.why } : {}) }
  if (JSON.stringify(next) === JSON.stringify(translucency)) return
  translucency = next
  document.documentElement.toggleAttribute("data-translucent", next.on)
  apply()
  translucencyChanged.notify()
}
function askTranslucent(want: boolean) {
  const ask = want && !!native && !reduced.matches
  if (ask === asked) return
  asked = ask
  if (!ask) setTranslucency({ on: false, ...(want ? { why: native ? "reduced" as const : "system" as const } : {}) })
  if (native) void native.set(ask).then((t) => { if (ask && asked) setTranslucency(t) }, () => {})
}
native?.on((t) => { if (asked) setTranslucency(t) })
reduced.addEventListener("change", () => askTranslucent(getPrefs().translucent))
export const canTranslucent = !!native
export const getTranslucency = () => translucency
export const onTranslucency = (fn: () => void) => translucencyChanged.subscribe(fn)

const scratch = document.createElement("div").style
const styleLooksChanged = (was: string) => {
  scratch.cssText = was
  const now = document.documentElement.style
  for (const s of [scratch, now]) for (const k of s) if (!ROOM.has(k) && scratch.getPropertyValue(k) !== now.getPropertyValue(k)) return true
  return false
}
new MutationObserver((records) => {
  const root = document.documentElement, seen = new Set<string>()
  for (const r of records) {
    const name = r.attributeName!
    if (seen.has(name)) continue // the first record has the value from before them all
    seen.add(name)
    if (name === "style" ? styleLooksChanged(r.oldValue ?? "") : r.oldValue !== root.getAttribute(name)) { lookChanged(); return }
  }
}).observe(document.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ["class", "data-scheme", "data-density", "style"] })

onLook(() => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
  if (bg) for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = bg
})

apply()
system.addEventListener("change", apply)
onPrefs(apply)
