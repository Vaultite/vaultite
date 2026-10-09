// The desktop sidebar's panels, drawn from plugins' `sidebar` definitions (Search, Files and Pinned are plugins too, so
// turning them off empties it). The components here are exported to plugins.
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { EyeOff, Layers, PanelBottom, PanelBottomClose, PanelLeft, PanelRight, Search, SquareArrowOutUpRight } from "lucide-react"
import type { SidebarCtx, SidebarPanel } from "@/core/define"
import { edgeScroller, getDrag, startDrag, useDrag, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
import { openView } from "@/core/files"
import { closeTab, isDesktop } from "@/core/workspace"
import { dockAtEnd, dockPanel, drawerPanels, hidePanel, panelOfView, panelsIn, setPanelDocked, setPanelHeight, sideOf, sidebarPanels, sidebars, togglePanelCollapsed, useSidebars, type PanelOf, type Side } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { firstKeys, keyCaps, runCommandById, useCommandKeys } from "@/core/commands"
import { holdFocus } from "@/core/focus"
import { coarse } from "@/core/haptics"
import { checklist, menuFor, type CheckItem, type MenuItem } from "@/components/ContextMenu"
import { FileTree } from "@/components/FileTree"
import { Drawn, Guard } from "@/components/Guard"
import { Badged } from "@/components/kit"
import { cn, space } from "@/lib/utils"
import { Resizer } from "@/components/Resizer"
import { usePanelLayout } from "@/components/panelLayout"

import { PanelFold, SidebarHeading } from "@/components/SidebarHeading"
import { SwipeRow, type SwipeAction } from "@/components/SwipeRow"
export { PanelFold, SidebarHeading }

const PANELS = "panels"
/** Where a dragged panel would land in a sidebar (core/sidebars.ts Place): before panel `before` (null: the end); `y`:
 *  the line, in the panels' box. */
type PanelDrop = { before: string | null; y: number }
/** Which sidebar this is drawn in: the rail's tooltips and flyouts open away from its edge. */
const SidebarSide = createContext<Side>("left")

/** The panel a drag carries: a panel's heading, or a pane's view tab that is a panel (Files, Terminals, Search: dragged
 *  back into a sidebar). */
const draggedPanel = (item: DragItem) => (item.from === "panel" ? item.panel ?? null : item.from === "tab" ? panelOfView(item.to) : null)
/** After a drop in a sidebar: a pane's tab brought back closes (the panel is in the sidebar now: moved, not copied). */
const dropped = (item: DragItem) => { if (item.from === "tab" && item.tab) closeTab(item.tab) }
/** What a drop in sidebar `side` says, over the target: a pane's tab brought back, a panel from the other sidebar. */
const intoHint = (side: Side) => {
  const item = getDrag()?.item
  if (!item) return undefined
  if (item.from === "tab") return `To the ${side} sidebar`
  return sideOf(item.panel ?? "") !== side ? `To the ${side} sidebar` : undefined
}

/** A sidebar's stack of panels. Each scrolls in its own box like VS Code's (dividers move room between them), or with
 *  `sidebarScroll` the sidebar is one scroller; headings stick, drag to reorder, click to fold. Phones use a drawer. */
export function SidebarPanels({ head, side = "left", ...ctx }: SidebarCtx & { head?: React.ReactNode
  /** The left sidebar or the right one: each draws its own panels, and takes panels dropped on it. */
  side?: Side }) {
  const { disabled, order, sidebarScroll, panelDividers } = usePrefs()
  const setup = useSidebars()
  const panels = (ctx.phone ? drawerPanels : panelsIn)(side, setup, disabled, order)
  // Each panel scrolls in its own box, under a divider that sets its height, or the sidebar scrolls them all as one
  // (appearance.json `sidebarScroll`: Settings > Appearance). Phones' drawers scroll as one: a finger has no divider to drag.
  const own = sidebarScroll !== "sidebar" && !ctx.phone
  const box = useRef<HTMLDivElement>(null)
  const fit = usePanelLayout(box, own && ctx.open, setup, panels)
  const [edge] = useState(edgeScroller)
  const d = useDrag()
  const target = `${PANELS}:${side}`
  const hit = useDropHit<PanelDrop>(target)
  useDropTarget<PanelDrop>(target, (item, x, y) => {
    const key = draggedPanel(item), el = box.current
    if (!key || !el || !ctx.open) return null
    const b = el.getBoundingClientRect()
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) { edge.stop(); return null }
    edge.near(el, y)
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-panel]")]
    if (!rows.length) return { before: null, y: 2 }
    // The gaps: above each panel, and below the last; the nearest one wins.
    const edges = [...rows.map((r) => r.getBoundingClientRect().top), rows[rows.length - 1].getBoundingClientRect().bottom]
    const i = edges.reduce((best, e, j) => (Math.abs(y - e) < Math.abs(y - edges[best]) ? j : best), 0)
    // Its own place (just above or below itself): nothing to do.
    const mine = rows.findIndex((r) => r.dataset.panel === key)
    if (item.from === "panel" && mine >= 0 && (i === mine || i === mine + 1)) return null
    return { before: rows[i]?.dataset.panel ?? null, y: Math.max(1, edges[i] - b.top + el.scrollTop - 1) }
  }, (item, h) => {
    dockPanel(draggedPanel(item)!, { side, before: h.before })
    dropped(item)
  }, { hint: () => intoHint(side), end: edge.stop })

  const [flying, setFlying] = useState<string | null>(null)
  useEffect(() => { if (ctx.open) setFlying(null) }, [ctx.open])

  if (!ctx.open) {
    return (
      <SidebarSide.Provider value={side}>
        <div ref={box} data-rail className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-width:none]">
          {head && <div data-rail-section className="flex shrink-0 flex-col">{head}</div>}
          {panels.map(({ key, panel }) => (
            <div key={key} data-panel={key} data-rail-section className="flex shrink-0 flex-col" onContextMenu={menuFor(() => panelMenu(key, side))}>
              {panel.flyout
                ? <RailFlyout panel={panel} ctx={{ ...ctx, panel: key }} open={flying === key} setOpen={(v) => setFlying(v ? key : null)} />
                : <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ ...ctx, panel: key })} /></Guard>}
            </div>
          ))}
        </div>
      </SidebarSide.Provider>
    )
  }

  return (
    // One rhythm for every panel, whatever it draws: 1 unit under each (folded or not) and its heading's 2 above, so 3
    // units between any two panels; and the last one ends 2 units above the vault's bar.
    <SidebarSide.Provider value={side}>
    <div ref={box} data-sidebar-body={side} data-scroll={own ? "panels" : "sidebar"}
      className={cn("relative flex min-h-0 flex-1 flex-col pb-1", own ? "overflow-x-hidden overflow-y-auto [scrollbar-width:thin]" : "overflow-y-auto overscroll-contain [scrollbar-width:thin]")}>
      {panels.length ? panels.map((p, i) => {
        const { key, panel } = p
        const folded = setup.collapsed.includes(key)
        // A divider under it while a panel below it is open (none under the last: nothing to give it room).
        const divider = own && !folded && panels.slice(i + 1).some((q) => !setup.collapsed.includes(q.key))
        return (
          <Fragment key={key}>
          <div data-panel={key} data-collapsed={folded || undefined} onContextMenu={menuFor(() => panelMenu(key, side))}
            onPointerDown={(e) => {
              const t = e.target as HTMLElement
              // With a `view`, dropped on a pane it opens as a tab. A button that is itself the
              // handle (the search field) drags too: a drag starts only once the pointer moves, so a click still works.
              const control = t.closest("button, a, input")
              const handle = t.closest<HTMLElement>("[data-panel-handle]")
              if (handle && (!control || control.hasAttribute("data-panel-handle"))) {
                // A phone's drawer: a finger holds the heading to pick it up (a plain touch scrolls or folds it).
                startDrag(e, { from: "panel", panel: key, label: handle.dataset.heading || panel.heading || panel.title, to: panel.view ? `view:${panel.view}` : undefined }, { touch: true })
              }
            }}
            className={cn("flex shrink-0 flex-col pb-1", d?.item.panel === key && "opacity-50")}>
            {/* Its own box (each panel scrolling in its own: the height usePanelLayout gives it), around what it draws
                (measured: the most it's given). Scrolling as one, both are plain. */}
            <div data-panel-scroll className={cn("flex min-h-0 flex-col", own && !folded && "overflow-y-auto [scrollbar-width:thin]")}>
              <div data-panel-content className="flex shrink-0 flex-col">
                <PanelFold.Provider value={{ collapsed: folded, toggle: () => togglePanelCollapsed(key) }}>
                  {panel.heading !== false && <SidebarHeading title={panel.heading ?? panel.title} open>{panel.actions?.({ ...ctx, panel: key })}</SidebarHeading>}
                  <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ ...ctx, panel: key })} /></Guard>
                </PanelFold.Provider>
              </div>
            </div>
          </div>
          {/* A line between it and the next one (appearance `panelDividers`), where its divider is: it takes no room. */}
          {panelDividers && i < panels.length - 1 && (
            <div aria-hidden data-panel-divider className="relative h-0 shrink-0"><div className="absolute inset-x-1.5 top-0 border-t-[0.5px] border-border" /></div>
          )}
          {/* Its divider, like VS Code's: drag to move room between the panels around it (`heights` in sidebars.json),
              double-click to fit the one above again. Overlaps the gap below the panel, taking no room. */}
          {divider && (
            <Resizer horizontal label={`Resize ${panel.title}`} resetTip="fit it to its content" className="relative -my-1 h-2 shrink-0"
              onStart={(_x, y) => fit.start(key, y)} onDrag={(_x, y) => fit.move(y)} onEnd={fit.end}
              onReset={() => setPanelHeight(key, null, box.current?.clientHeight)} />
          )}
          </Fragment>
        )
      }) : (
        <div data-stack-empty className={cn("mx-1 mt-2 grid min-h-24 flex-1 place-items-center rounded-[6px] border border-dashed px-4 text-center text-[12px] text-muted-foreground transition-colors",
          hit ? "border-primary/60 bg-primary/10 text-foreground" : "border-border")}>
          Drag panels here
        </div>
      )}
      {hit && panels.length > 0 && <div aria-hidden data-panel-line className="pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary" style={{ top: hit.y }} />}
    </div>
    </SidebarSide.Provider>
  )
}

