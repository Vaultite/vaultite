// The pinned pages (sidebar, drawer, view:pages): drag to reorder, onto a pane to open, elsewhere in the sidebar to
// unpin; drop a file to pin it. The list is the sidebar's (types.ts): the current workspace's with Workspaces on.
import { useEffect, useId, useRef } from "react"
import { FileText, Hash, Heading, Pin, PinOff, Plus, Search } from "lucide-react"
import {
  checklist, cn, currentWorkspace, getStore, headOf, iconOf, isPage, menuFor, offPlugin, openAt, openFile, openingSoon, openItem, openInSplit, openView, panelMenu, PIN_SEARCH,
  rowMenu, selectClick, selectedAttr, selectionFor, SidebarRow, startDrag, stem, useDrag, useDropHit, useDropTarget, useEnabled, useSelectable, useSelectedKeys, useWorkspaceVersion,
  type CheckItem, type DragItem, type MenuItem, type SidebarCtx,
} from "@vaultite"
import { SquareArrowOutUpRight } from "lucide-react"
import { currentPins, isPinned, pin, pinMany, pinManyNoted, pinnable, pinNoted, shownEntries, type PinEntry } from "./types"

const PINS = "pins"
/** A file dragged here can be a page: not a folder, not a file from outside the vault, not a hidden one (or one of the
 *  list's own, a heading or a search, moved within it). */
const canPin = (item: DragItem) => !!item.path && (item.from === "pin" || pinsOf(item).length > 0)
/** What a drop would pin: the dragged file, or the files among several selected in the tree (not folders). */
const pinsOf = (item: DragItem) => (item.from === "pin" ? item.paths ?? [item.path!]
  : item.paths ? item.paths.filter((p) => pinnable(p) && !!getStore()?.files.files.some((f) => f.path === p))
  : !item.folder && item.to?.startsWith("file:") && item.path && pinnable(item.path) ? [item.path] : [])
/** The pinned pages' selection (core/select.ts), by entry key. */
const SELECT = "pins"
/** Where a pinned entry opens, as a tab's target (a heading: its note). */
const targetOf = (e: PinEntry) => (e.kind === "search" ? `view:search/${e.query}` : `file:${e.file.path}`)
/** Open a pinned entry: a page, a note at its heading, a search. */
function openEntry(e: PinEntry, opts: { newTab?: boolean; pane?: string }) {
  if (e.kind === "file") return openFile(e.key, opts)
  if (e.kind === "heading") return openAt(e.file.path, e.heading, opts)
  openView(`search/${e.query}`, { newTab: opts.newTab })
}
/** Where a drop lands: before a page (null: the end; `known`: already pinned, so only its place changes), or `out` of
 *  the list, elsewhere in the sidebar (unpinned). */
type PinDrop = { before: string | null; y: number; known: boolean } | { out: true }

/** The list's menu (Pinned pages ▸): the entries shown, ticked, then More ▸ with every page not pinned (a file a plugin
 *  draws as one: a dashboard) and the file on screen; a `checklist`. Read from the store as it is now: the menu is drawn
 *  again after each click. Two of one name say their folders. */
