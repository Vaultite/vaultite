// Site styles in the app: each site's CSS (the store's siteStyles) made to win over the site's own, with the vault's look
// as variables, told to the desktop app (electron/browser/sitestyles.ts) as either changes; a site's file edited beside it.
import { useEffect, useState } from "react"
import { getStore, notifyError, onLook, op, openInSplit, useStore, webPages } from "@vaultite"
import { COLORS, FONTS, siteName, styleFile, template, winning, type SiteStyle } from "./sitestyles"
import { settings } from "./state"

const NONE: never[] = []

/** The vault's look as a page's variables (--vault-background...): the app's tokens as they're resolved now. */
function lookVars() {
  const root = document.documentElement, cs = getComputedStyle(root)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  const vars = COLORS.map((c) => [c, v(`--${c}`)])
  for (const [name, token] of Object.entries(FONTS)) vars.push([name, v(token) || v("--font-sans")])
  const dark = root.classList.contains("dark")
  vars.push(["radius", v("--radius")], ["color-scheme", dark ? "dark" : "light"], ["paper-filter", dark ? paperFilter() : "none"])
  return `:root { ${vars.filter(([, x]) => x).map(([k, x]) => `--vault-${k}: ${x};`).join(" ")} }`
}

/** One of the app's colours as #rrggbb (its token may be oklch()), read through a canvas. */
function colorOf(token: string, or: string) {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!ctx) return ""
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || or
  ctx.fillRect(0, 0, 1, 1)
  return `#${[...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((x) => x.toString(16).padStart(2, "0")).join("")}`
}
const background = () => colorOf("--background", "#fff")

/** A filter taking white paper on a canvas (Docs' pages, Sheets' grid: CSS colours can't reach them) to the card and black
 *  text to the foreground, hues kept, chroma scaled to the theme's range (a red word stays red). */
function paperFilter() {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const card = rgb(colorOf("--card", "#000")), fg = rgb(colorOf("--foreground", "#fff")), w = [0.2126, 0.7152, 0.0722]
  const lum = (c: number[]) => c.reduce((s, x, i) => s + x * w[i], 0)
  const k = Math.max(0, lum(fg) - lum(card))
  // out = fg + L(x)·(card − fg) + k·(x − L(x)), one row a channel
  const rows = [0, 1, 2].map((i) => [0, 1, 2].map((j) => w[j] * (card[i] - fg[i]) + k * ((i === j ? 1 : 0) - w[j])).concat(0, fg[i]))
  const values = [...rows.flat(), 0, 0, 0, 1, 0].map((x) => +x.toFixed(4)).join(" ")
  const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='f' color-interpolation-filters='sRGB'><feColorMatrix type='matrix' values='${values}'/></filter></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#f")`
}

/** The desktop app hears the app's background now and as the look changes: a new page shows it till it paints. */
export function useLookBackground() {
  const [color, setColor] = useState(background)
  useEffect(() => onLook(() => setColor(background())), [])
  useEffect(() => { if (color) void webPages?.look?.(color).catch(() => {}) }, [color])
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

/** The app's look, as dark pages need it: whether it's dark, its background and foreground. */
const darkLook = () => ({ dark: document.documentElement.classList.contains("dark"), bg: background(), fg: colorOf("--foreground", "#000") })

/** The desktop app hears how pages follow the app's look while it's dark (index.tsx's Background): on, how, the theme's
 *  colours and the sites turned off (a styled site's pages are judged one by one, as they look with its style). */
export function useDarkPages() {
  const s = settings.use()
  const [look, setLook] = useState(darkLook)
  useEffect(() => onLook(() => setLook(darkLook())), [])
  const choice = { on: look.dark && s.darkPages !== false, look: s.darkPagesLook === "dark" ? "dark" : "theme", bg: look.bg, fg: look.fg,
    off: s.darkPagesOff ?? NONE }
  const key = JSON.stringify(choice)
  useEffect(() => { void Promise.resolve(webPages?.engine?.("darkmode:set", choice)).catch(() => {}) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Whether dark pages apply now: the setting on, the look dark. */
export const darkPagesOn = () => settings.get().darkPages !== false && document.documentElement.classList.contains("dark")
/** Turn dark pages on or off for a site (kept in `darkPagesOff`; on, its parent sites too: they'd cover it). */
export function setDark(site: string, on: boolean) {
  const next = (settings.get().darkPagesOff ?? []).filter((x) => x !== site && !(on && site.endsWith(`.${x}`))).concat(on ? [] : [site])
  void settings.set({ darkPagesOff: next.length ? next : null }).catch((e) => notifyError(e, "Couldn't change it"))
}

/** The style for a page's site (`site` as Shields name it: example.co.uk), the most specific one there is. */
export const styleOf = (styles: SiteStyle[], site: string) => styles.filter((s) => site === s.site || site.endsWith(`.${s.site}`))
  .sort((a, b) => b.site.length - a.site.length)[0]

/** Turn a site's style on or off (kept in `unstyled`). */
export function setStyled(site: string, on: boolean) {
  const next = (settings.get().unstyled ?? []).filter((x) => x !== site).concat(on ? [] : [site])
  void settings.set({ unstyled: next.length ? next : null }).catch((e) => notifyError(e, "Couldn't change it"))
}

/** Edit the style a page at `site` (its host: docs.google.com) gets beside it: the most specific there is (its own, else
 *  its parent site's), else a file for the host from the template, on the right. */
export async function editStyle(site: string) {
  const name = siteName(site)
  if (!name) return
  const had = styleOf(getStore()?.siteStyles ?? [], name)
  const path = had?.path ?? styleFile(name)
  try {
    if (!had) await op("web-viewer.style", { site: name, css: template(name) })
    if ((settings.get().unstyled ?? []).includes(had?.site ?? name)) setStyled(had?.site ?? name, true)
    openInSplit(`file:${path}`, "right")
  } catch (e) { notifyError(e, "Couldn't open its style") }
}