/** A sidebar's toggle: click opens or folds it; a panel dropped on it goes to that sidebar,
 *  so the right sidebar needs no room before it has panels. Outlined while a panel is dragged; `empty` dims it. */
export function SidebarToggle({ side, open, empty, onClick, className }: { side: Side; open: boolean; empty?: boolean; onClick: () => void; className?: string }) {
  const el = useRef<HTMLButtonElement>(null)
  const d = useDrag()
  const target = `toggle:${side}`
  const hit = useDropHit<true>(target)
  useDropTarget<true>(target, (item, x, y) => {
    const key = draggedPanel(item), b = el.current?.getBoundingClientRect()
    if (!key || !b) return null
    return x >= b.left - 4 && x <= b.right + 4 && y >= b.top - 4 && y <= b.bottom + 4 ? true : null
  }, (item) => {
    dockAtEnd(draggedPanel(item)!, side)
    dropped(item)
  }, { hint: () => `To the ${side} sidebar` })
  const Icon = side === "left" ? PanelLeft : PanelRight
  const name = side === "left" ? "sidebar" : "right sidebar"
  const keys = useCommandKeys(side === "left" ? "sidebar:toggle" : "sidebar:toggle-right", true)
  const dragging = !!d && !!draggedPanel(d.item)
  return (
    <button ref={el} type="button" data-sidebar-toggle={side === "right" ? "right" : ""} onClick={onClick}
      aria-label={`${open ? "Collapse" : "Expand"} ${name}`} data-tip={dragging ? undefined : `${open ? "Collapse" : "Expand"} ${name}${keys}`} data-tip-side={side === "right" ? "left" : undefined}
      className={cn("fixed top-[calc(env(safe-area-inset-top)+--spacing(1.5))] z-30 hidden size-7 cursor-pointer place-items-center rounded-[5px] transition-colors hover:bg-foreground/[0.06] hover:text-foreground md:grid",
        side === "left" ? "left-2" : "right-2",
        hit ? "bg-primary/15 text-primary ring-1 ring-primary" : dragging ? "text-primary ring-1 ring-primary/40" : empty ? "text-tertiary" : "text-muted-foreground", className)}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </button>
  )
}

