import { app, nativeImage, type Session } from "electron"
import { AppWindow } from "./appwindow.ts"
import { writeAtomic } from "./setup.ts"
import fs from "node:fs"
import path from "node:path"
import { ICONS } from "./webwire.ts"
import { type Page, tell, web } from "./webbase.ts"

let icons: Map<string, string> | null = null
export const staleIcons = new Set<string>()
const iconSrc = new Map<string, string>()
const iconAsked = new Set<string>()
const ICON_MAX = 256 * 1024
const ICONS_KEPT = 300
const ICONS_VERSION = 2
const iconsFile = () => path.join(app.getPath("userData"), "web-icons.json")
function iconKey(u: string, page = false) {
  try {
    const x = new URL(u), host = x.host.replace(/^www\./, "")
    const seg = page ? x.pathname.split("/")[1] ?? "" : ""
    return seg ? `${host}/${seg}` : host
  } catch { return "" }
}
export const isIcon = (s: string) => s.length < ICON_MAX * 1.4 && /^data:image\/(png|jpeg|gif|webp|x-icon|svg\+xml);base64,[A-Za-z0-9+/]+=*$/.test(s)
export function loadIcons() {
  if (!icons) {
    icons = new Map()
    try {
      const j = ICONS.parse(JSON.parse(fs.readFileSync(iconsFile(), "utf8")))
      for (const [h, v] of Object.entries(j?.icons ?? {})) if (typeof v === "string" && isIcon(v)) icons.set(h, v)
      if (j?.v !== ICONS_VERSION) for (const h of icons.keys()) staleIcons.add(h)
    } catch { /* none yet, or unreadable: they're fetched again */ }
  }
  return icons
}
let iconsSaving: ReturnType<typeof setTimeout> | null = null
function saveIcons() {
  iconsSaving ??= setTimeout(() => {
    iconsSaving = null
    try { writeAtomic(iconsFile(), JSON.stringify({ v: ICONS_VERSION, icons: Object.fromEntries(loadIcons()) })) } catch { /* kept in memory */ }
  }, 2000)
}
function setIcon(key: string, icon: string | null) {
  const all = loadIcons()
  staleIcons.delete(key)
  if ((all.get(key) ?? null) === icon) return
  all.delete(key)
  if (icon) all.set(key, icon)
  for (const h of [...all.keys()].slice(0, Math.max(0, all.size - ICONS_KEPT))) all.delete(h)
  saveIcons()
  for (const w of AppWindow.getAllWindows()) tell(w, { type: "icon", host: key, icon: icon ?? "" })
}

/** An image's bytes as an icon: PNG or JPEG redrawn at 64px at most, the formats a page's <img> reads (ICO, SVG,
 *  GIF, WebP) as they are; null for anything else (an HTML error page, an empty answer). */
export function iconOf(buf: Buffer): string | null {
  if (!buf.length || buf.length > ICON_MAX) return null
  const img = nativeImage.createFromBuffer(buf)
  if (!img.isEmpty()) {
    const { width, height } = img.getSize()
    if (width < 1 || height < 1) return null
    return (Math.max(width, height) > 64 ? img.resize(width >= height ? { width: 64, quality: "best" } : { height: 64, quality: "best" }) : img).toDataURL()
  }
  const head = buf.subarray(0, 512).toString("latin1")
  const mime = buf.length >= 4 && buf.readUInt32BE(0) === 0x00000100 ? "x-icon"
    : head.startsWith("GIF8") ? "gif"
    : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP" ? "webp"
    : /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head) ? "svg+xml" : ""
  return mime ? `data:image/${mime};base64,${buf.toString("base64")}` : null
}

export async function iconBytes(s: Session, url: string): Promise<Buffer | null> {
  const data = /^data:image\/[\w.+-]+(;[\w-]+=[\w-]+)*(;base64)?,/i.exec(url)
  if (data) {
    const body = url.slice(data[0].length)
    try { return data[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8") } catch { return null }
  }
  if (!web(url)) return null
  try {
    const r = await s.fetch(url, { signal: AbortSignal.timeout(8000), credentials: "include" })
    if (!r.ok || Number(r.headers.get("content-length") ?? 0) > ICON_MAX) return null
    return Buffer.from(await r.arrayBuffer())
  } catch { return null }
}
async function firstIcon(s: Session, urls: string[], still = () => true) {
  for (const u of urls) {
    if (!still()) return null
    let icon: string | null = null
    try { const b = await iconBytes(s, u); icon = b && iconOf(b) } catch { icon = null }
    if (icon && isIcon(icon)) return { icon, from: u }
  }
  return null
}

const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/i
export async function hostIcon(s: Session, host: string, fallback?: string) {
  if (!host || (loadIcons().has(host) && !staleIcons.has(host)) || iconAsked.has(host)) return
  iconAsked.add(host)
  const got = await firstIcon(s, [`${LOCAL_HOST.test(host) ? "http" : "https"}://${host}/favicon.ico`])
  if (got) { iconSrc.set(host, got.from); setIcon(host, got.icon) }
  else if (fallback && !loadIcons().has(host)) setIcon(host, fallback)
}

export async function iconFrom(p: Page, urls: unknown) {
  const list = (Array.isArray(urls) ? urls : []).filter((u): u is string => typeof u === "string" && (web(u) || /^data:image\//i.test(u))).slice(0, 4)
  const page = p.view.webContents.getURL(), host = iconKey(page), key = iconKey(page, true)
  if (!host || !web(page)) return
  try { const fav = new URL("/favicon.ico", page).href; if (!list.includes(fav)) list.push(fav) } catch { /* no origin */ }
  const told = list.join(" ")
  if (p.icons === told) return
  p.icons = told
  if (iconSrc.get(key) === list[0] && loadIcons().has(key)) return
  const s = p.view.webContents.session
  const got = await firstIcon(s, list, () => !p.view.webContents.isDestroyed() && p.icons === told)
  if (!got) return
  iconSrc.set(key, got.from)
  if (key === host) { iconAsked.add(host); setIcon(host, got.icon); return }
  await hostIcon(s, host, got.icon)
  setIcon(key, loadIcons().get(host) === got.icon ? null : got.icon)
}
