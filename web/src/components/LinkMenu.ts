import { Box, Copy, Ellipsis, ExternalLink, FilePlus, Globe, Hash, Link, Mail, Pencil, Pin, SquareArrowOutUpRight, Unlink } from "lucide-react"
import { openAt } from "@/core/anchors"
import { getStore, type Store } from "@/core/data"
import { fileOf, openFile } from "@/core/files"
import { setProperty } from "@/core/frontmatter"
import { notify, notifyError } from "@/core/notify"
import { webContainers, webLinkOpensIn } from "@/core/plugins"
import type { WebContainer } from "@/core/define"
import { followLink, linkPlace, openTag, openWebLink, shortestLink, type Link as Linked } from "@/core/links"
import { desktop } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { openInSplit } from "@/core/splits"
import { openMenu, type MenuItem } from "@/components/ContextMenu"
import { copied, fileMenu, grouped, openItem } from "@/components/FileActions"
import { dotIcon } from "@/components/ColorDot"
import { colorVar } from "../../../core/colors.ts"
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
  const copyText: MenuItem[] = text && text !== written && text !== link.wiki?.replace(/#/g, " › ") ? [{ label: "Copy link text", icon: Copy, run: () => copied(text, "text") }] : []
  const url = link.url && /^[a-z][a-z0-9+.-]*:/i.test(link.url) ? link.url : null
  if (url) {
    const mail = /^mailto:/i.test(url) ? url.slice(7).split("?")[0] : ""
    let address = mail
    try { address = decodeURIComponent(mail) } catch {}
    const web = !!desktop?.web && /^https?:/i.test(url)
    const out: MenuItem[] = web ? [{ label: "Open link in another browser", icon: Globe, run: () => openWebLink(url, { newTab: false, out: true }) }] : []
    return grouped([
      [{ label: "Open link", icon: ExternalLink, run: () => follow(false) }, ...(web ? inContainer(s, url, from) : []), ...out],
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
  const name = splitAnchor(link.wiki ?? link.url ?? "")[0].replace(/\.md$/i, ""), other = /\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(name)
  return grouped([
    [place || other ? { label: "Open", icon: SquareArrowOutUpRight, run: () => follow(false) } : { label: `Create note “${name}”`, icon: FilePlus, run: () => follow(false) }],
    [{ label: "Copy link", icon: Link, run: () => copied(link.wiki !== undefined ? `[[${link.wiki}]]` : written, "link") }, ...copyText],
    change,
  ])
}

function inContainer(s: Store, url: string, from?: string): MenuItem[] {
  const list = webContainers()
  if (!list.length) return []
  const note = from ? fileOf(s, from)?.container : undefined, key = note?.trim().toLowerCase()
  const mine = key ? list.find((c) => c.id === key) ?? list.find((c) => c.name.toLowerCase() === key) : undefined
  const now = webLinkOpensIn(url, note)
  const open = (container: string | null) => openWebLink(url, { newTab: true, front: true, container })
  const always = (path: string, c: WebContainer) => {
    const off = mine?.id === c.id
    void setProperty(path, "container", off ? undefined : c.id).then(() => notify(off ? `This note's links no longer open in ${c.name}` : `This note's links open in ${c.name}`,
      { action: { label: "Undo", run: () => void setProperty(path, "container", note).catch((e) => notifyError(e, "Couldn't undo it")) } }),
    (e) => notifyError(e, "Couldn't change the note"))
  }
  const dot = (c: WebContainer) => dotIcon(colorVar(c.color))
  return [{ label: "Open link in container", icon: Box, run: () => {}, items: [
    { label: "No container", icon: Box, checked: now === null, run: () => open(null) },
    ...list.map((c) => ({ label: c.name, icon: dot(c), checked: now === c.id, run: () => open(c.id) })),
    ...(from && /\.md$/i.test(from) ? [{ label: "Always open this note's links in", icon: Pin, sep: true, run: () => {},
      items: list.map((c) => ({ label: c.name, icon: dot(c), checked: mine?.id === c.id, run: () => always(from, c) })) }] : []),
  ] }]
}

export const openLinkMenu = (link: Linked, at: { x: number; y: number }, opts: Parameters<typeof linkItems>[1] = {}) =>
  openMenu(at, linkItems(link, opts))