/** Clicks that belong to what the flyout opened (its menus, a toast's Undo, a dialog), not outside it. */
const OWNED = "[role=menu], [aria-label='Close menu'], [data-sonner-toaster], dialog, [data-flyout]"

/** A `flyout` panel's rail icon, opening the panel beside the rail,
 *  kept on screen. It closes on Escape, a click outside (not in its own menus), the icon again, or any navigation. */
function RailFlyout({ panel, ctx, open, setOpen }: { panel: SidebarPanel; ctx: SidebarCtx; open: boolean; setOpen: (v: boolean) => void }) {
  const icon = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  // Level with the icon, moved up as far as it takes to stay on screen (again as its content loads or the window resizes).
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!icon.current || !box.current) return
      const h = Math.min(box.current.offsetHeight, innerHeight - 16)
      setTop(Math.max(8, Math.min(icon.current.getBoundingClientRect().top - 4, innerHeight - 8 - h)))
    }
    place()
    const ro = new ResizeObserver(place)
    if (box.current) ro.observe(box.current)
    addEventListener("resize", place)
    return () => { ro.disconnect(); removeEventListener("resize", place) }
  }, [open])
  useEffect(() => {
    if (!open) return
    // Closed, the keyboard goes back where it was (or to the file picked in it: core/focus.ts).
    const release = holdFocus()
    const close = () => setOpen(false)
    // (Escape during a drag out of it cancels the drag: core/drag.ts.)
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !getDrag() && !document.querySelector("[role=menu]")) { e.stopPropagation(); close() } }
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest(OWNED) || icon.current?.contains(t)) return
      close()
    }
    addEventListener("keydown", key, true)
    addEventListener("pointerdown", down, true)
    addEventListener("hashchange", close)
    return () => { removeEventListener("keydown", key, true); removeEventListener("pointerdown", down, true); removeEventListener("hashchange", close); release() }
  }, [open, setOpen])
  const Icon = panel.flyout!.icon
  const side = useContext(SidebarSide)
  // Something dragged out of it onto the panes: the flyout steps aside for the rest of the drag so the panes take the
  // drop (let go of nowhere and it's back).
  const d = useDrag()
  useEffect(() => {
    const el = box.current
    if (!el) return
    if (!d) return el.removeAttribute("data-aside")
    const r = el.getBoundingClientRect()
    if (d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) el.setAttribute("data-aside", "")
  }, [d])
  return (
    <div ref={icon}>
      <SidebarRow icon={Icon} label={panel.title} open={false} active={open} tip={open ? null : undefined} data-flyout-icon={ctx.panel}
        data-open={open ? "" : undefined} onClick={() => setOpen(!open)} />
      {open && createPortal(
        <div ref={box} data-flyout={ctx.panel} role="dialog" aria-label={panel.title}
          className={cn("fixed z-40 flex flex-col overflow-hidden rounded-[8px] border-[0.5px] border-border bg-sidebar px-2 pb-2 shadow-[0_8px_28px_rgb(0_0_0/0.16),0_1px_3px_rgb(0_0_0/0.08)] transition-opacity duration-150",
            !panel.tall && "overflow-y-auto", "data-aside:pointer-events-none data-aside:opacity-0")}
          style={{ [side]: `calc(${space(RAIL)} + 6px)`, top, width: panel.flyout!.width ?? 260, ...(panel.tall ? { height: Math.min(560, innerHeight * 0.7) } : { maxHeight: innerHeight - 16 }) }}>
          <PanelFold.Provider value={null}>
            {panel.heading !== false && <SidebarHeading title={panel.heading ?? panel.title} open>{panel.actions?.({ ...ctx, open: true, flyout: true, bounded: true })}</SidebarHeading>}
            <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ ...ctx, open: true, flyout: true, bounded: true })} /></Guard>
          </PanelFold.Provider>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Right-click a sidebar: its panels ticked, More ▸ with the hidden ones and the other sidebar's (a `checklist`). In a
 *  panel (`key`): its own `menu`, Open in a tab, a Panels submenu, Move to the other sidebar and Hide. */
