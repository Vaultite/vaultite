// What's dragged in from outside (Finder's files, a screenshot's thumbnail, a browser's image or link), taken by the note
// shown wherever in its place it lands (FileView: addDropSink), not opened beside the vault; a lone editor takes its own.
import { hasFiles } from "@/core/desktop"
import { notify } from "@/core/notify"

/** Files, images by their address (a browser's: saved into the vault too) and links, dropped from outside. */
export type Dropped = { files: File[]; images: string[]; links: string[] }

export type DropSink = {
  /** The note's element (FileView's article). */
  el: HTMLElement
  /** Whether a `[data-file-drop]` the drop is in is the note's own (its editor), not something in it with drops of
   *  its own (a canvas). */
  owns: (el: Element) => boolean
  /** Dragged over at (x, y): show where it would go. */
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
/** The note that takes a drop on `target`: the one shown in the same place (a tab's scroller, the sheet, a phone's
 *  screen); none when the drop is on something in it that takes drops itself. */
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

/** A drag that began in this window (a [[link]] dragged out of the text, an image in a note): never taken as one
 *  from outside. The app's own drags (core/drag.ts) aren't HTML5 ones at all. */
let inside = false
/** Whether `dt` comes from outside the app with something a note can take: files, or a web address. */
export const fromOutside = (dt: DataTransfer | null) => !inside && (hasFiles(dt) || (!!dt && [...dt.types].includes("text/uri-list")))

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|heic|heif|bmp|tiff?)$/i
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
const isImageUrl = (u: string) => /^data:image\//i.test(u) || (() => { try { return IMAGE.test(new URL(u).pathname) } catch { return false } })()

/** What a drop carries (read during the drop: after it, a DataTransfer is empty). Folders aren't files a note can
 *  take: dropped alone, a note says so, and it's null. */
export function droppedFrom(dt: DataTransfer | null): Dropped | null {
  if (!dt) return null
  const items = [...dt.items].filter((i) => i.kind === "file"), all = [...dt.files]
  const folder = (i: number) => (items[i] as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null })?.webkitGetAsEntry?.()?.isDirectory
  const files = all.filter((_, i) => !folder(i))
  if (files.length) return { files, images: [], links: [] }
  if (all.length) { notify("A folder can't go into a note, only files", { id: "drop-folder" }); return null }
  // A browser's image (its file only promised, which the page can't read): its <img> alone in the HTML (Chrome's,
  // Safari's), else addresses that name an image
  const html = dt.getData("text/html"), src = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1]
  const words = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()
  if (src && !words && /^(https?:|data:image\/)/i.test(decode(src))) return { files: [], images: [decode(src)], links: [] }
  const urls = dt.getData("text/uri-list").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  if (!urls.length) return null
  return { files: [], images: urls.filter(isImageUrl), links: urls.filter((u) => !isImageUrl(u)) }
}

let started = false
/** Listen for drags from outside over the window (once, from main.tsx through startDesktop): one over a note's place
 *  is the note's, before anything else hears it. */
export function startFileDrops() {
  if (started) return
  started = true
  addEventListener("dragstart", () => { inside = true }, true)
  // (and after a drop anywhere, should its dragend not come: its element gone from the page)
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
    e.stopImmediatePropagation() // (not opened outside the vault, nor read into the text by the editor)
    const d = droppedFrom(e.dataTransfer)
    if (d) s.drop(d, e.clientX, e.clientY)
  }, true)
}
