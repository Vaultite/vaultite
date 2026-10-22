// Site styles in the app: each site's CSS (the store's siteStyles) made to win over the site's own, with the vault's look
// as variables, told to the desktop app (electron/browser/sitestyles.ts) as either changes; a site's file edited beside it.
import { useEffect, useState } from "react"
import { getStore, notifyError, onLook, op, openInSplit, useStore, webPages } from "@vaultite"
import { COLORS, FONTS, siteName, styleFile, template, type SiteStyle } from "./sitestyles"
import { settings } from "./state"

const NONE: never[] = []

/** The vault's look as a page's variables (--vault-background...): the app's tokens as they're resolved now. */
function lookVars() {
  const root = document.documentElement, cs = getComputedStyle(root)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  const vars = COLORS.map((c) => [c, v(`--${c}`)])
  for (const [name, token] of Object.entries(FONTS)) vars.push([name, v(token) || v("--font-sans")])
  vars.push(["radius", v("--radius")], ["color-scheme", root.classList.contains("dark") ? "dark" : "light"])
  return `:root { ${vars.filter(([, x]) => x).map(([k, x]) => `--vault-${k}: ${x};`).join(" ")} }`
}

/** A declaration block's declarations, split at its top-level semicolons (not one in a string or a url()). */
function declarations(text: string) {
  const out: string[] = []
  let cur = "", depth = 0, quote = ""
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === "\\") cur += text[++i] ?? ""
      else if (ch === quote) quote = ""
      continue
    }
    if (ch === "\"" || ch === "'") quote = ch
    else if (ch === "(" || ch === "[") depth++
    else if (ch === ")" || ch === "]") depth--
    else if (ch === ";" && depth <= 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const made = new Map<string, string>()
/** `css` as the browser parses it, every declaration !important (the engine's layer then beats the page's own, even its
 *  !important); keyframes and font faces as they are (!important isn't allowed there). */
export function winning(css: string) {
  const had = made.get(css)
  if (had !== undefined) return had
  const sheet = new CSSStyleSheet()
  try { sheet.replaceSync(css) } catch { return css }
  const walk = (rules: CSSRuleList) => {
    for (const r of rules) {
      if (r instanceof CSSKeyframesRule || r instanceof CSSFontFaceRule) continue
      const style = (r as CSSRule & { style?: unknown }).style
      if (style instanceof CSSStyleDeclaration && style.length) {
        style.cssText = declarations(style.cssText).map((d) => (/!\s*important\s*$/i.test(d) ? d : `${d} !important`)).join("; ")
      }
      const inner = (r as CSSRule & { cssRules?: unknown }).cssRules
      if (inner instanceof CSSRuleList) walk(inner)
    }
  }
  walk(sheet.cssRules)
  const out = [...sheet.cssRules].map((r) => r.cssText).join("\n")
  if (made.size > 200) made.clear()
  made.set(css, out)
  return out
}

const tell = (vars: string, styles: { site: string; css: string }[]) =>
  Promise.resolve(webPages?.engine?.("sitestyles:set", { vars, styles })).catch(() => {})

/** The desktop app hears the sites' styles and the vault's look now and as they change (index.tsx's Background). */
export function useSiteStyles() {
  const styles = useStore().store?.siteStyles ?? NONE
  const off = settings.use().unstyled ?? NONE
  const [vars, setVars] = useState(lookVars)
  useEffect(() => onLook(() => setVars(lookVars())), [])
  const on = styles.filter((s) => !off.includes(s.site)).map((s) => ({ site: s.site, css: winning(s.css) }))
  const key = JSON.stringify([vars, on])
  useEffect(() => { if (webPages?.engine) void tell(vars, on) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The style for a page's site (`site` as Shields name it: example.co.uk), the most specific one there is. */
export const styleOf = (styles: SiteStyle[], site: string) => styles.filter((s) => site === s.site || site.endsWith(`.${s.site}`))
  .sort((a, b) => b.site.length - a.site.length)[0]

/** Turn a site's style on or off (kept in `unstyled`). */
export function setStyled(site: string, on: boolean) {
  const next = (settings.get().unstyled ?? []).filter((x) => x !== site).concat(on ? [] : [site])
  void settings.set({ unstyled: next.length ? next : null }).catch((e) => notifyError(e, "Couldn't change it"))
}

/** Edit `site`'s style beside its page: its file (made from the template the first time), on the right. With the page's
 *  id, its site as Shields name it (youtube.com for music.youtube.com), so both find the same file. */
export async function editStyle(site: string, page?: number) {
  const shields = page ? ((await Promise.resolve(webPages?.engine?.("adblock:page", page)).catch(() => null)) as { site?: string } | null)?.site : ""
  const name = siteName(shields || site)
  if (!name) return
  const had = styleOf(getStore()?.siteStyles ?? [], name)
  const path = had?.path ?? styleFile(name)
  try {
    if (!had) await op("web-viewer.style", { site: name, css: template(name) })
    if ((settings.get().unstyled ?? []).includes(had?.site ?? name)) setStyled(had?.site ?? name, true)
    openInSplit(`file:${path}`, "right")
  } catch (e) { notifyError(e, "Couldn't open its style") }
}
