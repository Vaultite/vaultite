// Appearance applied to the page: light or dark, colour scheme (themes/*.css or a vault theme), density, fonts and
// snippets. The last ones applied are in localStorage so index.html applies them before this code loads.
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

/** The vault's themes and snippets arrived (in /api/state). */
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
/** A font setting as a font-family value: a bare name with spaces gets quotes ("Iowan Old Style"). */
function family(v: unknown) {
  const s = str(v).replace(/[;{}]/g, "")
  return s && !/[,'"]/.test(s) && /\s/.test(s) ? `"${s}"` : s
}

/** A <link> per stylesheet, kept in order at the end of <head> (after the app's CSS, so they win). */
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
      l.addEventListener("load", lookChanged) // its colours are in only now
    }
    if (l.getAttribute("href") !== w.href) l.setAttribute("href", w.href)
    head.appendChild(l) // (re)appended: keeps the order
  }
  for (const l of have.values()) l.remove()
}

/** A font setting as the stack the app uses: the font, then the system's (a monospace one for code). */
export const fontStack = (v: unknown, mono = false) => `${family(v)}, ${mono ? "ui-monospace, monospace" : "system-ui, sans-serif"}`

/** The app's own fonts, when a setting is empty (index.css: --font-sans in @theme, --font-code in :root). */
export const DEFAULT_FONTS = {
  ui: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif, 'Noto Color Emoji'",
  code: "ui-monospace, 'SF Mono', Menlo, 'DejaVu Sans Mono', 'Noto Sans Mono', 'Liberation Mono', 'Ubuntu Mono', monospace",
}

const system = matchMedia("(prefers-color-scheme: dark)")
const LOOK = "vaultite.look"

// What follows the look outside CSS (a terminal's palette, a canvas, a frame): told once it's in place, including
// after a theme's or snippet's stylesheet has loaded, which a watch on <html>'s attributes misses.
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

/** What a picker can show for now: a colour scheme, a font. */
export type LookPreview = Partial<Pick<Prefs, "scheme" | "interfaceFont" | "textFont" | "monoFont">>
// Shown for now (the palette's pickers, as the selection moves), saved nowhere.
let previewing: LookPreview | null = null
/** Shows those settings on the whole app without saving them; null goes back to the saved ones. */
export function previewLook(look: LookPreview | null) {
  if (JSON.stringify(previewing) === JSON.stringify(look)) return
  previewing = look
  apply()
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
  // What index.html puts in place before the app's code has loaded (no flash of the other theme): "system" when it
  // follows the system's, which the page checks itself.
  askTranslucent(p.translucent)
  // (only read under data-translucent: pages show the desktop only while the chrome does)
  root.toggleAttribute("data-translucent-pages", p.translucent && p.translucentPages)
  const look = { dark: only || p.theme !== "system" ? dark : "system", scheme: root.dataset.scheme ?? "", density: root.dataset.density ?? "",
    ...(translucency.on ? { translucent: true, ...(p.translucentPages ? { pages: true } : {}) } : {}) }
  if (previewing === null) try { localStorage.setItem(LOOK, JSON.stringify(look)) } catch { /* private mode */ }
  const vars: [string, string][] = [["--font-ui", p.interfaceFont], ["--font-text", p.textFont], ["--font-code", p.monoFont]]
  for (const [k, v] of vars) {
    if (family(v)) root.style.setProperty(k, fontStack(v, k === "--font-code"))
    else root.style.removeProperty(k)
  }
  // Every vault theme's stylesheet (the gallery's tiles draw them), then the snippets that are on.
  const on = new Set(Array.isArray(p.snippets) ? p.snippets : [])
  const themes = vault.themes.filter((t) => !t.problem).map((t) => ({ key: t.name, href: `api/themes/${encodeURIComponent(t.name)}.css?v=${t.mtime}` }))
  const snippets = vault.snippets.filter((s) => on.has(s.name)).map((s) => ({ key: s.name, href: `api/snippets/${encodeURIComponent(s.name)}.css?v=${s.mtime}` }))
  const sig = JSON.stringify([themes, snippets])
  if (sig !== linked) { // only when they change: moving a <link> re-applies its sheet
    linked = sig
    syncLinks("theme", themes)
    syncLinks("snippet", snippets)
  }
  const now = JSON.stringify([look, root.style.cssText, sig])
  if (now !== applied) { applied = now; lookChanged() }
}
let linked = "", applied = ""


// ---------- translucent (appearance `translucent`): the window's chrome over the system's blur, in the desktop app

const native = (window as { vaultite?: DesktopApi }).vaultite?.translucent
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
/** The window asked to be translucent, or not. Solid at once, see-through only once its blur is there. */
function askTranslucent(want: boolean) {
  const ask = want && !!native && !reduced.matches
  if (ask === asked) return
  asked = ask
  if (!ask) setTranslucency({ on: false, ...(want ? { why: native ? "reduced" as const : "system" as const } : {}) })
  if (native) void native.set(ask).then((t) => { if (ask && asked) setTranslucency(t) }, () => {})
}
native?.on((t) => { if (asked) setTranslucency(t) })
reduced.addEventListener("change", () => askTranslucent(getPrefs().translucent))
/** Whether this window may be (the desktop app on a Mac or Windows), is now, and why not while it's asked for. */
export const canTranslucent = !!native
export const getTranslucency = () => translucency
export const onTranslucency = (fn: () => void) => translucencyChanged.subscribe(fn)

// Light or dark and the scheme on <html>, however they got there (the app's first paint, a test, another script).
new MutationObserver(lookChanged).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-scheme", "data-density", "style"] })

// The browser's own bars (Safari's, an installed web app's title bar) in the page's colour, whichever mode the system is in.
onLook(() => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--background").trim()
  if (bg) for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = bg
})

apply()
system.addEventListener("change", apply)
onPrefs(apply)
