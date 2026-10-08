// Phones: the tabs as cards, like Chrome's tab grid (a pane of several tabs is a group). Swipe or X closes, hold for
// its menu, hold and move to reorder or group, while the others make room. Swiped elsewhere, the next workspace's.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react"
import { createPortal, flushSync } from "react-dom"
import { CheckSquare, ChevronDown, ChevronLeft, Ellipsis, Group as GroupIcon, Plus, Search, Ungroup, X } from "lucide-react"
import { onAway } from "@/core/away"
import type { Store } from "@/core/data"
import { activeTab, closeTab, closeTabIds, closeTabs, getWorkspace, groupOfTab, replaceTabTarget, tabCount, useWorkspace } from "@/core/workspace"
import { canGroup, groupTabs, joinGroup, leaveGroup, placeTab, ungroup } from "@/core/splits"
import { isSplit, layout, leaves, tabPath, type Group, type Tab, type Workspace } from "@/core/layout"
import { edgeScroller, fingerHolding, rehit, startDrag, useDrag, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
import { workspaces, useWorkspaceVersion } from "@/core/scope"
import type { WorkspaceInfo } from "@/core/define"
import { newPhoneTab, pickTab } from "@/core/phoneTabs"
import { headerItems, names, viewFor } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { haptic } from "@/core/haptics"
import { Badged, PageHeader, usePortalHost } from "@/components/kit"
import { TABS, tabCardMenu, tabsMenu, type TabInfo } from "@/components/Tabs"
import { rowMenu, selectClick, selectedAttr, selecting, startSelecting, useSelectable, useSelected } from "@/core/select"
import { menuBelow, menuOnCard, type MenuItem } from "@/components/ContextMenu"
import { NewTab } from "@/components/NewTab"
import { TabPreview } from "@/components/TabPreview"
import { spring, useLingeringSheet } from "@/core/motion"
import { cn } from "@/lib/utils"
import { Drawn, Guard } from "@/components/Guard"

const EASE = "cubic-bezier(.2,.8,.2,1)"
/** What cards making room for a lifted one move with: barely past their place and back, like a native grid's. */
const SPRING = spring(0.86, 0.3)
/** What cards closing up after one goes move with: no overshoot (the list would seem to wobble). */
const CLOSE_UP = "280ms cubic-bezier(.2, 0, 0, 1)"
/** How long a lifted card rests over another's middle before the two group, and still on its edge before it takes its
 *  place (moving on an edge, not towards the middle, takes it at once). */
const GROUP_MS = 300
const MOVE_MS = 40
const isOpen = (id: string) => leaves(getWorkspace().root).some((g) => g.tabs.some((t) => t.id === id))
/** What a card dropped in the list does: placed before or after a tab, grouped with one, into a group, out of its own. */
type ListHit = { kind: "before" | "after" | "into"; tab: string } | { kind: "join"; group: string } | { kind: "out" }
/** Where a lifted card would go among its pane's tabs. */
type Placed = { kind: "before" | "after"; tab: string }
const CARD = "relative isolate flex aspect-[3/4] scroll-mt-[calc(env(safe-area-inset-top)+3.5rem)] scroll-mb-4 flex-col rounded-[14px]"
/** A card's picture is the page's shape (core/motion.ts sets it), its top shown: the page zooms into it exactly. */
const PAGE_SHAPE = { aspectRatio: "var(--tab-aspect, 3 / 5)" }
/** A card's ground and ring: its own layer, behind its face and picture (faded in as the page zooms into it). */
function Ground({ className }: { className?: string }) {
  return <span aria-hidden className={cn("absolute inset-0 -z-10 rounded-[14px] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--card))] transition-[box-shadow] duration-150", className)} />
}

/** Where the finger took the card it's moving (kept from its press): the card's size and the finger's place on it. */
let grab: { id: string; dx: number; dy: number; w: number; h: number } | null = null
/** The card just let go: where its picture was, so it glides from there into its place (useFlip). */
let landing: { id: string; x: number; y: number } | null = null

/** The tabs as they'd be with `id` moved where `at` says (the list as shown while a card is lifted). */
function arranged(tabs: Tab[], id: string | undefined, at: Placed | null): Tab[] {
  const me = tabs.find((t) => t.id === id)
  if (!me || !at) return tabs
  const rest = tabs.filter((t) => t !== me), k = rest.findIndex((t) => t.id === at.tab)
  if (k < 0) return tabs
  rest.splice(at.kind === "before" ? k : k + 1, 0, me)
  return rest
}

/** A card's face: the tab's icon and name over its picture. */
function CardFace({ store, tab, info, current }: { store: Store; tab: Tab; info: TabInfo; current: boolean }) {
  const Icon = info.icon
  const { fileIcons } = usePrefs()
  return (
    <>
      <span aria-hidden className="flex h-11 w-full shrink-0 items-center gap-2 pr-10 pl-3">
        {fileIcons && <Badged on={info.badge}><Icon className={cn("size-4 shrink-0", !info.tint && "text-muted-foreground", info.iconClassName)} strokeWidth={2} style={info.tint ? { color: info.tint } : undefined} /></Badged>}
        <span className={cn("min-w-0 flex-1 truncate text-[15px] leading-[20px]", current && "font-semibold")}>{info.label}</span>
      </span>
      <span data-tab-shot className="relative mx-1.5 mb-1.5 block min-h-0 flex-1 overflow-hidden rounded-[10px] bg-background">
        <span data-tab-pic style={PAGE_SHAPE} className="absolute inset-x-0 top-0 rounded-[10px] bg-background"><TabPreview store={store} tab={tab} info={info} /></span>
      </span>
    </>
  )
}

/** The card being moved, whole, under the finger where it took it: raised a little, over the sheet. Its place in the grid
 *  stays empty meanwhile. Under it, what a drop does when it isn't a move (Group, Remove from group, a workspace). */
function Lifted({ store, info, current }: { store: Store; info: (t: Tab) => TabInfo; current: string }) {
  const d = useDrag()
  const g = grab
  if (!d?.item.drawn || !d.item.tab || g?.id !== d.item.tab) return null
  const tab: Tab = { id: d.item.tab, to: d.item.to ?? "new" }
  const sheet = [...document.querySelectorAll<HTMLElement>("dialog[open]")].pop()
  const o = sheet?.getBoundingClientRect() ?? { left: 0, top: 0 }
  const hint = d.hit?.hint
  return createPortal(
    <div aria-hidden data-drag-ghost className="pointer-events-none fixed z-[70]"
      style={{ left: d.x - g.dx - o.left, top: d.y - g.dy - o.top, width: g.w, height: g.h }}>
      <div className={cn(CARD, "size-full animate-[tab-lift_180ms_cubic-bezier(.2,.8,.2,1)_forwards] shadow-2xl")}>
        <Ground className="ring-2 ring-[var(--primary)]" />
        <CardFace store={store} tab={tab} info={info(tab)} current={tab.id === current} />
        {hint && <span className="absolute inset-x-0 -bottom-10 mx-auto w-max rounded-full bg-card px-3 py-1.5 text-[15px] font-medium shadow-lg ring-[0.5px] ring-border">{hint}</span>}
      </div>
    </div>,
    sheet ?? document.body,
  )
}

/** A tab's card: its icon, name and X over a preview. Tap to show it. Swipe it sideways and it follows the finger,
 *  fading; let go past a third of its width (or flick) and it flies off and the tab closes, else it springs back. */
function TabCard({ store, tab, info, current, into, lifted, onPick, menu }: { store: Store; tab: Tab; info: TabInfo; current: boolean; into: boolean; lifted: boolean; onPick: () => void; menu: () => MenuItem[] }) {
  const card = useRef<HTMLDivElement>(null)
  const picked = useSelected(TABS, tab.id)
  const drag = useRef<{ x: number; y: number; axis: "x" | "y" | null; dx: number; t: number; quit?: () => void } | null>(null)
  const swiped = useRef(false)
  const gone = useRef(false)
  /** Put the card `dx` px from its place (animated over `ms`), fading as it goes. */
  const slide = (dx: number, ms = 0) => {
    const c = card.current
    if (!c) return
    c.style.transition = ms ? `transform ${ms}ms ${EASE}, opacity ${ms}ms ${EASE}` : "none"
    c.style.transform = dx ? `translateX(${dx}px)` : ""
    c.style.opacity = dx ? String(Math.max(0.2, 1 - Math.abs(dx) / c.offsetWidth)) : ""
  }
  /** Close it: swiped (`dir`), it flies on that way; its X, it shrinks away where it is. */
  const close = (dir?: 1 | -1) => {
    if (gone.current) return
    gone.current = true
    const c = card.current, w = c?.offsetWidth ?? 200
    if (dir) slide(dir * w * 1.4, 200)
    else if (c) {
      c.style.transition = "transform 180ms cubic-bezier(.4, 0, 1, 1), opacity 180ms linear"
      c.style.transform = "scale(0.8)"
      c.style.opacity = "0"
    }
    setTimeout(() => {
      closeTab(tab.id)
      // Still open: its view is asking (or said no). The card comes back; if the tab closes after all, it goes then.
      if (isOpen(tab.id)) { gone.current = false; slide(0, 260) }
    }, 190)
  }
  return (
    <div tabIndex={-1} data-tab-row={tab.id} data-select-key={tab.id} onContextMenu={menuOnCard(rowMenu(TABS, tab.id, menu))}
      onPointerDown={(e) => {
        const r = card.current?.getBoundingClientRect()
        if (r) grab = { id: tab.id, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }
        startDrag(e, { from: "tab", tab: tab.id, to: tab.to, drawn: true }, { touch: true })
      }}
      className={cn("relative outline-none select-none [-webkit-touch-callout:none]", lifted && "rounded-[14px] bg-foreground/[0.04]")}>
      <div ref={card} data-tab-card style={{ touchAction: "pan-y" }}
        className={cn(CARD, "transition-[scale,opacity] duration-150", into && "scale-[0.94]", lifted && "opacity-0")}
        onPointerDown={(e) => {
          // (Selecting, a tap picks it: it doesn't swipe away.)
          if (gone.current || e.button || e.pointerType === "mouse" || selecting()) return
          drag.current?.quit?.()
          drag.current = { x: e.clientX, y: e.clientY, axis: null, dx: 0, t: e.timeStamp }
          swiped.current = false
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          // Held: picked up to be moved (core/drag.ts), not swiped.
          if (fingerHolding()) { drag.current = null; return }
          const mx = e.clientX - d.x, my = e.clientY - d.y
          if (!d.axis) {
            if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
              d.axis = "x"
              d.t = e.timeStamp
              try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not a live pointer */ }
              // The app sent away mid-swipe (core/away.ts): it springs back.
              d.quit = onAway(() => { if (drag.current === d) { drag.current = null; d.quit?.(); slide(0, 260) } })
            }
            else if (Math.abs(my) > 8) d.axis = "y"
          }
          if (d.axis !== "x") return
          swiped.current = true
          // When it last turned back: a flick is measured from there.
          if (Math.abs(mx) < Math.abs(d.dx) || Math.sign(mx) !== Math.sign(d.dx)) d.t = e.timeStamp
          const w = card.current?.offsetWidth ?? 200
          if ((Math.abs(mx) > w * 0.35) !== (Math.abs(d.dx) > w * 0.35)) haptic()
          d.dx = mx
          slide(mx)
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          d?.quit?.()
          if (!d || d.axis !== "x") return
          const w = card.current?.offsetWidth ?? 200
          const flick = Math.abs(d.dx) > 30 && Math.abs(d.dx) / Math.max(16, e.timeStamp - d.t) > 0.6
          if (Math.abs(d.dx) > w * 0.35 || flick) close(d.dx < 0 ? -1 : 1); else slide(0, 260)
        }}
        onPointerCancel={() => { const d = drag.current; drag.current = null; d?.quit?.(); if (d?.axis === "x") slide(0, 260) }}>
        <Ground className={picked || into ? "ring-[3px] ring-[var(--primary)]" : current ? "ring-2 ring-[var(--primary)]" : "ring-[0.5px] ring-border"} />
        <CardFace store={store} tab={tab} info={info} current={current} />
        {/* The whole card is the tap target, laid over it (the preview holds links and blocks that mustn't be). */}
        <CardButtons label={info.label} current={current} tap={{ "aria-pressed": picked || undefined, ...selectedAttr(picked) }}
          onOpen={(e) => { if (!swiped.current && !selectClick(e, TABS, tab.id)) onPick() }} onClose={() => close()} />
      </div>
    </div>
  )
}

