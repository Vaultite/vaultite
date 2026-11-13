
export const STYLES = ".vaultite/plugins/web-viewer/sites"
export const styleFile = (site: string) => `${STYLES}/${site}.css`

export function siteName(v: string) {
  const s = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "")
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) ? s : ""
}

export const COLORS = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "muted",
  "muted-foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground",
  "border", "input", "ring", "sidebar", "red", "blue"]
export const FONTS = { "font-ui": "--font-sans", "font-text": "--font-text", "font-code": "--font-code" }

export type SiteStyle = { site: string; path: string; css: string }

export const template = (site: string) => `/* ${site} in your vault's look: this CSS is added to its pages (its subdomains' too), and each declaration
   wins over the site's own, so no !important is needed. Saved, it applies at once.

   The vault's look, kept up to date as it changes (light or dark, colour scheme, fonts):
   ${COLORS.map((c) => `--vault-${c}`).join(" ")}
   ${Object.keys(FONTS).map((f) => `--vault-${f}`).join(" ")} --vault-radius --vault-color-scheme (light or dark)
   --vault-paper-filter (dark: a canvas' white paper onto the card, its text the foreground; light: none)

   For example:
   :root { color-scheme: var(--vault-color-scheme); }
   html, body { background: var(--vault-background); color: var(--vault-foreground); font-family: var(--vault-font-ui); }
*/
`

type Block = "style" | "group" | "plain"
const PLAIN = /^@(?:-webkit-)?(?:keyframes|font-face|property|counter-style|font-feature-values|font-palette-values|view-transition)\b/i
const kindOf = (prelude: string, parent: Block): Block =>
  parent === "plain" || PLAIN.test(prelude) ? "plain" : !prelude.startsWith("@") || /^@page\b/i.test(prelude) ? "style" : parent

const made = new Map<string, string>()
// Text, not the CSSOM: Chromium writes a var() shorthand back as empty longhands once one of them follows it.
export function winning(css: string) {
  const had = made.get(css)
  if (had !== undefined) return had
  const stack: Block[] = []
  let out = "", cur = "", quote = "", depth = 0
  const end = (ch: string) => {
    const d = cur.trim()
    out += stack.at(-1) === "style" && /^-*[a-z][\w-]*\s*:/i.test(d) && !/!\s*important$/i.test(d) ? `${cur.trimEnd()} !important${ch}` : cur + ch
    cur = ""
  }
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      cur += ch
      if (ch === "\\") cur += css[++i] ?? ""
      else if (ch === quote) quote = ""
    } else if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2)
      i = close < 0 ? css.length : close + 1
    } else if (ch === "\"" || ch === "'") { quote = ch; cur += ch }
    else if (ch === "(" || ch === "[") { depth++; cur += ch }
    else if (ch === ")" || ch === "]") { depth = Math.max(0, depth - 1); cur += ch }
    else if (depth || (ch !== "{" && ch !== ";" && ch !== "}")) cur += ch
    else if (ch === "{") { stack.push(kindOf(cur.trim(), stack.at(-1) ?? "group")); out += `${cur}{`; cur = "" }
    else { end(ch); if (ch === "}") stack.pop() }
  }
  out += cur
  if (made.size > 200) made.clear()
  made.set(css, out)
  return out
}