export function panelMenu(key?: string, side?: Side): MenuItem[] {
  const { disabled, order } = getPrefs()
  const s = sidebars()
  const here: Side = side ?? (key ? sideOf(key, s) : null) ?? "left"
  const other: Side = here === "left" ? "right" : "left"
  const all = sidebarPanels(disabled, order)
  const choice = ({ key: k, panel }: PanelOf, hint?: string): CheckItem => ({ key: k, label: panel.title, hint })
  const list = checklist(`panels:${here}`, {
    on: panelsIn(here, s, disabled, order).map((p) => choice(p)),
    off: [all.filter((p) => !sideOf(p.key, s)).map((p) => choice(p)), panelsIn(other, s, disabled, order).map((p) => choice(p, `${other === "left" ? "Left" : "Right"} sidebar`))],
    set: (k, on, before) => (!on ? hidePanel(k) : before ? dockPanel(k, { side: here, before }) : dockAtEnd(k, here)),
  })
  if (!key || !all.some((p) => p.key === key)) return list
  // Right-clicked in a panel that is also a view: open it as a tab (the focused pane; the tab it has already, if any).
  const me = all.find((p) => p.key === key)!.panel, view = me.view
  const own: MenuItem[] = me.menu?.() ?? []
  const open: MenuItem[] = view ? [{ label: `Open ${me.title} in a tab`, icon: SquareArrowOutUpRight, sep: !!own.length, run: () => openView(view, { newTab: true }) }] : []
  // A phone's drawer: a `dockable` panel goes to its dock and back.
  const docked = !!s.dock?.includes(key)
  const dock: MenuItem[] = me.dockable && !isDesktop() ? [{ label: docked ? "Take out of the dock" : "Put in the dock", icon: docked ? PanelBottomClose : PanelBottom, sep: !!(own.length || open.length), run: () => setPanelDocked(key, !docked) }] : []
  return [...own, ...open, ...dock,
    { label: "Panels", icon: Layers, sep: !!(own.length || open.length || dock.length), run: () => {}, items: list },
    { label: `Move to ${other} sidebar`, icon: other === "right" ? PanelRight : PanelLeft, sep: true, run: () => dockAtEnd(key, other) },
    { label: `Hide ${me.title}`, icon: EyeOff, run: () => hidePanel(key) },
  ]
}