/** A card's tap target, laid over all of it, and its X. */
function CardButtons({ label, closeLabel = label, current, tap, onOpen, onClose }: {
  label: string; closeLabel?: string; current?: boolean; tap?: Record<string, unknown>; onOpen: (e: MouseEvent) => void; onClose: () => void }) {
  return <>
    <button type="button" aria-current={current || undefined} aria-label={label} {...tap} onClick={onOpen}
      className="absolute inset-0 cursor-pointer rounded-[14px] active:bg-foreground/[0.06]" />
    <button type="button" onClick={onClose} onPointerDown={(e) => e.stopPropagation()} data-no-drag aria-label={`Close ${closeLabel}`}
      className="absolute top-0 right-0 grid size-11 cursor-pointer place-items-center text-muted-foreground active:opacity-50">
      <X className="size-[17px]" strokeWidth={2.25} />
    </button>
  </>
}

/** A group (a pane of several tabs): its name and count over its first tabs' pictures. Tap it for its tabs. */
function GroupCard({ store, group, name, info, current, lit, onOpen }: { store: Store; group: Group; name: string; info: (t: Tab) => TabInfo; current: boolean; lit: boolean; onOpen: () => void }) {
  const n = group.tabs.length
  const shown = n > 4 ? group.tabs.slice(0, 3) : group.tabs
  const menu = (): MenuItem[] => [
    { label: "Ungroup", icon: Ungroup, run: () => ungroup(group.id) },
    { label: "Close group", icon: X, danger: true, sep: true, run: () => closeTabs("all", group.tabs[0].id) },
  ]
  return (
    <div data-group-card={group.id} onContextMenu={menuOnCard(menu)} className="relative select-none [-webkit-touch-callout:none]">
      <div className={cn(CARD, "transition-[scale] duration-150", lit && "scale-[0.94]")}>
        <Ground className={lit ? "ring-[3px] ring-[var(--primary)]" : current ? "ring-2 ring-[var(--primary)]" : "ring-[0.5px] ring-border"} />
        <span aria-hidden className="flex h-11 w-full shrink-0 items-center gap-2 pr-10 pl-3">
          <GroupIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="min-w-0 truncate text-[15px] leading-[20px] font-semibold">{name}</span>
          <span className="shrink-0 text-[15px] text-muted-foreground tabular-nums">{n}</span>
        </span>
        <span className="mx-1.5 mb-1.5 grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5">
          {shown.map((t) => (
            <span key={t.id} data-tab-mini={t.id} className="relative overflow-hidden rounded-[8px] bg-background">
              {/* Drawn at twice the size and halved, so it reads as a small page. */}
              <span data-tab-pic style={PAGE_SHAPE} className="absolute top-0 left-0 w-[200%] origin-top-left scale-50 rounded-[16px] bg-background"><TabPreview store={store} tab={t} info={info(t)} /></span>
            </span>
          ))}
          {n > 4 && <span className="grid place-items-center rounded-[8px] bg-background text-[15px] font-semibold text-muted-foreground">+{n - 3}</span>}
        </span>
        <CardButtons label={`${name}, ${n} tabs`} closeLabel={name} onOpen={onOpen} onClose={() => closeTabs("all", group.tabs[0].id)} />
      </div>
    </div>
  )
}

