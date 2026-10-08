// Obsidian themes and CSS snippets from .vaultite/ (which are on: appearance.json). A theme converts to a colour scheme:
// only its colours carry over, its variables resolved in cascade order and mapped to the app's tokens.
import fs from "node:fs"
import path from "node:path"
import { HTTPError, Text } from "./plugins.ts"
import type { Vault } from "./vault.ts"

export type ThemeInfo = { name: string; author: string; version: string; modes: Mode[]; mtime: number; problem?: string }
export type SnippetInfo = { name: string; mtime: number }
type Mode = "light" | "dark"
type Vars = Record<string, string>

const THEMES = ".vaultite/themes"
const SNIPPETS = ".vaultite/snippets"
const NAME = /^[^/\\.][^/\\]*$/ // a plain file or folder name

const mtime = (p: string) => { try { return Math.round(fs.statSync(p).mtimeMs) } catch { return 0 } }
function readJSON(p: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return {} }
}
function dirs(p: string) {
  try { return fs.readdirSync(p, { withFileTypes: true }) } catch { return [] }
}

/** A theme's CSS file: <Name>/theme.css (as downloaded), or the only .css in its folder. */
function themeCSS(dir: string) {
  const main = path.join(dir, "theme.css")
  if (fs.existsSync(main)) return main
  const css = dirs(dir).filter((e) => e.isFile() && e.name.endsWith(".css"))
  return css.length === 1 ? path.join(dir, css[0].name) : null
}

// Converted themes, by file and time (a big theme takes a moment to parse).
const cache = new Map<string, { mtime: number; theme: Converted }>()
function convertedOf(file: string): Converted {
  const t = mtime(file)
  const hit = cache.get(file)
  if (hit && hit.mtime === t) return hit.theme
  const theme = convert(fs.readFileSync(file, "utf8"))
  cache.set(file, { mtime: t, theme })
  return theme
}