/** The sidebar's geometry in Tailwind spacing units so it follows density (rows h-7, icons size-4, rail 11 units):
 *  anything sized in px instead drifts out of line in comfortable. The rail's width: `space(RAIL)`. */
export const RAIL = 11

/** A sidebar row's box (SidebarRow's; a button that looks like one: a blank tab's). */
export const ROW = "group/row flex h-7 items-center gap-2 rounded-[5px] pl-1.5 pr-1 text-[13px] whitespace-nowrap transition-colors"

/** A row in the sidebar, like a pinned page: an icon (in line with the rail's) and a label that fades as it narrows. */
export function SidebarRow({ icon: Icon, iconClassName, tint, badge, tag, label, open, active, onClick, onContextMenu, href, tip, className, children, swipe, ...rest }: {
  /** None: the label alone (file icons turned off). */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>
  label: React.ReactNode; open: boolean; active?: boolean; href?: string
  /** Classes for the row, after its own. */
  className?: string
  /** Classes for the icon, after its own (a status: a pulse). */
  iconClassName?: string
  /** The icon's colour (a CSS colour: a coding agent's own), else the rows' grey (the accent while active). */
  tint?: string
  /** A dot on the icon: something wants the user (an agent waiting for an answer). */
  badge?: boolean
  /** A tiny label on the icon's bottom corner (Badged: the machine a terminal runs on). */
  tag?: string
  /** Its tooltip (defaults to the label when it's text): always in the rail; in the open sidebar only when it says
   *  something the row doesn't, else when the label is cut off. A label that isn't text counts as said by `tip`;
   *  null: none. `onClick` hears a middle-click too (`e.button` 1: open it in a new tab). */
  tip?: string | null
  onClick?: (e: React.MouseEvent) => void; onContextMenu?: (e: React.MouseEvent) => void
  /** Drawn at the right end (a button, a count). */
  children?: React.ReactNode
  /** What a finger swiping it shows (the buttons a mouse finds on hover: SwipeRow). */
  swipe?: () => SwipeAction[]
} & Record<`data-${string}`, string | undefined>) {
  const text = tip === null ? undefined : tip ?? (typeof label === "string" ? label : undefined)
  const more = typeof label === "string" && text !== label
  const side = useContext(SidebarSide)
  const row = (
    <a href={href ?? "#"} data-keyrow {...rest} data-tip={text} data-tip-trunc={open && !more ? "" : undefined} data-tip-side={side === "right" ? "left" : "right"} aria-label={text ?? (typeof label === "string" ? label : undefined)}
      onClick={(e) => { if (!onClick) return; e.preventDefault(); onClick(e) }} onContextMenu={onContextMenu}
      // A middle-click is a click that asks for a new tab (e.button 1), as in the file tree: never the browser's new tab.
      onAuxClick={(e) => { if (e.button !== 1) return; e.preventDefault(); onClick?.(e) }}
      className={cn(
        ROW,
        active ? "bg-foreground/[0.08] font-medium" : "hover:bg-foreground/[0.04]", className,
      )}>
      {Icon && <Badged on={badge} tag={tag}>
        <Icon className={cn("size-4 shrink-0", tint ? undefined : active ? "text-primary" : "text-muted-foreground", iconClassName)} strokeWidth={2} style={tint ? { color: tint } : undefined} />
      </Badged>}
      <span className={cn("min-w-0 flex-1 truncate transition-opacity duration-200", !open && "opacity-0")}>{label}</span>
      {open && children}
    </a>
  )
  return swipe && coarse && open ? <SwipeRow actions={swipe} className="rounded-[5px]">{row}</SwipeRow> : row
}

