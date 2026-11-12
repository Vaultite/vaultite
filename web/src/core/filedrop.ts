import { hasFiles } from "@/core/desktop"
import { notify } from "@/core/notify"

export type Dropped = { files: File[]; images: string[]; links: string[] }

export type DropSink = {
  el: HTMLElement
  owns: (el: Element) => boolean
  over: (x: number, y: number) => void
  leave: () => void
  drop: (d: Dropped, x: number, y: number) => void
}

const sinks = new Set<DropSink>()
let current: DropSink | null = null
export function addDropSink(s: DropSink) {
  sinks.add(s)
  return () => { sinks.delete(s); if (current === s) current = null }
}

const shown = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0 && !el.closest("[data-kept], [data-beside], [inert]")
export function sinkAt(target: EventTarget | null): DropSink | null {
  if (!(target instanceof Element)) return null
  const own = target.closest("[data-file-drop]")
  let found: DropSink | null = null
  for (const s of sinks) {
    const place = s.el.closest("[data-pane], dialog, #main-scroll") ?? s.el
    if (!place.contains(target) || !shown(s.el)) continue
    if (own && s.el.contains(own) && !s.owns(own)) return null
    if (!found || s.el.contains(target)) found = s
  }
  return found
}

let inside = false
export const fromOutside = (dt: DataTransfer | null) => !inside && (hasFiles(dt) || (!!dt && [...dt.types].includes("text/uri-list")))

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|tiff?)$/i
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const isImageUrl = (u: string) => /^data:image\//i.test(u) || (() => { try { return IMAGE.test(new URL(u).pathname) } catch { return false } })()

// Read during the drop: after it, a DataTransfer is empty.
export function droppedFrom(dt: DataTransfer | null): Dropped | null {
  if (!dt) return null
  const items = [...dt.items].filter((i) => i.kind === "file"), all = [...dt.files]
  const folder = (i: number) => (items[i] as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null })?.webkitGetAsEntry?.()?.isDirectory
  const files = all.filter((_, i) => !folder(i))
  if (files.length) return { files, images: [], links: [] }
  if (all.length) { notify("A folder can't go into a note, only files", { id: "drop-folder" }); return null }
  // A browser's image only promises its file, which the page can't read: Chrome's and Safari's HTML has its <img>.
  const html = dt.getData("text/html"), src = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1]
  const words = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()
  if (src && !words && /^(https?:|data:image\/)/i.test(decode(src))) return { files: [], images: [decode(src)], links: [] }
  const urls = dt.getData("text/uri-list").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  if (!urls.length) return null
  return { files: [], images: urls.filter(isImageUrl), links: urls.filter((u) => !isImageUrl(u)) }
}

let started = false
export function startFileDrops() {
  if (started) return
  started = true
  addEventListener("dragstart", () => { inside = true }, true)
  addEventListener("dragend", () => { inside = false }, true)
  addEventListener("drop", () => setTimeout(() => { inside = false }), true)
  let quiet = 0
  const leave = () => { current?.leave(); current = null }
  addEventListener("dragover", (e) => {
    if (!fromOutside(e.dataTransfer)) return
    const s = sinkAt(e.target)
    if (s !== current) leave()
    if (!s) return
    current = s
    e.preventDefault()
    e.stopImmediatePropagation()
    e.dataTransfer!.dropEffect = "copy"
    s.over(e.clientX, e.clientY)
    clearTimeout(quiet)
    quiet = window.setTimeout(leave, 350)
  }, true)
  addEventListener("drop", (e) => {
    clearTimeout(quiet)
    leave()
    if (!fromOutside(e.dataTransfer)) return
    const s = sinkAt(e.target)
    if (!s) return
    e.preventDefault()
    e.stopImmediatePropagation() // else CodeMirror reads it into the text too
    const d = droppedFrom(e.dataTransfer)
    if (d) s.drop(d, e.clientX, e.clientY)
  }, true)
}
