import { useEffect, useState } from "react"
import { getStore, notifyError, onLook, op, openInSplit, useStore, webPages } from "@vaultite"
import { COLORS, FONTS, siteName, styleFile, template, winning, type SiteStyle } from "./sitestyles"
import { settings } from "./state"

const NONE: never[] = []

function lookVars() {
  const root = document.documentElement, cs = getComputedStyle(root)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  const vars = COLORS.map((c) => [c, v(`--${c}`)])
  for (const [name, token] of Object.entries(FONTS)) vars.push([name, v(token) || v("--font-sans")])
  const dark = root.classList.contains("dark")
  vars.push(["radius", v("--radius")], ["color-scheme", dark ? "dark" : "light"], ["paper-filter", dark ? paperFilter() : "none"])
  return `:root { ${vars.filter(([, x]) => x).map(([k, x]) => `--vault-${k}: ${x};`).join(" ")} }`
}

function colorOf(token: string, or: string) {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!ctx) return ""
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || or
  ctx.fillRect(0, 0, 1, 1)
  return `#${[...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((x) => x.toString(16).padStart(2, "0")).join("")}`
}
const background = () => colorOf("--background", "#fff")

// Docs' pages and Sheets' grid are canvases, which CSS colours can't reach: a filter takes their white to the card.
function paperFilter() {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const card = rgb(colorOf("--card", "#000")), fg = rgb(colorOf("--foreground", "#fff")), w = [0.2126, 0.7152, 0.0722]
  const lum = (c: number[]) => c.reduce((s, x, i) => s + x * w[i], 0)
  const k = Math.max(0, lum(fg) - lum(card))
  const rows = [0, 1, 2].map((i) => [0, 1, 2].map((j) => w[j] * (card[i] - fg[i]) + k * ((i === j ? 1 : 0) - w[j])).concat(0, fg[i]))
  const values = [...rows.flat(), 0, 0, 0, 1, 0].map((x) => +x.toFixed(4)).join(" ")
  const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='f' color-interpolation-filters='sRGB'><feColorMatrix type='matrix' values='${values}'/></filter></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}#f")`
}

export function useLookBackground() {
  const [color, setColor] = useState(background)
  useEffect(() => onLook(() => setColor(background())), [])
  useEffect(() => { if (color) void webPages?.look?.(color).catch(() => {}) }, [color])
}

const tell = (vars: string, styles: { site: string; css: string }[]) =>
  Promise.resolve(webPages?.engine?.("sitestyles:set", { vars, styles })).catch(() => {})

export function useSiteStyles() {
  const styles = useStore().store?.siteStyles ?? NONE
  const off = settings.use().unstyled ?? NONE
  const [vars, setVars] = useState(lookVars)
  useEffect(() => onLook(() => setVars(lookVars())), [])
  const on = styles.filter((s) => !off.includes(s.site)).map((s) => ({ site: s.site, css: winning(s.css) }))
  const key = JSON.stringify([vars, on])
  useEffect(() => { if (webPages?.engine) void tell(vars, on) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

const darkLook = () => ({ dark: document.documentElement.classList.contains("dark"), bg: background(), fg: colorOf("--foreground", "#000") })

export function useDarkPages() {
  const s = settings.use()
  const [look, setLook] = useState(darkLook)
  useEffect(() => onLook(() => setLook(darkLook())), [])
  const choice = { on: look.dark && s.darkPages !== false, look: s.darkPagesLook === "dark" ? "dark" : "theme", bg: look.bg, fg: look.fg,
    off: s.darkPagesOff ?? NONE }
  const key = JSON.stringify(choice)
  useEffect(() => { void Promise.resolve(webPages?.engine?.("darkmode:set", choice)).catch(() => {}) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

export const darkPagesOn = () => settings.get().darkPages !== false && document.documentElement.classList.contains("dark")
export function setDark(site: string, on: boolean) {
  const next = (settings.get().darkPagesOff ?? []).filter((x) => x !== site && !(on && site.endsWith(`.${x}`))).concat(on ? [] : [site])
  void settings.set({ darkPagesOff: next.length ? next : null }).catch((e) => notifyError(e, "Couldn't change it"))
}

export const styleOf = (styles: SiteStyle[], site: string) => styles.filter((s) => site === s.site || site.endsWith(`.${s.site}`))
  .sort((a, b) => b.site.length - a.site.length)[0]

export function setStyled(site: string, on: boolean) {
  const next = (settings.get().unstyled ?? []).filter((x) => x !== site).concat(on ? [] : [site])
  void settings.set({ unstyled: next.length ? next : null }).catch((e) => notifyError(e, "Couldn't change it"))
}

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