/** The search field: opens the quick switcher (⌘O works without it). Its 0.5px border and its padding make a row's
 *  `pl-1.5`, so its icon lines up with theirs. */
export function SidebarSearch({ open }: SidebarCtx) {
  const side = useContext(SidebarSide)
  const keys = useCommandKeys("switcher:open", true), first = firstKeys("switcher:open")
  return (
    // The panel is this one control, so it's its own handle: drag it to move the panel, click it to search.
    <button type="button" data-sidebar-search data-panel-handle={open ? "" : undefined} data-heading="Search" onClick={() => runCommandById("switcher:open")} data-tip={open ? undefined : `Search${keys}`} data-tip-side={side === "right" ? "left" : "right"} aria-label="Search"
      className={cn(
        "group flex h-7 w-full shrink-0 cursor-pointer items-center gap-2 rounded-[5px] border-[0.5px] pr-1 pl-[calc(--spacing(1.5)-0.5px)] text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-foreground/[0.04]",
        open ? "border-border bg-background/60" : "border-transparent",
      )}>
      <Search className="size-4 shrink-0" strokeWidth={2.25} />
      {/* In the rail only the icon: the label and keycaps would make the rail wider than itself (a scrollbar). */}
      {open && <span className="flex-1 text-left">Search</span>}
      {/* Shortcut keycaps, only on hover or keyboard focus. */}
      {open && first && <span aria-hidden className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        {keyCaps(first).map((k, i) => (
          <kbd key={i} className="grid h-5 min-w-5 place-items-center rounded-[4px] border-[0.5px] border-border bg-foreground/[0.06] px-1 font-sans text-[11px] leading-none text-muted-foreground">{k}</kbd>
        ))}
      </span>}
    </button>
  )
}

/** The vault's files, the file explorer. In the rail it's the flyout's (plugins/core/files: which folders are open
 *  is kept meanwhile). */
export function FilesPanel({ store, open, phone, file, bounded }: SidebarCtx) {
  if (!open) return null
  return (
    <div className={cn("flex flex-1 flex-col", bounded && "min-h-0")}>
      <FileTree store={store} active={file} scroll={!!bounded} revealScroll={!phone} className={cn("flex-1", bounded && "min-h-0")} />
    </div>
  )
}