/** Cards slide into their new places (FLIP) when one goes or the others make room for a lifted one, starting from where
 *  they show (mid-glide too); the card let go glides from its picture. When one goes, the list keeps its height, or the
 *  scroller at its end would jump up with all of it; given back as it's scrolled up. */
function useFlip(box: RefObject<HTMLDivElement | null>, live: boolean) {
  const last = useRef(new Map<string, { x: number; y: number }>())
  const height = useRef(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    // (before anything is measured: measuring lays it out, which is when the scroller would jump)
    const ids = new Set([...el.querySelectorAll<HTMLElement>("[data-tab-row]")].map((c) => c.dataset.tabRow!))
    const lost = [...last.current.keys()].some((id) => !ids.has(id))
    if (lost && height.current) el.style.minHeight = `${Math.max(height.current, parseFloat(el.style.minHeight) || 0)}px`
    const o = el.getBoundingClientRect()
    const now = new Map<string, { x: number; y: number; card: HTMLElement | null }>()
    for (const cell of el.querySelectorAll<HTMLElement>("[data-tab-row]")) {
      const r = cell.getBoundingClientRect()
      now.set(cell.dataset.tabRow!, { x: r.left - o.left, y: r.top - o.top, card: cell.querySelector<HTMLElement>("[data-tab-card]") })
    }
    const land = landing
    landing = null
    const glide = (c: HTMLElement, from: string, how = `300ms ${SPRING}`) => {
      c.style.transition = "none"
      c.style.transform = from
      void c.offsetWidth
      c.style.transition = `transform ${how}`
      c.style.transform = ""
    }
    for (const [id, p] of now) {
      const c = p.card
      if (!c) continue
      if (land?.id === id) { glide(c, `translate(${land.x - o.left - p.x}px, ${land.y - o.top - p.y}px) scale(1.06)`, `320ms ${SPRING}`); continue }
      const was = last.current.get(id)
      if (!(lost || live) || !was || (was.x === p.x && was.y === p.y)) continue
      // Where it shows now, on its way from an earlier move: the glide's offset still on it.
      const cell = c.parentElement!.getBoundingClientRect(), shown = c.getBoundingClientRect()
      glide(c, `translate(${was.x - p.x + shown.left - cell.left}px, ${was.y - p.y + shown.top - cell.top}px)`, lost && !live ? CLOSE_UP : undefined)
    }
    last.current = new Map([...now].map(([id, p]) => [id, { x: p.x, y: p.y }]))
    height.current = el.offsetHeight
  })
  useEffect(() => {
    const sc = box.current?.closest<HTMLElement>(".overflow-y-auto")
    if (!sc) return
    let top = sc.scrollTop
    const scrolled = () => {
      const el = box.current, up = top - sc.scrollTop
      top = sc.scrollTop
      if (!el?.style.minHeight || up <= 0) return
      const h = parseFloat(el.style.minHeight) - up
      el.style.minHeight = h > 0 ? `${h}px` : ""
    }
    sc.addEventListener("scroll", scrolled, { passive: true })
    return () => sc.removeEventListener("scroll", scrolled)
  }, [box])
}