export function listThemes(vault: Vault): ThemeInfo[] {
  const root = vault.abs(THEMES)
  const out: ThemeInfo[] = []
  for (const e of dirs(root)) {
    if (!e.isDirectory() || !NAME.test(e.name)) continue
    const dir = path.join(root, e.name)
    const file = themeCSS(dir)
    const m = readJSON(path.join(dir, "manifest.json"))
    const info: ThemeInfo = {
      name: e.name, author: String(m.author ?? ""), version: String(m.version ?? ""), modes: ["light", "dark"],
      mtime: Math.max(file ? mtime(file) : 0, mtime(path.join(dir, "manifest.json"))),
    }
    if (!file) info.problem = "no theme.css in its folder"
    else {
      try { info.modes = convertedOf(file).modes } catch (err) { info.problem = `couldn't read theme.css: ${(err as Error).message}` }
    }
    out.push(info)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function listSnippets(vault: Vault): SnippetInfo[] {
  const root = vault.abs(SNIPPETS)
  return dirs(root).filter((e) => e.isFile() && e.name.endsWith(".css") && NAME.test(e.name))
    .map((e) => ({ name: e.name.slice(0, -4), mtime: mtime(path.join(root, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The appearance routes, or undefined if the request isn't one of them. */
export function handle(vault: Vault, method: string, parts: string[], body: Record<string, unknown>): unknown {
  const [head, file] = parts
  if (head === "themes" && method === "GET") {
    if (parts.length === 1) return listThemes(vault)
    if (parts.length === 2 && file.endsWith(".css")) {
      const name = file.slice(0, -4)
      const dir = vault.abs(`${THEMES}/${name}`)
      const css = NAME.test(name) ? themeCSS(dir) : null
      if (!css) throw new HTTPError(404, `no theme '${name}' in ${THEMES}`)
      return new Text(schemeCSS(`theme:${name}`, convertedOf(css)), "text/css; charset=utf-8")
    }
  }
  if (head === "snippets") {
    if (method === "GET" && parts.length === 1) return listSnippets(vault)
    if (method === "GET" && parts.length === 2 && file.endsWith(".css") && NAME.test(file)) {
      try {
        return new Text(fs.readFileSync(vault.abs(`${SNIPPETS}/${file}`), "utf8"), "text/css; charset=utf-8")
      } catch {
        throw new HTTPError(404, `no snippet '${file}' in ${SNIPPETS}`)
      }
    }
    if (method === "POST" && parts.length === 1) {
      const name = String(body.name ?? "").trim().replace(/\.css$/i, "")
      if (!name || !NAME.test(name) || /[*"<>:|?]/.test(name)) throw new HTTPError(400, "a snippet needs a plain file name")
      fs.mkdirSync(vault.abs(SNIPPETS), { recursive: true })
      let n = 0, rel = `${SNIPPETS}/${name}.css`
      while (fs.existsSync(vault.abs(rel))) rel = `${SNIPPETS}/${name} ${++n}.css`
      fs.writeFileSync(vault.abs(rel), SNIPPET)
      return { path: rel, name: path.basename(rel, ".css") }
    }
  }
  return undefined
}

const SNIPPET = `/* A CSS snippet: turn it on in Settings > Appearance > CSS snippets. It's added after the app's own CSS, so it
   wins. The app's colours are variables (--background, --foreground, --card, --primary, --red...), for example:

   :root { --primary: #d33682; }
   .vau-editor .cm-editor { letter-spacing: 0.01em; }
*/
`

// ---------------------------------------------------------------------------------------------------------------
// Theme conversion

type Converted = { modes: Mode[]; light: Vars; dark: Vars }

/** Obsidian's own defaults (its app.css), so a theme that only sets a few base colours still maps. */
const BASE: Vars = {
  "accent-h": "254", "accent-s": "80%", "accent-l": "68%",
  "color-accent-hsl": "var(--accent-h), var(--accent-s), var(--accent-l)",
  "color-accent": "hsl(var(--accent-h), var(--accent-s), var(--accent-l))",
  "color-accent-1": "hsl(calc(var(--accent-h) - 1), calc(var(--accent-s) * 1.01), calc(var(--accent-l) * 1.075))",
  "background-primary": "var(--color-base-00)", "background-primary-alt": "var(--color-base-10)",
  "background-secondary": "var(--color-base-20)", "background-secondary-alt": "var(--color-base-05)",
  "background-modifier-border": "var(--color-base-30)",
  "text-normal": "var(--color-base-100)", "text-muted": "var(--color-base-70)", "text-faint": "var(--color-base-50)",
  "text-on-accent": "white", "text-error": "var(--color-red)", "text-accent": "var(--color-accent)",
  "interactive-accent": "var(--color-accent-1)",
  "h1-color": "inherit", "h2-color": "inherit", "h3-color": "inherit", "h4-color": "inherit", "h5-color": "inherit", "h6-color": "inherit",
}
const DEFAULTS: Record<Mode, Vars> = {
  light: {
    ...BASE,
    "mono-rgb-0": "255, 255, 255", "mono-rgb-100": "0, 0, 0",
    "color-base-00": "#ffffff", "color-base-05": "#fcfcfc", "color-base-10": "#fafafa", "color-base-20": "#f6f6f6",
    "color-base-25": "#e3e3e3", "color-base-30": "#e0e0e0", "color-base-35": "#d4d4d4", "color-base-40": "#bdbdbd",
    "color-base-50": "#ababab", "color-base-60": "#707070", "color-base-70": "#5c5c5c", "color-base-100": "#222222",
    "color-red": "#e93147", "color-orange": "#ec7500", "color-yellow": "#e0ac00", "color-green": "#08b94e",
    "color-cyan": "#00bfbc", "color-blue": "#086ddd", "color-purple": "#7852ee", "color-pink": "#d53984",
  },
  dark: {
    ...BASE,
    "mono-rgb-0": "0, 0, 0", "mono-rgb-100": "255, 255, 255",
    "color-accent-1": "hsl(calc(var(--accent-h) - 3), calc(var(--accent-s) * 1.02), calc(var(--accent-l) * 1.15))",
    "color-base-00": "#1e1e1e", "color-base-05": "#212121", "color-base-10": "#242424", "color-base-20": "#262626",
    "color-base-25": "#2a2a2a", "color-base-30": "#363636", "color-base-35": "#3f3f3f", "color-base-40": "#555555",
    "color-base-50": "#666666", "color-base-60": "#999999", "color-base-70": "#b3b3b3", "color-base-100": "#dadada",
    "color-red": "#fb464c", "color-orange": "#e9973f", "color-yellow": "#e0de71", "color-green": "#44cf6e",
    "color-cyan": "#53dfdd", "color-blue": "#027aff", "color-purple": "#a882ff", "color-pink": "#fa99cd",
  },
}

/** Comments out, strings kept. */
function stripComments(css: string) {
  let out = "", i = 0
  while (i < css.length) {
    const c = css[i]
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2)
      i = end < 0 ? css.length : end + 2
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== c) j += css[j] === "\\" ? 2 : 1
      out += css.slice(i, j + 1)
      i = j + 1
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Where the text from `i` reaches `stop` (one of its characters) at the top level: outside strings, () and {}. */
function scan(s: string, i: number, stop: string) {
  let depth = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1
      i = j
    } else if (depth === 0 && stop.includes(c)) return i
    else if (c === "(" || (c === "{" && depth > 0)) depth++
    else if (c === ")" || c === "}") depth--
  }
  return s.length
}

type Rule = { selector: string; decls: [string, string][] }

/** Every style rule, with its own custom properties; at-rules other than @layer and @supports are skipped (a
 *  @media block is for some window size, not the theme's colours). */
function rules(css: string, out: Rule[] = []): Rule[] {
  let i = 0
  while (i < css.length) {
    const at = scan(css, i, "{;}")
    const prelude = css.slice(i, at).trim()
    if (at >= css.length) break
    if (css[at] !== "{") { i = at + 1; continue }
    // the block's end: matching brace
    let depth = 1, j = at + 1
    for (; j < css.length && depth; j++) {
      const c = css[j]
      if (c === '"' || c === "'") {
        let k = j + 1
        while (k < css.length && css[k] !== c) k += css[k] === "\\" ? 2 : 1
        j = k
      } else if (c === "{") depth++
      else if (c === "}") depth--
    }
    const body = css.slice(at + 1, j - 1)
    if (prelude.startsWith("@")) {
      if (/^@(layer|supports)\b/i.test(prelude)) rules(body, out)
    } else {
      const decls: [string, string][] = []
      let k = 0
      while (k < body.length) {
        const end = scan(body, k, ";{")
        if (body[end] === "{") { // a nested rule: skip it
          let d = 1, m = end + 1
          for (; m < body.length && d; m++) d += body[m] === "{" ? 1 : body[m] === "}" ? -1 : 0
          k = m
          continue
        }
        const decl = body.slice(k, end)
        const colon = decl.indexOf(":")
        const name = decl.slice(0, colon).trim()
        if (colon > 0 && name.startsWith("--")) decls.push([name.slice(2), decl.slice(colon + 1).replace(/!important\s*$/i, "").trim()])
        k = end + 1
      }
      if (decls.length) out.push({ selector: prelude, decls })
    }
    i = j
  }
  return out
}

/** Classes a theme's Style Settings turn on by default (class-select defaults, class-toggles with default: true),
 *  and variables it sets by default (variable-select, -color, -text). */
function styleSettings(css: string) {
  const classes = new Set<string>()
  const vars: Vars = {}
  for (const m of css.matchAll(/\/\*\s*@settings([\s\S]*?)\*\//g)) {
    let item: Record<string, string> = {}
    const flush = () => {
      if (item.type === "class-select" && item.default) classes.add(item.default)
      if (item.type === "class-toggle" && item.default === "true" && item.id) classes.add(item.id)
      if (/^variable-(select|color|text)$/.test(item.type ?? "") && item.id && item.default) vars[item.id] = item.default
      item = {}
    }
    for (const line of m[1].split("\n")) {
      const kv = /^\s*(-\s*)?([\w-]+):\s*(.*?)\s*$/.exec(line)
      if (/^\s*-\s*$/.test(line) || kv?.[1]) flush()
      if (kv && ["id", "type", "default"].includes(kv[2])) item[kv[2]] = kv[3].replace(/^['"]|['"]$/g, "")
    }
    flush()
  }
  return { classes, vars }
}

/** Which modes a selector (one compound, no combinators) applies to, and its specificity; null if it's not one of
 *  the page-wide ones (body, :root, html, .theme-light, .theme-dark, plus classes on by default). */
function target(sel: string, on: Set<string>): { modes: Mode[]; spec: number } | null {
  const s = sel.trim()
  if (!s || /[\s>+~[*]/.test(s)) return null
  const parts = s.match(/(^[a-z]+)|([.:][\w-]+(\([^)]*\))?)/gi)
  if (!parts || parts.join("") !== s) return null
  let modes: Mode[] = ["light", "dark"], spec = 0
  for (const p of parts) {
    if (p === "body" || p === "html") spec += 1
    else if (p === ":root") spec += 10
    else if (p === ".theme-light" || p === ".theme-dark") { modes = [p === ".theme-light" ? "light" : "dark"]; spec += 10 }
    else if (p.startsWith(".") && on.has(p.slice(1))) spec += 10
    else return null
  }
  return { modes, spec }
}

/** var() references replaced by their values (fallbacks when missing); null if one can't be. */
function resolve(value: string, vars: Vars, seen: Set<string> = new Set()): string | null {
  let out = "", i = 0
  while (i < value.length) {
    const at = value.indexOf("var(", i)
    if (at < 0) { out += value.slice(i); break }
    out += value.slice(i, at)
    const end = scan(value, at + 4, ")")
    const inner = value.slice(at + 4, end)
    const comma = scan(inner, 0, ",")
    const name = inner.slice(0, comma).trim().replace(/^--/, "")
    const fallback = comma < inner.length ? inner.slice(comma + 1).trim() : null
    let got: string | null = null
    if (name in vars && !seen.has(name)) got = resolve(vars[name], vars, new Set([...seen, name]))
    if (got === null && fallback !== null) got = resolve(fallback, vars, seen)
    if (got === null) return null
    out += got
    i = end + 1
  }
  return out.trim()
}

const COLOR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(.*\)|[a-z]+)$/i
const NOT_COLOR = /^(inherit|initial|unset|revert|none|currentcolor|auto|normal)$/i

export function convert(text: string): Converted {
  const css = stripComments(text)
  const { classes, vars: settings } = styleSettings(text)
  const found: { modes: Mode[]; spec: number; order: number; decls: [string, string][] }[] = []
  let order = 0
  for (const r of rules(css)) {
    for (const sel of r.selector.split(",")) {
      const t = target(sel, classes)
      if (t) found.push({ ...t, order: order++, decls: r.decls })
    }
  }
  found.sort((a, b) => a.spec - b.spec || a.order - b.order)
  const has = (m: Mode) => found.some((f) => f.modes.length === 1 && f.modes[0] === m &&
    f.decls.some(([n]) => /^(background-primary|color-base-00|text-normal)$/.test(n)))
  const light = has("light"), dark = has("dark")
  const modes: Mode[] = light === dark ? ["light", "dark"] : light ? ["light"] : ["dark"]
  const varsOf = (m: Mode): Vars => {
    const v: Vars = { ...DEFAULTS[m], ...settings }
    for (const f of found) if (f.modes.includes(m)) for (const [n, val] of f.decls) v[n] = val
    return v
  }
  return { modes, light: tokens(varsOf("light"), "light"), dark: tokens(varsOf("dark"), "dark") }
}

/** Obsidian's variables -> the app's tokens (index.css). */
function tokens(v: Vars, mode: Mode): Vars {
  const ok = (r: string | null): r is string => !!r && COLOR.test(r) && !NOT_COLOR.test(r) && !r.includes("var(")
  const get = (...names: string[]) => {
    for (const n of names) {
      const r = n in v ? resolve(v[n], v) : null
      if (ok(r)) return r
    }
    for (const n of names) { // the theme's value didn't resolve: Obsidian's default for it
      const r = n in DEFAULTS[mode] ? resolve(DEFAULTS[mode][n], { ...v, ...DEFAULTS[mode] }) : null
      if (ok(r)) return r
    }
    return null
  }
  const mix = (a: string, pct: number, b = "transparent") => `color-mix(in srgb, ${a} ${pct}%, ${b})`
  const fg = get("text-normal")!, muted = get("text-muted")!, faint = get("text-faint", "text-muted")!
  const accent = get("interactive-accent", "color-accent", "text-accent")!
  // Obsidian draws notes on primary and sidebars on secondary; the app's light pages are darker than their cards and
  // dark pages darker too, so light: page secondary, cards primary; dark: page primary, cards a step lighter.
  const primary = get("background-primary")!, secondary = get("background-secondary", "background-primary-alt")!
  const bg = mode === "light" ? secondary : primary
  const card = mode === "light" ? primary : mix(primary, 93, fg)
  const side = mode === "light" ? mix(secondary, 94, fg) : secondary
  const c = {
    red: get("color-red")!, orange: get("color-orange")!, yellow: get("color-yellow")!, green: get("color-green")!,
    teal: get("color-cyan")!, blue: get("color-blue")!, purple: get("color-purple")!, pink: get("color-pink")!,
  }
  const out: Vars = {
    background: bg, foreground: fg, card, "card-foreground": fg,
    popover: mix(get("background-secondary-alt", "background-secondary")!, 92), "popover-foreground": fg,
    primary: accent, "primary-foreground": get("text-on-accent") ?? "white",
    secondary: mix(muted, 14), "secondary-foreground": fg, muted: mix(muted, 14), "muted-foreground": muted,
    accent: mix(muted, 14), "accent-foreground": fg, destructive: get("text-error", "color-red")!,
    border: get("background-modifier-border") ?? mix(muted, 30), input: mix(muted, 22), ring: accent,
    "chart-1": accent, "chart-2": muted, "chart-3": c.red, "chart-4": c.purple, "chart-5": c.green,
    sidebar: side, "segment-on": card,
    ...c, indigo: mix(c.blue, 50, c.purple), gray: faint,
    scrollbar: mix(muted, 35), "scrollbar-hover": mix(muted, 55),
    "map-land": side, "map-water": mix(c.blue, 22, bg), "map-park": mix(c.green, 16, bg),
  }
  for (let n = 1; n <= 6; n++) out[`h${n}`] = get(`h${n}-color`) ?? (n <= 3 ? fg : muted)
  return out
}

/** The tokens as a scheme stylesheet, like web/src/themes/*.css (a Settings tile shows it too: .scheme-preview). */
export function schemeCSS(id: string, t: Converted) {
  const sel = `:is(:root, .scheme-preview)[data-scheme="${id.replace(/["\\]/g, "\\$&")}"]`
  const block = (s: string, vars: Vars, dark: boolean) =>
    `${s} {\n  color-scheme: ${dark ? "dark" : "light"};\n${Object.entries(vars).map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}\n`
  // A theme with one mode draws it in both (prefs.ts also keeps the app in that mode).
  const light = t.modes.includes("light") ? t.light : t.dark
  const dark = t.modes.includes("dark") ? t.dark : t.light
  return `/* Converted from a theme: colours only. */\n${block(sel, light, !t.modes.includes("light"))}${block(`${sel}.dark`, dark, !!t.modes.includes("dark"))}`
}
