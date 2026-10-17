// One right-click menu for whatever `![[x]]` shows: what fits its kind (copy, its size, the embed taken out, open), then
// its file's menu (FileActions' fileMenu, the plugins' items too). A file's own tab has the same (mediaItems).
import type { ReactNode } from "react"
import { AppWindow, Copy, Download, Eraser, Scaling } from "lucide-react"
import type { Store } from "@/core/data"
import { openAt } from "@/core/anchors"
import { kindOf } from "@/core/filekinds"
import { findEmbed, isMd, openFile } from "@/core/files"
import { resolver } from "@/core/links"
import { notify, notifyError } from "@/core/notify"
import { formatFor } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { openInSplit } from "@/core/splits"
import { isDesktop } from "@/core/platform"
import { openMenu, type MenuItem } from "@/components/ContextMenu"
import { canOpenHere, copyToVaultItem, fileMenu, grouped, openHere, openItem, revealItem } from "@/components/FileActions"
import { rawUrl } from "@/components/FileViewers"
import { noteFor } from "@/components/NoteEmbed"
import type { EmbedEdit } from "@/editor/livePreview"
import { splitAnchor } from "../../../core/sections.ts"

/** The vault file an image embed names (`![[photo.png]]`, `![](Attachments/photo.png)`), or null. */
export function assetPath(store: Store, name: string, from?: string): string | null {
  let t = name.trim()
  try { t = decodeURIComponent(t) } catch { /* as written */ }
  // Found as a link is (the closest of its name); a hidden folder's file, which links don't name, by its path.
  const hit = resolver(store)(t, from)?.file
  if (hit) return store.files.others.some((o) => o.path === hit) ? hit : null
  const low = t.toLowerCase().replace(/^(\.\.?\/)+|^\/+/, "")
  return store.files.others.find((o) => o.path.toLowerCase() === low)?.path ?? null
}

/** The file `![[target]]` shows (`from`: the note it's in, for `![[#Heading]]`), or null (a web image, nothing). */
const embedPath = (store: Store, target: string, from = "") =>
  findEmbed(store, target, from) ?? assetPath(store, target, from) ?? noteFor(store, target, from)

/** The menu for `![[target]]` (or an image's `![](target)`): what's about the embed, then its file's own menu.
 *  `edit`: what changes it in the note it's in. */
function embedItems(store: Store, target: string, edit?: EmbedEdit | null, from = ""): MenuItem[] {
  const path = embedPath(store, target, from)
  const image = path ? kindOf(path) === "image" : true
  const note = !!path && isMd(path) && !formatFor(path, getPrefs().disabled)
  // (an audio player or a note has no size to reset)
  const sized = image || (!!path && !note && kindOf(path) !== "audio")
  const anchor = note ? splitAnchor(target)[1] : ""
  const own: MenuItem[] = [
    ...(image ? [{ label: "Copy image", icon: Copy, run: () => void copyImage(path ? rawUrl(path) : target) }] : []),
    ...(edit?.writable ? [
      ...(sized ? [{ label: "Reset size", icon: Scaling, disabled: !edit.size, run: () => edit.resize(null) }] : []),
      { label: "Remove embed", icon: Eraser, run: edit.remove },
    ] : []),
  ]
  if (!path) return own
  const desk = isDesktop()
  return fileMenu(path, { inside: true, phone: !desk, top: [own, [
    openItem(() => (anchor ? openAt(path, anchor, { newTab: true }) : openFile(path, { newTab: true })), desk ? () => openInSplit(`file:${path}`, "right") : undefined),
    ...(isMd(path) ? [] : [...openHereItem(path), { label: "Download", icon: Download, run: () => download(path) }]),
  ]] })
}

/** The menu of an image, PDF or other file shown in its own tab (FileView's MediaFile): copy it, open it elsewhere,
 *  then its file's own menu; one from outside the vault: copy it, Copy to vault, Reveal in Finder. */
export function mediaItems(path: string, outside: boolean): MenuItem[] {
  const copy: MenuItem[] = kindOf(path) === "image" ? [{ label: "Copy image", icon: Copy, run: () => void copyImage(rawUrl(path)) }] : []
  if (outside) return grouped([copy, [copyToVaultItem(path), ...openHereItem(path), ...revealItem(path)]])
  return fileMenu(path, { phone: !isDesktop(), top: [[...copy, ...openHereItem(path), { label: "Download", icon: Download, run: () => download(path) }]] })
}

const openHereItem = (path: string): MenuItem[] => (canOpenHere() ? [{ label: "Open in default app", icon: AppWindow, run: () => openHere(path) }] : [])

export const openEmbedMenu = (store: Store, target: string, at: { x: number; y: number }, edit?: EmbedEdit | null, from = "") =>
  openMenu(at, embedItems(store, target, edit, from))

/** Around an embed drawn with React: its menu on right-click, unless something in it answered first (a drawing's own
 *  menu) or it's in a note's text, where the text's menu stays. `display: contents`: no box of its own. */
export function EmbedMenu({ store, target, from, edit, children }: { store: Store; target: string; from: string; edit?: () => EmbedEdit | null; children: ReactNode }) {
  return (
    <div className="contents" data-embed-menu
      onContextMenu={(e) => {
        if (e.defaultPrevented || (e.target as Element).closest(".note-embed-body, [data-embed-menu]")?.matches(".note-embed-body")) return
        e.preventDefault(); e.stopPropagation()
        openEmbedMenu(store, target, { x: e.clientX, y: e.clientY }, edit?.(), from)
      }}>
      {children}
    </div>
  )
}

/** Save a file from the vault (on a phone: to Files or Photos). */
function download(path: string) {
  const a = document.createElement("a")
  a.href = rawUrl(path, { download: true })
  a.download = path.split("/").pop()!
  a.click()
}

/** Put an image on the clipboard, as a PNG (the one kind every app takes). */
async function copyImage(url: string) {
  try {
    const png = fetch(url).then((r) => r.blob()).then(async (b) => {
      if (b.type === "image/png") return b
      const bmp = await createImageBitmap(b)
      const c = document.createElement("canvas")
      c.width = bmp.width; c.height = bmp.height
      c.getContext("2d")!.drawImage(bmp, 0, 0)
      return new Promise<Blob>((ok, no) => c.toBlob((x) => (x ? ok(x) : no(new Error("Couldn't read the image"))), "image/png"))
    })
    // (the promise itself: Safari wants the write started while the click is still on)
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
    notify("Copied the image", { id: "copied" })
  } catch (e) { notifyError(e, "Couldn't copy the image") }
}