/** The workspaces as pages, side by side: dragged sideways anywhere but on a card (which swipes away itself), the
 *  next one's cards come in after the finger; let go past a quarter of the way (or flicked) and it's the current one. */
function Pager({ pages, at, go, peek, children, head }: {
  pages: WorkspaceInfo[]; at: number; go: (n: number) => void; peek: (w: WorkspaceInfo) => ReactNode; children: ReactNode; head: ReactNode
}) {
  const track = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState(false)
  const g = useRef<{ id: number; x: number; y: number; axis: "x" | "y" | null; dx: number; t: number; v: number; quit?: () => void } | null>(null)
  const last = pages.length - 1
  // How far one page is from the next: its width and the sheet's padding between them.
  const step = () => (track.current?.offsetWidth ?? innerWidth) + 20
  const set = (dx: number, ms = 0) => {
    const t = track.current
    if (!t) return
    t.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, 0, 0, 1)` : "none"
    t.style.transform = dx ? `translateX(${dx}px)` : ""
  }
  const on = pages.length > 1 && at >= 0
  /** A drag whose end never came (the app went away mid-drag, core/away.ts): back to the current page. */
  const drop = () => {
    const d = g.current
    if (!d) return
    g.current = null
    d.quit?.()
    if (d.axis !== "x") return
    set(0, 240)
    setTimeout(() => setSide(false), 250)
  }
  const down = (e: PointerEvent) => {
    if (g.current && e.pointerId !== g.current.id) drop()
    if (!on || e.button || g.current || (e.target as Element).closest("[data-tab-row], [data-group-card], input")) return
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, dx: 0, t: e.timeStamp, v: 0 }
  }
  const move = (e: PointerEvent) => {
    const d = g.current
    if (!d || e.pointerId !== d.id) return
    const mx = e.clientX - d.x, my = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        d.axis = "x"
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not a live pointer */ }
        d.quit = onAway(drop)
        setSide(true)
      } else if (Math.abs(my) > 8) d.axis = "y"
      return
    }
    if (d.axis !== "x") return
    // Past the first or last, it gives a little, like a scroller's end.
    const dx = (at === 0 && mx > 0) || (at === last && mx < 0) ? mx / 3 : mx
    d.v = (dx - d.dx) / Math.max(1, e.timeStamp - d.t)
    d.t = e.timeStamp
    d.dx = dx
    set(dx)
  }
  const up = (e: PointerEvent) => {
    const d = g.current
    if (!d || e.pointerId !== d.id) return
    g.current = null
    d.quit?.()
    if (d.axis !== "x") return
    // A drag isn't a tap on what it began on (the title).
    const eat = (c: Event) => { c.stopPropagation(); c.preventDefault() }
    addEventListener("click", eat, { capture: true, once: true })
    setTimeout(() => removeEventListener("click", eat, { capture: true }), 400)
    const dir = d.dx < 0 ? 1 : -1, to = at + dir, w = step()
    const far = Math.abs(d.dx) > w * 0.25 || (Math.abs(d.v) > 0.5 && Math.sign(d.v) === -dir)
    if (e.type === "pointerup" && far && to >= 0 && to <= last) {
      set(-dir * w, 240)
      haptic("selection")
      setTimeout(() => { flushSync(() => { go(pages[to].n); setSide(false) }); set(0) }, 240)
    } else {
      set(0, 240)
      setTimeout(() => setSide(false), 250)
    }
  }
  return (
    <div data-tabs-pager onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      className="flex min-h-[calc(100dvh-10rem)] flex-col" style={{ touchAction: "pan-y" }}>
      {head}
      <div ref={track} className="relative">
        {side && at > 0 && <div aria-hidden className="pointer-events-none absolute top-0 right-[calc(100%+20px)] w-full">{peek(pages[at - 1])}</div>}
        {children}
        {side && at < last && <div aria-hidden className="pointer-events-none absolute top-0 left-[calc(100%+20px)] w-full">{peek(pages[at + 1])}</div>}
      </div>
    </div>
  )
}

/** The tab list's top line, Chrome's: search the tabs at the left, the workspace (its menu, dots for the others) in the
 *  middle, more at the right; searching, a field across it. */
function TabsHeader({ title, count, pages, at, menu, more, query, setQuery, items }: {
  title: string; count: number; pages: WorkspaceInfo[]; at: number; menu: (() => MenuItem[]) | null; more: () => MenuItem[]
  query: string | null; setQuery: (q: string | null) => void; items: ReactNode
}) {
  const icon = "grid size-11 shrink-0 cursor-pointer place-items-center text-primary active:opacity-50"
  if (query !== null) return (
    <div data-tabs-header className="relative z-20 -mt-2 mb-4 flex min-h-11 items-center gap-2 md:mr-11">
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-foreground/[0.06] px-2.5">
        <Search className="size-[17px] shrink-0 text-muted-foreground" strokeWidth={2} />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tabs" aria-label="Search tabs" data-tabs-query
          enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setQuery(null) } }}
          className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-tertiary" />
      </label>
      <button type="button" onClick={() => setQuery(null)} className="h-11 shrink-0 cursor-pointer text-[17px] text-primary active:opacity-50">Cancel</button>
    </div>
  )
  return (
    <div data-tabs-header className="relative z-20 -mx-3 -mt-2 mb-4 grid min-h-11 grid-cols-[1fr_minmax(0,auto)_1fr] items-center md:mr-8">
      <div className="flex items-center">
        <button type="button" aria-label="Search tabs" data-tabs-search onClick={() => setQuery("")} className={icon}>
          <Search className="size-[21px]" strokeWidth={2} />
        </button>
      </div>
      <button type="button" data-tabs-workspace disabled={!menu} aria-haspopup={menu ? "menu" : undefined} onClick={(e) => menu && menuBelow(e, menu())}
        className="flex min-h-11 min-w-0 cursor-pointer flex-col items-center justify-center px-1 disabled:cursor-default">
        <span className="flex max-w-full min-w-0 items-center gap-1.5">
          <h2 data-tabs-title className="min-w-0 truncate text-[17px] leading-[22px] font-semibold">{title}</h2>
          <span data-tabs-count className="shrink-0 text-[17px] leading-[22px] text-muted-foreground tabular-nums" aria-label={count === 1 ? "1 tab" : `${count} tabs`}>{count}</span>
          {menu && <ChevronDown className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />}
        </span>
        {pages.length > 1 && (
          <span aria-hidden className="mt-1 flex gap-1.5">
            {pages.map((p, i) => <span key={p.n} className={cn("size-1.5 rounded-full transition-colors", i === at ? "bg-foreground/70" : "bg-foreground/20")} />)}
          </span>
        )}
      </button>
      <div className="flex items-center justify-end">
        {items}
        <button type="button" aria-label="More" aria-haspopup="menu" data-tabs-more onClick={(e) => menuBelow(e, more())} className={icon}>
          <Ellipsis className="size-[22px]" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

/** The panes' names in the list: Left and Right (Top and Bottom) for one split in two, else Pane 1, 2... */
function paneNames(ws: Workspace): string[] {
  const { panes } = layout(ws.root)
  if (panes.length === 2 && isSplit(ws.root)) return ws.root.dir === "row" ? ["Left", "Right"] : ["Top", "Bottom"]
  return panes.map((_, i) => `Pane ${i + 1}`)
}

/** The tab list (the sheet's "tabs" detail): its top line, then the cards: one pane's tabs, or with several panes a card
 *  per pane (a group when it has several tabs), the tabs of the group opened, or those a search finds. */
export function TabSwitcher({ store, info }: { store: Store; info: (t: Tab) => TabInfo }) {
  // Left (the page growing out of it), it stays as it was: nothing moves in it as it fades.
  const left = useLingeringSheet() !== null
  const live = useWorkspace(), liveCur = activeTab()
  const [kept, keep] = useState({ ws: live, cur: liveCur })
  if (!left && kept.ws !== live) keep({ ws: live, cur: liveCur })
  const { ws, cur } = left ? kept : { ws: live, cur: liveCur }
  const { disabled, order } = usePrefs()
  const panes = leaves(ws.root)
  const labels = paneNames(ws)
  const header = headerItems(disabled, order)
  const box = useRef<HTMLDivElement>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const multi = panes.length > 1
  const open = multi ? panes.find((g) => g.id === opened && g.tabs.length > 1) ?? null : null
  const top = multi && !open
  useWorkspaceVersion()
  const lifted = useDrag()?.item
  const liftedId = lifted?.drawn && lifted.from === "tab" ? lifted.tab : undefined
  useFlip(box, !!liftedId)

  const scroller = useRef(edgeScroller())
  /** Where the lifted card would go (the list is shown so), and where the finger last was (where its picture is). */
  const placed = useRef<Placed | null>(null)
  const lastAt = useRef<{ x: number; y: number } | null>(null)
  /** The card (and its part: "mid" or "edge") the lifted one is over, and since when. */
  const resting = useRef<{ key: string; since: number; timer: number } | null>(null)
  /** Whether the finger has been over `key` for `ms` (asked again then, if it stays still). */
  const stayed = (key: string, ms: number) => {
    const r = resting.current
    if (r?.key === key) return performance.now() - r.since >= ms
    if (r) clearTimeout(r.timer)
    resting.current = { key, since: performance.now(), timer: window.setTimeout(rehit, ms + 10) }
    return false
  }
  const unrest = () => { if (resting.current) { clearTimeout(resting.current.timer); resting.current = null } }
  useDropTarget<ListHit>("tab-list", (item: DragItem, x, y, el) => {
    if (item.from !== "tab" || !item.tab || !el || !box.current) return null
    // Which way the finger is going (since the last move): towards a card's middle, it may mean to group with it.
    const prev = lastAt.current, vx = prev ? x - prev.x : 0, vy = prev ? y - prev.y : 0
    if (item.drawn) lastAt.current = { x, y }
    const keep = (h: ListHit | null) => { placed.current = h && (h.kind === "before" || h.kind === "after") ? { kind: h.kind, tab: h.tab } : null; return h }
    const sheet = box.current.closest("dialog")
    if (!sheet?.contains(el)) return keep(null)
    const sc = box.current.closest<HTMLElement>(".overflow-y-auto")
    if (sc) scroller.current.near(sc, y)
    const own = groupOfTab(item.tab)
    if (el.closest("[data-tabs-new]")) return keep(multi && own && own.tabs.length > 1 ? { kind: "out" } : null)
    const gc = el.closest<HTMLElement>("[data-group-card]")
    if (gc) return keep(own?.id !== gc.dataset.groupCard ? { kind: "join", group: gc.dataset.groupCard! } : null)
    // The card whose place in the grid is under the finger, not the one drawn there: a card gliding out of the lifted
    // one's way is still under the finger for a moment, and taking it would move the lifted card back (and so on).
    const inside = (c: HTMLElement) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom }
    const row = [...box.current.querySelectorAll<HTMLElement>("[data-tab-row]")].find(inside) ?? null
    const id = row?.dataset.tabRow
    if (top) return keep(row && id && id !== item.tab && canGroup(item.tab, id) ? { kind: "into", tab: id } : null)
    const tabs = own?.tabs ?? []
    // The empty space after the last card (beside it, or below the grid): the end of the list.
    const end = [...box.current.querySelectorAll<HTMLElement>("[data-tab-row]")].at(-1)?.getBoundingClientRect()
    if (!row && end && !el.closest("[data-sheet-bar], [data-tabs-header], [data-group-head]") && y >= end.top && (x >= end.right || y >= end.bottom)) {
      const last = tabs.filter((t) => t.id !== item.tab).at(-1)
      if (!last) return keep(null)
      const h: Placed = { kind: "after", tab: last.id }
      return keep(arranged(tabs, item.tab, h).every((t, k) => t === tabs[k]) ? null : h)
    }
    // Over its own (empty) place or between cards: where it was going still holds.
    if (!row || !id || id === item.tab) { unrest(); return box.current.contains(el) ? placed.current : keep(null) }
    const r = row.getBoundingClientRect(), fx = (x - r.left) / r.width, fy = (y - r.top) / r.height
    // The lifted card takes that card's place, which moves over to make room (towards where it came from).
    const shown = arranged(tabs, item.tab, placed.current)
    const j = shown.findIndex((t) => t.id === id), p = shown.findIndex((t) => t.id === item.tab)
    if (j < 0 || p < 0) return keep(null)
    const h: Placed = { kind: j < p ? "before" : "after", tab: id }
    const same = arranged(tabs, item.tab, h).every((t, k) => t === tabs[k])
    // Let go before the cards have moved, it still takes that card's place.
    const soft = same ? placed.current : h
    const groups = !multi && canGroup(item.tab, id)
    // Moving away from a card's centre takes its place at once; heading for it may
    // mean to group, so wait. Resting over its middle groups the two; on an edge, takes its place after a frame or two.
    const moving = Math.hypot(vx, vy) > 1.5
    const toward = vx * (r.left + r.width / 2 - x) + vy * (r.top + r.height / 2 - y) > 0
    const middle = groups && fx > 0.22 && fx < 0.78 && fy > 0.18 && fy < 0.82
    // (Near the centre itself, a finger coming to rest there: not moving away.)
    const off = Math.max(Math.abs(fx - 0.5), Math.abs(fy - 0.5)) > 0.12
    if (middle && !(moving && !toward && off)) return stayed(`${id}:mid`, GROUP_MS) ? { kind: "into", tab: id } : soft
    if (groups && moving && toward) { unrest(); return soft }
    if (!moving && !stayed(`${id}:edge`, MOVE_MS)) return soft
    unrest()
    // Where it is already: no drop.
    return keep(same ? null : h)
  }, (item, h) => {
    const id = item.tab!
    if (h.kind === "into") groupTabs(id, h.tab)
    else if (h.kind === "join") joinGroup(id, h.group)
    else if (h.kind === "out") leaveGroup(id)
    else {
      const rest = (groupOfTab(id)?.tabs ?? []).filter((t) => t.id !== id), k = rest.findIndex((t) => t.id === h.tab)
      placeTab(id, h.kind === "before" ? h.tab : rest[k + 1]?.id ?? null)
    }
  }, {
    hint: (h) => (h.kind === "into" ? "Group" : h.kind === "join" ? "Add to group" : h.kind === "out" ? "Remove from group" : undefined),
    end: () => {
      scroller.current.stop()
      const at = lastAt.current, g = grab
      if (at && g) landing = { id: g.id, x: at.x - g.dx, y: at.y - g.dy }
      lastAt.current = null
      placed.current = null
      unrest()
    },
  })
  const hit = useDropHit<ListHit>("tab-list")
  const hitKey = !hit ? "" : hit.kind === "join" ? `join:${hit.group}` : hit.kind === "out" ? "out" : `${hit.kind}:${hit.tab}`
  // A tick each time the cards make room somewhere else, or what a drop would do turns into something other than a move
  // (Group, onto a group, onto +): not for a card's middle passed over.
  const shownPlace = placed.current ? `${placed.current.kind}:${placed.current.tab}` : ""
  const tickKey = !hit ? "" : hit.kind === "before" || hit.kind === "after" ? shownPlace : hitKey
  useEffect(() => { if (tickKey) haptic("selection") }, [tickKey])

  /** A pane's name in menus: its name, or a lone tab's label. */
  const nameOf = (g: Group, i: number) => (g.tabs.length > 1 ? labels[i] : info(g.tabs[0]).label)
  const menuOf = (t: Tab) => () => {
    const own = groupOfTab(t.id)
    const extra: MenuItem[] = []
    if (multi) {
      const others = panes.map((g, i) => ({ g, i })).filter(({ g }) => g.id !== own?.id)
      extra.push({ label: "Add to group", icon: GroupIcon, sep: true, run: () => {}, items: others.map(({ g, i }) => ({ label: nameOf(g, i), run: () => joinGroup(t.id, g.id) })) })
      if (own && own.tabs.length > 1) extra.push({ label: "Remove from group", icon: Ungroup, run: () => leaveGroup(t.id) })
    }
    return tabCardMenu(t, own?.tabs.length ?? 1, extra)
  }
  const card = (t: Tab) => (
    <TabCard key={t.id} store={store} tab={t} info={info(t)} current={t.id === cur.id} into={hit?.kind === "into" && hit.tab === t.id}
      lifted={t.id === liftedId} onPick={() => pickTab(t.id)} menu={menuOf(t)} />
  )
  const grid = "grid grid-cols-2 gap-3 @min-[520px]:grid-cols-3"
  useSelectable(TABS, { menu: (ids) => tabsMenu(ids, true), noun: ["tab", "tabs"] })
  const openIndex = open ? panes.indexOf(open) : -1
  // While a card is lifted, its pane's tabs are shown as they'd be with it where it would go.
  const inOrder = (tabs: Tab[]) => (liftedId && tabs.some((t) => t.id === liftedId) ? arranged(tabs, liftedId, placed.current) : tabs)
  const ctx = { store, open: true, phone: true, file: tabPath(cur.to) ?? "", tab: cur.to }
  const draw = (items: typeof header) => items.map(({ key, item }) => (
    <div key={key} data-header-item={key} className="flex min-w-0 items-center"><Guard what="This item"><Drawn draw={() => item.render(ctx)} /></Guard></div>
  ))
  const count = open ? open.tabs.length : tabCount(ws)
  const host = workspaces()
  const pages = host?.list() ?? []
  const at = host ? pages.findIndex((w) => w.n === host.current()) : -1
  const q = query?.trim().toLowerCase() ?? ""
  const all = panes.flatMap((g) => g.tabs)
  const found = q ? all.filter((t) => `${info(t).label}\n${t.to}`.toLowerCase().includes(q)) : null
  const more = (): MenuItem[] => [
    { label: "Select tabs", icon: CheckSquare, run: () => startSelecting(TABS) },
    { label: "Close other tabs", icon: X, sep: true, disabled: all.length < 2, run: () => closeTabIds(all.filter((t) => t.id !== cur.id).map((t) => t.id)) },
    { label: all.length === 1 ? "Close tab" : `Close all ${all.length} tabs`, danger: true, run: () => closeTabIds(all.map((t) => t.id)) },
  ]
  // Another workspace's tabs, as they'd show (pictures of what they open, no live cards), while the finger brings it in.
  const peek = (w: WorkspaceInfo) => (
    <div className={grid}>
      {w.places.map((to, i) => {
        const t: Tab = { id: `peek-${w.n}-${i}`, to }
        return <div key={t.id} className={CARD}><Ground className="ring-[0.5px] ring-border" /><CardFace store={store} tab={t} info={info(t)} current={false} /></div>
      })}
    </div>
  )
  return (
    <>
      <Pager pages={pages} at={open || found ? -1 : at} go={(n) => host?.switchTo(n)} peek={peek}
        head={<>
          <TabsHeader title={host ? pages[at]?.label ?? "Workspace" : "Tabs"} count={found ? found.length : count} pages={pages} at={at}
            menu={host ? host.menu : null} more={more} query={query} setQuery={setQuery} items={draw(header.filter((h) => !h.item.phoneBar))} />
          {open && !found && (
            <div data-group-head className="mb-3 flex items-center">
              <button type="button" onClick={() => setOpened(null)}
                className="-ml-2 flex h-11 cursor-pointer items-center pr-2 text-[17px] text-primary active:opacity-50">
                <ChevronLeft className="size-[24px]" strokeWidth={2} />All tabs
              </button>
              <span className="ml-auto truncate text-[15px] font-semibold text-muted-foreground">{labels[openIndex]}</span>
            </div>
          )}
        </>}>
        <div ref={box} className="@container">
          <div className={grid} data-select-list={TABS}>
            {found ? found.map(card)
              : open ? inOrder(open.tabs).map(card)
              : !multi ? inOrder(panes[0].tabs).map(card)
              : panes.map((g, i) => (g.tabs.length === 1 ? card(g.tabs[0])
                : <GroupCard key={g.id} store={store} group={g} name={labels[i]} info={info} current={g.tabs.some((t) => t.id === cur.id)}
                    lit={hit?.kind === "join" && hit.group === g.id} onOpen={() => setOpened(g.id)} />))}
          </div>
          {found && !found.length && <p className="py-10 text-center text-[17px] text-muted-foreground">No tabs match</p>}
        </div>
      </Pager>
      <SheetBar left={draw(header.filter((h) => h.item.phoneBar))} group={open?.id} lit={hit?.kind === "out"} />
      <Lifted store={store} info={info} current={cur.id} />
    </>
  )
}

/** The sheet's bottom bar (#sheet-bar, DetailSheet's), left of its Done: the plugins' bar items (the Inbox) at the
 *  left, a new tab in the middle (like Chrome's). */
function SheetBar({ left, group, lit }: { left: ReactNode; group?: string; lit: boolean }) {
  const host = usePortalHost("sheet-bar")
  if (!host) return null
  return createPortal(
    <>
      {left}
      <button type="button" aria-label="New tab" data-tabs-new onClick={(e) => newPhoneTab(e.currentTarget, group)}
        className={cn("absolute left-1/2 grid h-11 w-14 -translate-x-1/2 cursor-pointer place-items-center rounded-[12px] text-primary active:bg-foreground/[0.06]", lit && "bg-primary/15 ring-2 ring-[var(--primary)]")}>
        <Plus className="size-[25px]" strokeWidth={2.25} />
      </button>
    </>,
    host,
  )
}

/** A phone tab that isn't a file or a page: an empty one (what to open), or a plugin's view (a terminal). */
export function PhoneTab({ store, to }: { store: Store; to: string }) {
  const { disabled } = usePrefs()
  // A blank tab: the desktop's (components/Tabs.tsx), phone-sized.
  if (to === "new") return <NewTab store={store} phone />
  const view = viewFor(to, disabled)
  const tab = activeTab()
  const title = view ? view.def.title(view.arg) : to.slice(5)
  let body: ReactNode
  if (!view) body = <p className="text-[15px] text-muted-foreground">No plugin draws this tab.</p>
  else if (!view.on) body = <p className="text-[15px] text-muted-foreground">{names([view.plugin.id])} is off. Turn it on in Plugins to open this tab.</p>
  else {
    const name = to.slice(5).split("/")[0]
    const drawn = view.def.render({ store, arg: view.arg, focused: true, close: () => closeTab(tab.id, true), setArg: (arg) => replaceTabTarget(tab.id, `view:${name}${arg ? `/${arg}` : ""}`) })
    // A view that fills its pane (a terminal) gets the screen between the header and the tab bar, with no title of its
    // own: the header above names it already.
    if (view.def.full) return <div className="phone-fill relative -mx-4 min-h-[240px] overflow-hidden">{drawn}</div>
    body = drawn
  }
  return (
    <>
      <PageHeader title={title} />
      {body}
    </>
  )
}
