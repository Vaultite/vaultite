// Fonts this device has, for the font pickers: browsers can't list them without asking, so common families are kept
// when they draw, plus `queryLocalFonts()` where allowed ("Show every installed font" asks once).

export type Font = { family: string; mono: boolean }

const SANS = [
  "Helvetica Neue", "Helvetica", "Arial", "Avenir", "Avenir Next", "Futura", "Gill Sans", "Optima", "Seravek", "Verdana",
  "Trebuchet MS", "Tahoma", "Lucida Grande", "Geneva", "Arial Rounded MT Bold", "DIN Alternate", "Skia", "Inter",
  "Inter Variable", "Geist", "Roboto", "Open Sans", "Lato", "Source Sans 3", "Source Sans Pro", "Noto Sans",
  "IBM Plex Sans", "Segoe UI", "Ubuntu", "Montserrat", "Nunito", "Work Sans", "Figtree", "Manrope", "DM Sans",
  "Atkinson Hyperlegible", "Fira Sans", "PT Sans", "Cantarell", "SF Pro Text", "SF Pro Display", "SF Pro Rounded",
  "Hiragino Sans", "PingFang SC", "Apple SD Gothic Neo", "Comic Sans MS", "Chalkboard SE", "Marker Felt",
]
const SERIF = [
  "New York", "Georgia", "Times New Roman", "Times", "Palatino", "Baskerville", "Hoefler Text", "Didot", "Bodoni 72",
  "Big Caslon", "Charter", "Iowan Old Style", "Cochin", "Athelas", "Superclarendon", "Rockwell", "American Typewriter",
  "Cambria", "Garamond", "EB Garamond", "Libre Baskerville", "Merriweather", "Lora", "Source Serif 4",
  "Source Serif Pro", "Noto Serif", "IBM Plex Serif", "Literata", "Crimson Pro", "Crimson Text", "Spectral", "PT Serif",
  "Charis SIL", "Bookerly", "Sitka Text", "Constantia", "iA Writer Quattro S", "iA Writer Quattro V",
]
const MONO = [
  "SF Mono", "Menlo", "Monaco", "Courier New", "Courier", "Andale Mono", "PT Mono", "JetBrains Mono", "Fira Code",
  "Fira Mono", "Source Code Pro", "IBM Plex Mono", "Cascadia Code", "Cascadia Mono", "Consolas", "Hack", "Inconsolata",
  "Ubuntu Mono", "Roboto Mono", "Iosevka", "Berkeley Mono", "Geist Mono", "Victor Mono", "Commit Mono",
  "Monaspace Neon", "Monaspace Argon", "iA Writer Mono S", "iA Writer Duo S", "Input Mono", "Operator Mono",
  "Dank Mono", "MonoLisa", "Lucida Console", "DejaVu Sans Mono", "Space Mono", "Red Hat Mono", "Martian Mono",
]

let ctx: CanvasRenderingContext2D | null | undefined
const SAMPLE = "mmmmmmmmmmlli1WQ@#&%"
const width = (font: string) => { ctx!.font = `32px ${font}`; return ctx!.measureText(SAMPLE).width }
const quote = (family: string) => `"${family.replace(/"/g, "")}"`

/** Whether this device draws `family` (it measures differently from at least one generic fallback). */
function drawn(family: string) {
  if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return false
  return ["monospace", "serif", "sans-serif"].some((g) => width(`${quote(family)}, ${g}`) !== width(g))
}

/** Monospaced: its narrow and wide letters are as wide. */
function monospaced(family: string) {
  if (!ctx) return false
  ctx.font = `32px ${quote(family)}, sans-serif`
  return Math.abs(ctx.measureText("iiiiiiiiii").width - ctx.measureText("WWWWWWWWWW").width) < 0.5
}

let common: Font[] | null = null
let local: Font[] | null = null

/** The fonts of the common list this device has (measured once). */
function commonFonts(): Font[] {
  if (common) return common
  const seen = new Set<string>()
  common = []
  for (const family of [...SANS, ...SERIF, ...MONO]) {
    if (seen.has(family.toLowerCase()) || !drawn(family)) continue
    seen.add(family.toLowerCase())
    common.push({ family, mono: MONO.includes(family) || monospaced(family) })
  }
  return common
}

type LocalFontData = { family: string }
const query = () => (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts

/** Whether the browser can list every installed font (it may ask first). */
export const canListAll = () => typeof query() === "function"

/** Whether listing every installed font needs no prompt: allowed before, or the desktop app (which allows it). */
export async function listAllowed() {
  if (!canListAll()) return false
  if (local) return true
  if ((window as unknown as { vaultite?: unknown }).vaultite) return true
  try {
    const p = await navigator.permissions.query({ name: "local-fonts" as PermissionName })
    return p.state === "granted"
  } catch { return false }
}

/** Every installed family from queryLocalFonts (needs a click or key press when the browser asks). */
export async function loadAll(): Promise<boolean> {
  const q = query()
  if (!q) return false
  try {
    const data = await q.call(window)
    if (!ctx) ctx = document.createElement("canvas").getContext("2d")
    const families = [...new Set(data.map((d) => d.family).filter((f) => f && !f.startsWith(".")))]
    local = families.map((family) => ({ family, mono: monospaced(family) }))
    return true
  } catch { return false }
}

/** The fonts to offer: the common ones this device has, and every installed one once listed, by name. */
export function fonts(): Font[] {
  const byName = new Map<string, Font>()
  for (const f of [...commonFonts(), ...(local ?? [])]) if (!byName.has(f.family.toLowerCase())) byName.set(f.family.toLowerCase(), f)
  return [...byName.values()].sort((a, b) => a.family.localeCompare(b.family))
}

/** Whether every installed font is in `fonts()` already. */
export const listedAll = () => !!local
