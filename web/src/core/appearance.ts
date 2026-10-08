// Appearance applied to the page: light or dark, colour scheme (themes/*.css or a vault theme), density, fonts and
// snippets. The last ones applied are in localStorage so index.html applies them before this code loads.
import { getPrefs, onPrefs } from "@/core/prefs"
import { SCHEMES, schemeId } from "@/themes/schemes"
import { signal } from "@/core/signal"

export type VaultTheme = { name: string; author: string; version: string; modes: ("light" | "dark")[]; mtime: number; problem?: string }
export type VaultSnippet = { name: string; mtime: number }
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

function apply() {
  const p = getPrefs()
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
  const look = { dark: only || p.theme !== "system" ? dark : "system", scheme: root.dataset.scheme ?? "", density: root.dataset.density ?? "" }
  try { localStorage.setItem(LOOK, JSON.stringify(look)) } catch { /* private mode */ }
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
}
let linked = ""


apply()
system.addEventListener("change", apply)
onPrefs(apply)