function pinChecklist(file: string | undefined): MenuItem[] {
  const store = getStore()
  if (!store) return []
  const on = shownEntries(store)
  const pages = store.files.files.filter((f) => isPage(f.path, store) && !f.archived && !offPlugin(f) && !isPinned(f.path))
    .sort((a, b) => stem(a.path).localeCompare(stem(b.path)))
  const here = file && pinnable(file) && !isPinned(file) && !pages.some((f) => f.path === file) ? [file] : []
  const names = [...on.map((e) => e.label), ...pages.map((f) => stem(f.path))]
  const choice = (key: string, label: string): CheckItem => {
    const dir = key.startsWith(PIN_SEARCH) ? "" : key.replace(/#.*$/, "").replace(/\/?[^/]*$/, "")
    return { key, label, hint: names.filter((n) => n === label).length > 1 && dir ? dir.split("/").pop() : undefined }
  }
  return checklist("pins", {
    on: on.map((e) => choice(e.key, e.label)),
    off: [pages.map((f) => choice(f.path, stem(f.path))), here.map((p) => choice(p, stem(p)))],
    set: (key, on, before) => void pin(key, on, on ? before : undefined),
  })
}

/** The heading's +: pin the file on screen, when it can be and isn't yet. */
export function PinCurrent({ file }: { file: string }) {
  useWorkspaceVersion()
  if (!file || !pinnable(file) || isPinned(file)) return null
  return (
    <button type="button" aria-label="Pin current file" data-tip="Pin current file" onClick={() => pinNoted(file, true)}
      className="grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
      <Plus className="size-3.5" strokeWidth={2.25} />
    </button>
  )
}

export function PinnedPages({ store, open, file, panel, pane }: SidebarCtx & {
  /** Open pages in that pane (the Pinned tab opens them beside itself). */
  pane?: string }) {
  useEnabled() // drawn again when a plugin is turned on or off (its pages show or hide)
  useWorkspaceVersion() // and when the workspace, or its pins, change
  const desk = currentWorkspace()
  const pages = shownEntries(store)
  // A page's other tabs (People map) keep its head (People) lit.
  const head = file ? headOf(store.files.files, file) : null
  const lit = (p: string) => p === file || p === head?.path
  const list = useRef<HTMLElement>(null)
  const d = useDrag()
  const dragging = !!d && canPin(d.item)
  // Each list its own target (the sidebar's, and one in a Pinned tab); only the sidebar's unpins what leaves it.
  const target = `${PINS}:${useId()}`
  const hit = useDropHit<PinDrop>(target)
  const line = hit && "y" in hit ? hit.y : null
  useDropTarget<PinDrop>(target, (item, _x, y, el) => {
    const nav = list.current
    if (!el || !nav || !canPin(item)) return null
    if (!nav.contains(el)) return item.from === "pin" && el.closest("aside") && el.closest("aside") === nav.closest("aside") ? { out: true } : null
    const top = nav.getBoundingClientRect().top
    const rows = [...nav.querySelectorAll<HTMLElement>("[data-pin]")]
    const next = rows.find((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2 })
    const last = rows[rows.length - 1]
    const before = next?.dataset.pin ?? null
    const all = currentPins(store)
    const keys = pinsOf(item)
    const known = keys.every((k) => all.includes(k))
    // Its own place (just before itself, or before the one after it): nothing to do.
    if (known && keys.length === 1) {
      const rest = all.filter((p) => p !== item.path), i = before ? rest.indexOf(before) : rest.length
      if (i === all.indexOf(item.path!)) return null
    }
    const end = last ? last.getBoundingClientRect().bottom - top : 2
    return { before, y: next ? next.getBoundingClientRect().top - top - 1 : end, known }
  }, (item, h) => {
    const keys = pinsOf(item)
    if (keys.length === 1) void pin(keys[0], !("out" in h), "out" in h ? undefined : h.before)
    else if ("out" in h) void pinManyNoted(keys, false)
    // (Placed before the first one after them that isn't among them.)
    else void pinMany(keys, true, h.before && keys.includes(h.before) ? currentPins(store).slice(currentPins(store).indexOf(h.before)).find((k) => !keys.includes(k)) ?? null : h.before)
  }, {
    // Words only for what changes more than the order: pinning a file, unpinning a page.
    hint: (h) => ("out" in h ? "Unpin" : h.known ? undefined : desk ? `Pin in ${desk.label}` : "Pin"),
    weak: (h) => "out" in h,
  })
  const picks = useSelectedKeys(SELECT)
  useSelectable(SELECT, { noun: ["page", "pages"], menu: (keys) => {
    const shown = shownEntries(store).filter((e) => keys.includes(e.key))
    return [
      { label: shown.length === 1 ? "Open in new tab" : `Open ${shown.length} in new tabs`, icon: SquareArrowOutUpRight, run: () => shown.forEach((e) => openEntry(e, { newTab: true, pane })) },
      { label: "Unpin", icon: PinOff, run: () => void pinManyNoted(keys, false) },
    ]
  } })
  // In a submenu (Pinned pages ▸), then the panel's own menu (which panels the sidebar shows, as anywhere else in it).
  const menu = (): MenuItem[] => {
    const items = pinChecklist(file)
    return panel ? [{ label: "Pinned pages", icon: Pin, run: () => {}, items }, ...panelMenu(panel)] : items
  }
  // A page just pinned (from a menu, a drop, another device) is scrolled into view: the panel may be shorter than its
  // pages, scrolling in its own box.
  const shownKey = pages.map((x) => x.key).join("\n")
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const now = new Set(shownKey ? shownKey.split("\n") : [])
    const was = seen.current
    seen.current = now
    if (!was || !open) return
    const added = [...now].find((k) => !was.has(k))
    if (added) list.current?.querySelector<HTMLElement>(`[data-pin="${CSS.escape(added)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [shownKey, open])
  if (!open && !pages.length) return null
  const row = (entry: PinEntry) => {
    const id = entry.key, to = targetOf(entry)
    const picked = picks.has(id)
    const file = entry.kind === "search" ? null : entry.file.path
    const icon = entry.kind === "search" ? Search : entry.kind === "heading" ? (entry.heading.startsWith("^") ? Hash : Heading) : iconOf(entry.file) ?? FileText
    return (
      <div key={id} onPointerDown={(e) => {
        if (file) openingSoon(file, true)
        const keys = selectionFor(SELECT, id, false)
        startDrag(e, keys && keys.length > 1 ? { from: "pin", to, path: id, paths: keys, label: `${keys.length} pages` } : { from: "pin", to, path: id }, { touch: true })
      }}
        onPointerEnter={() => file && openingSoon(file)} onPointerLeave={() => openingSoon(null)}
        // Right-clicked on a page: what the file tree offers to open a file, unpinning it, then the list's menu.
        onContextMenu={menuFor(rowMenu(SELECT, id, () => [
          openItem(() => openEntry(entry, { newTab: true, pane }), () => openInSplit(to, "right")),
          { label: "Unpin", icon: PinOff, run: () => pinNoted(id, false) },
          ...menu().map((it, i) => (i ? it : { ...it, sep: true })),
        ]))}
        className={cn(d?.item.from === "pin" && (d.item.path === id || (picked && d.item.paths)) && "opacity-40")}>
        <SidebarRow data-pin={id} data-select-key={id} {...selectedAttr(picked)} href={`#${entry.kind === "search" ? `view/${encodeURIComponent(`search/${entry.query}`)}` : `file/${encodeURIComponent(file!)}`}`} icon={icon}
          label={entry.label} open={open} active={entry.kind === "file" && lit(id)} swipe={() => [{ label: "Unpin", icon: PinOff, run: () => pinNoted(id, false), removes: true }]}
          onClick={(e) => { if (!selectClick(e, SELECT, id, entry.kind === "file" && lit(id) ? id : null)) openEntry(entry, { newTab: e.metaKey || e.ctrlKey || e.button === 1, pane }) }} />
      </div>
    )
  }
  return (
    <nav ref={list} aria-label="Pages" onContextMenu={menuFor(menu)}
      className={cn("relative shrink-0", dragging && !pages.length && "min-h-8 rounded-[6px] border border-dashed border-border")}>
      <div className="flex flex-col gap-px" data-select-list={SELECT}>{pages.map(row)}</div>
      {line !== null && <div aria-hidden data-pin-line className="pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary" style={{ top: line }} />}
    </nav>
  )
}
