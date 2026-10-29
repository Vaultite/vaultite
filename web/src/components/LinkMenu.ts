// One right-click menu for a link wherever drawn Markdown has one (a note, read or edited; a sheet, a timeline): open
// it, copy it, change it where it's written; a link to a file has the file's own menu too, as Obsidian's does.
import { Copy, Ellipsis, ExternalLink, FilePlus, Globe, Hash, Link, Mail, Pencil, SquareArrowOutUpRight, Unlink } from "lucide-react"
import { openAt } from "@/core/anchors"
import { getStore } from "@/core/data"
import { openFile } from "@/core/files"
import { followLink, linkPlace, openTag, openWebLink, shortestLink, type Link as Linked } from "@/core/links"
import { desktop } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { openInSplit } from "@/core/splits"
import { openMenu, type MenuItem } from "@/components/ContextMenu"
import { copied, fileMenu, grouped, openItem } from "@/components/FileActions"
import { splitAnchor, tagName } from "../../../core/sections.ts"

/** What changes a link where it's written (an editor's): its target selected to type over, or the link taken out
 *  leaving its text. */
export type LinkEdit = { edit: () => void; unlink?: () => void }

/** The menu for a link (`from`: the file it's in; `text`: what it shows; `edit`: where it can be changed). */
export function linkItems(link: Linked, opts: { from?: string; text?: string; edit?: LinkEdit | null } = {}): MenuItem[] {
  const s = getStore()
  if (!s) return []
  const { from, text = "", edit } = opts
  const follow = (newTab: boolean) => void followLink(s, link, newTab, from)
  if (link.tag) {
    const tag = `#${tagName(link.tag)}`
    return grouped([[{ label: `Show files with ${tag}`, icon: Hash, run: () => openTag(link.tag!) }, { label: "Copy tag", icon: Copy, run: () => copied(tag, "tag") }]])
  }
  const change: MenuItem[] = edit ? [{ label: "Edit link", icon: Pencil, run: edit.edit }, ...(edit.unlink ? [{ label: "Remove link", icon: Unlink, run: edit.unlink }] : [])] : []
  const written = link.url ?? link.wiki ?? ""
  // (a [[link]] shows its target: its text is worth copying only when it says something else, an alias)
  const copyText: MenuItem[] = text && text !== written && text !== link.wiki?.replace(/#/g, " › ") ? [{ label: "Copy link text", icon: Copy, run: () => copied(text, "text") }] : []
  const url = link.url && /^[a-z][a-z0-9+.-]*:/i.test(link.url) ? link.url : null
  if (url) {
    const mail = /^mailto:/i.test(url) ? url.slice(7).split("?")[0] : ""
    let address = mail
    try { address = decodeURIComponent(mail) } catch { /* as written */ }
    // (in the desktop app a web link opens in its Browser: the system's on asking)
    const out: MenuItem[] = desktop?.web && /^https?:/i.test(url) ? [{ label: "Open link in another browser", icon: Globe, run: () => openWebLink(url, { newTab: false, out: true }) }] : []
    return grouped([
      [{ label: "Open link", icon: ExternalLink, run: () => follow(false) }, ...out],
      [mail ? { label: "Copy email address", icon: Mail, run: () => copied(address, "email address") } : { label: "Copy link", icon: Link, run: () => copied(url, "link") }, ...copyText],
      change,
    ])
  }
  const place = linkPlace(s, link, from)
  if (place?.file) {
    const file = place.file, anchor = place.anchor ?? "", desk = isDesktop()
    return grouped([
      [openItem(() => (anchor ? openAt(file, anchor, { newTab: true }) : openFile(file, { newTab: true })), desk ? () => openInSplit(`file:${file}`, "right") : undefined)],
      [{ label: "Copy link", icon: Link, run: () => copied(`[[${shortestLink(s, file)}${anchor ? `#${anchor}` : ""}]]`, "link") }, ...copyText],
      change,
      [{ label: "More file actions", icon: Ellipsis, run: () => {}, items: fileMenu(file, { inside: true, phone: !desk }) }],
    ])
  }
  // A plugin's page (a person with no file), or a note that isn't there yet: a click's way, and the link as written.
  // (a missing file of another kind, `[pdf](a.pdf)`, isn't made as a note: a click says it isn't there)
  const name = splitAnchor(link.wiki ?? link.url ?? "")[0].replace(/\.md$/i, ""), other = /\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(name)
  return grouped([
    [place || other ? { label: "Open", icon: SquareArrowOutUpRight, run: () => follow(false) } : { label: `Create note “${name}”`, icon: FilePlus, run: () => follow(false) }],
    [{ label: "Copy link", icon: Link, run: () => copied(link.wiki !== undefined ? `[[${link.wiki}]]` : written, "link") }, ...copyText],
    change,
  ])
}

export const openLinkMenu = (link: Linked, at: { x: number; y: number }, opts: Parameters<typeof linkItems>[1] = {}) =>
  openMenu(at, linkItems(link, opts))
