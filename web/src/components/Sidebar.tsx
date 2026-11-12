// The desktop sidebar's panels, drawn from plugins' `sidebar` definitions (Search, Files and Pinned are plugins too, so
// turning them off empties it). The components here are exported to plugins.
import { Children, createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { ChevronsDownUp, Ellipsis, EyeOff, Heading, Layers, PanelBottom, PanelBottomClose, PanelLeft, PanelRight, PanelTop, Search, SlidersHorizontal, SquareArrowOutUpRight, type LucideIcon } from "lucide-react"
import type { SidebarCtx, SidebarPanel, TabMark } from "@/core/define"
import { edgeScroller, getDrag, onDrag, startDrag, useDrag, useDragItem, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
import { openView } from "@/core/files"
import { openDetail } from "@/core/nav"
import { isDesktop, keysText } from "@/core/platform"
import { closeTab } from "@/core/workspace"
import { defaultHeading, dockAtEnd, dockPanel, drawerPanels, headerItems, headingMode, setPanelHeading, hideBarItem, hidePanel, isBarItem, setHeaderItemShown, shownHeaderItems, panelOfView, panelsIn, setPanelDocked, setPanelHeight, sideOf, sidebarPanels, sidebars, togglePanelCollapsed, useSidebars, type HeadingMode, type PanelOf, type Side } from "@/core/plugins"
import { getPrefs, usePrefs } from "@/core/prefs"
import { firstKeys, keyCaps, runCommandById, useCommandKeys } from "@/core/commands"
import { useDismiss } from "@/core/focus"
import { coarse } from "@/core/haptics"
import { checklist, commandItems, menuFor, rightClickBelow, type CheckItem, type MenuItem } from "@/components/ContextMenu"
import { HeadingButton } from "@/components/Button"
import { FileTree } from "@/components/FileTree"
import { Drawn, Guard } from "@/components/Guard"
import { Badged, Bar, IconAction, type Dot } from "@/components/kit"
import { cn, space } from "@/lib/utils"
import { INCOMING, reorder, slotAt, useSlide } from "@/core/slide"
import { Resizer } from "@/components/Resizer"
import { usePanelLayout } from "@/components/panelLayout"
import { foldPanel, liftedHeight, settle } from "@/components/panelMotion"

import { modeJustSwitched, useSidebarMode, setSidebarMode } from "@/core/sidebarmode"
import { PanelAlone, PanelFold, PanelHeading, SidebarHeading } from "@/components/SidebarHeading"
import { watchHeadingPeek } from "@/core/headingpeek"
import { SwipeRow, type SwipeAction } from "@/components/SwipeRow"
export { PanelFold, SidebarHeading }

const PANELS = "panels"
/** Where a dragged panel would land in a sidebar (core/sidebars.ts Place): before panel `before` (null: the end), and
 *  the panels' `order` that leaves, which they make way for (core/slide.ts). */
type PanelDrop = { before: string | null; order: string[] }
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
  const prefs = usePrefs()
  const { disabled, sidebarScroll, panelDividers } = prefs
  const setup = useSidebars()
  useEffect(watchHeadingPeek, [])
  const panels = (ctx.phone ? drawerPanels : panelsIn)(side, setup, disabled)
  // Each panel scrolls in its own box, under a divider that sets its height, or the sidebar scrolls them all as one
  // (appearance.json `sidebarScroll`: Settings > Appearance). Phones' drawers scroll as one: a finger has no divider to drag.
  const own = sidebarScroll !== "sidebar" && !ctx.phone
  const box = useRef<HTMLDivElement>(null)
  const fit = usePanelLayout(box, own && ctx.open, setup, panels)
  const [edge] = useState(edgeScroller)
  const item = useDragItem()
  const target = `${PANELS}:${side}`
  const hit = useDropHit<PanelDrop>(target)
  useDropTarget<PanelDrop>(target, (item, x, y) => {
    const key = draggedPanel(item), el = box.current
    if (!key || !el || !ctx.open) return null
    const b = el.getBoundingClientRect()
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) { edge.stop(); return null }
    edge.near(el, y)
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-panel]")]
    const { order, before, same } = reorder(rows.map((r) => r.dataset.panel!), [key], slotAt(el, rows, x, y, "y"))
    // (its own place: nothing to do; a pane's tab of it still goes, closing)
    return same && item.from === "panel" ? null : { before, order }
  }, (item, h) => {
    dockPanel(draggedPanel(item)!, { side, before: h.before })
    dropped(item)
  }, { hint: () => intoHint(side), end: edge.stop })

  // Dragged over, the panels make way for the one dragged (its dividers out of the way meanwhile); one of its own over
  // the other sidebar, they close up where it was.
  const over = useDrag((d) => d?.hit?.target ?? null)
  const mine = item?.from === "panel" ? item.panel : undefined
  const other = side === "left" ? "right" : "left"
  const leaving = !!mine && (over === `${PANELS}:${other}` || over === `toggle:${other}`) && panels.some((p) => p.key === mine)
  const making = hit && ctx.open && panels.length ? hit.order : leaving && ctx.open ? panels.map((p) => p.key).filter((k) => k !== mine) : null
  useSlide(box, making, "y")
  // A panel let go flies into its place (components/panelMotion.ts), once it's drawn there.
  useLayoutEffect(settle)

  const [flying, setFlying] = useState<string | null>(null)
  useEffect(() => { if (ctx.open) setFlying(null) }, [ctx.open])
  // The left sidebar showing one panel alone (its mode): that panel fills it. The rail and phones keep the panels.
  const mode = useSidebarMode()
  // (the panels again: its body is new, this component isn't)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fades = useMemo(modeJustSwitched, [mode])
  const alone = side === "left" && !ctx.phone ? sidebarPanels(disabled).find((p) => p.key === mode) : undefined
  // Once shown, its panels stay drawn while it's a rail, hidden (display: none, so nothing finds them on screen):
  // showing it again mounted ~1,500 elements anew. Not when it shows one alone: that's what shows again.
  const [kept, setKept] = useState(ctx.open && !alone)
  if (ctx.open && !ctx.phone && kept !== !alone) setKept(!alone)
  if (alone && ctx.open) return <SidebarSide.Provider value={side}><SidebarMode of={alone} ctx={ctx} /></SidebarSide.Provider>

  const rail = !ctx.open && (
        <div data-rail className="edge-fade-y relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-width:none]">
          {head && <div data-rail-section className="flex shrink-0 flex-col">{head}</div>}
          {panels.map(({ key, panel }) => (
            <div key={key} data-panel={key} data-ui={`panel:${key}`} role="group" aria-label={panel.title} data-rail-section className="flex shrink-0 flex-col" onContextMenu={menuFor(() => panelMenu(key, side))}>
              {panel.flyout
                ? <RailFlyout panel={panel} ctx={{ ...ctx, panel: key }} open={flying === key} setOpen={(v) => setFlying(v ? key : null)} />
                : <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ ...ctx, panel: key })} /></Guard>}
            </div>
          ))}
        </div>
  )
  if (rail && !kept) return <SidebarSide.Provider value={side}>{rail}</SidebarSide.Provider>
  const shown = ctx.open ? ctx : { ...ctx, open: true }

  return (
    // One rhythm for every panel, whatever it draws: 1 unit under each (folded or not) and its heading's 2 above, so 3
    // units between any two panels; and the last one ends 2 units above the vault's bar.
    <SidebarSide.Provider value={side}>
    {rail}
    <div ref={box} data-sidebar-body={ctx.open ? side : undefined} data-sidebar-kept={ctx.open ? undefined : side} inert={!ctx.open} data-mode-fade={fades || undefined} data-headings-peek={item?.from === "panel" || undefined} data-scroll={own ? "panels" : "sidebar"} onDoubleClick={(e) => { const key = emptyRoomOf(e.target, box.current); panels.find((p) => p.key === key)?.panel.emptyDoubleClick?.() }}
      className={cn("edge-fade-b relative flex min-h-0 flex-1 flex-col pb-1", !ctx.open && "hidden", own ? "overflow-x-hidden overflow-y-auto" : "overflow-y-auto overscroll-contain",
        making && "[&>:not([data-slide])]:invisible")}>
      {panels.length ? panels.map((p, i) => {
        const { key, panel } = p
        const folded = setup.collapsed.includes(key)
        const heading = headingMode(p, setup, prefs)
        // A divider under it while a panel below it is open (none under the last: nothing to give it room).
        const divider = own && !folded && panels.slice(i + 1).some((q) => !setup.collapsed.includes(q.key))
        return (
          <Fragment key={key}>
          <div data-panel={key} data-ui={`panel:${key}`} id={panelId(key)} role="group" aria-label={panel.heading || panel.title} aria-labelledby={`${panelId(key)}-name`} data-slide={key} data-collapsed={folded || undefined} onContextMenu={menuFor(() => panelMenu(key, side))}
            onPointerDown={(e) => {
              const t = e.target as HTMLElement
              // With a `view`, dropped on a pane it opens as a tab. A button that is itself the
              // handle (the search field) drags too: a drag starts only once the pointer moves, so a click still works.
              const control = t.closest("button, a, input")
              const handle = t.closest<HTMLElement>("[data-panel-handle]")
              if (handle && (!control || control.hasAttribute("data-panel-handle"))) {
                // A phone's drawer: a finger holds the heading to pick it up (a plain touch scrolls or folds it).
                // A computer's lifts the whole panel (panelMotion.ts); a finger's carries its name.
                startDrag(e, { from: "panel", panel: key, label: handle.dataset.heading || panel.heading || panel.title, to: panel.view ? `view:${panel.view}` : undefined, drawn: !ctx.phone }, { touch: true })
              }
            }}
            className={cn("flex shrink-0 flex-col pb-1", (heading !== "shown" || prefs.panelHeadings === "quiet") && !folded && "has-[[data-panel-empty]]:hidden", item?.panel === key && (item.drawn ? "invisible" : "opacity-50"))}>
            {/* With quiet headings, a panel with nothing to show (marked `data-panel-empty`) takes no room;
                a panel picked up shows every quiet heading's name (the body's data-headings-peek). */}
            {/* Its own box (each panel scrolling in its own: the height usePanelLayout gives it), around what it draws
                (measured: the most it's given). Scrolling as one, both are plain. */}
            <div data-panel-scroll className={cn("flex min-h-0 flex-col", own && !folded && "edge-fade-b overflow-y-auto")}>
              <div data-panel-content className="flex shrink-0 flex-col">
                <PanelFold.Provider value={{ collapsed: folded, toggle: () => foldPanel(box.current, key, () => togglePanelCollapsed(key)), controls: panelId(key) }}>
                  <PanelHeading.Provider value={heading}>
                    {panel.heading !== false && <SidebarHeading title={panel.heading ?? panel.title} open>{panel.actions?.({ ...shown, panel: key })}</SidebarHeading>}
                    <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ ...shown, panel: key })} /></Guard>
                  </PanelHeading.Provider>
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
      {/* Where one from the other sidebar would go: room as tall as its picture, as in its own; a pane's tab, a heading's
          room, shaded. */}
      {making?.includes(INCOMING) && <div aria-hidden data-slide={INCOMING} data-slide-fixed className={cn("absolute inset-x-1 top-0 h-7", liftedHeight() && "bg-transparent")} style={{ height: liftedHeight() }} />}
    </div>
    </SidebarSide.Provider>
  )
}

const leaveMode = () => setSidebarMode(null)
/** A panel's element id, for its heading's aria-controls. */
const panelId = (key: string) => `panel-${key.replace(/[^\w-]/g, "-")}`

/** A panel alone in the left sidebar, filling it (its own box, scrolling under its heading), with an X on its heading
 *  back to the panels. Right-click: its own menu, Open in a tab, Show panels. */
function SidebarMode({ of: { key, panel }, ctx }: { of: PanelOf; ctx: SidebarCtx }) {
  const menu = (): MenuItem[] => {
    const own: MenuItem[] = panel.menu?.() ?? []
    const view = panel.view
    const tab = panel.tab?.() ?? (view ? { name: panel.title, open: () => openView(view, { newTab: true }) } : null)
    return [...own, ...(tab ? [{ label: `Open ${tab.name} in a tab`, icon: SquareArrowOutUpRight, sep: !!own.length, run: tab.open }] : []),
      { label: "Show panels", icon: Layers, sep: true, run: leaveMode }]
  }
  const draw = { ...ctx, panel: key, open: true, bounded: true, mode: true }
  const [fades] = useState(modeJustSwitched)
  return (
    <div data-sidebar-body="left" data-sidebar-mode={key} data-ui={`panel:${key}`} role="group" aria-label={panel.heading || panel.title} data-mode-fade={fades || undefined} onContextMenu={menuFor(menu)}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-1">
      <PanelFold.Provider value={null}>
        <PanelAlone.Provider value={leaveMode}>
          {panel.heading !== false && <SidebarHeading title={panel.heading ?? panel.title} open>{panel.actions?.(draw)}</SidebarHeading>}
          <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render(draw)} /></Guard>
        </PanelAlone.Provider>
      </PanelFold.Provider>
    </div>
  )
}

/** The open panel whose empty room `at` is (its key): its box's under what it draws, or the sidebar's under the last. */
function emptyRoomOf(at: EventTarget, body: HTMLElement | null) {
  if (!(at instanceof HTMLElement) || !body) return undefined
  const el = at === body ? [...body.querySelectorAll<HTMLElement>(":scope > [data-panel]")].at(-1)
    : at.matches("[data-panel], [data-panel-scroll]") ? at.closest<HTMLElement>("[data-panel]") : null
  return el && !el.dataset.collapsed ? el.dataset.panel : undefined
}

/** A sidebar's toggle: click opens or folds it; a panel dropped on it goes to that sidebar, so the right sidebar needs
 *  no room before it has panels. Outlined while another's panel is dragged, lit under it; `empty` dims it. */
export function SidebarToggle({ side, open, empty, onClick, className, style }: { side: Side; open: boolean; empty?: boolean; onClick: () => void; className?: string; style?: CSSProperties }) {
  const el = useRef<HTMLButtonElement>(null)
  const item = useDragItem()
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
  // (as its command says it: Show / Hide, like View > Hide Sidebar)
  const name = side === "left" ? "left sidebar" : "right sidebar"
  const keys = useCommandKeys(side === "left" ? "sidebar:toggle" : "sidebar:toggle-right", true)
  const carried = item && draggedPanel(item)
  const dragging = !!carried && sideOf(carried) !== side
  return (
    <button ref={el} type="button" data-sidebar-toggle={side === "right" ? "right" : ""} data-ui={side === "right" ? "button:sidebar:toggle-right" : "button:sidebar:toggle"} onClick={onClick} style={style}
      aria-label={`${open ? "Hide" : "Show"} ${name}`} aria-expanded={open} data-tip={dragging ? undefined : `${open ? "Hide" : "Show"} ${name}${keys}`} data-tip-side={side === "right" ? "left" : undefined}
      className={cn("fixed top-[calc(env(safe-area-inset-top)+--spacing(1.5))] z-30 hidden size-7 cursor-pointer place-items-center rounded-[5px] transition-[color,background-color,box-shadow,scale] duration-(--motion-fast) ease-(--ease-out) hover:bg-foreground/[0.06] hover:text-foreground md:grid",
        side === "left" ? "left-[calc(env(safe-area-inset-left)+--spacing(2))]" : "right-[calc(env(safe-area-inset-right)+--spacing(2))]",
        hit ? "scale-110 bg-primary/15 text-primary ring-1 ring-primary" : dragging ? "bg-primary/[0.06] text-primary ring-1 ring-primary/40" : empty ? "text-tertiary" : "text-muted-foreground", className)}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </button>
  )
}

/** Clicks that belong to what the flyout opened (its menus, a toast's Undo, a dialog, its editor's suggestions), not
 *  outside it. */
const OWNED = "[role=menu], [aria-label='Close menu'], [data-sonner-toaster], dialog, [data-flyout], .vau-tooltips"
/** Escape is the editor's while the focus is in one (its suggestions, Vim's normal mode), not the flyout's to close. */
const editing = (e: KeyboardEvent) => !!(e.target as Element | null)?.closest?.(".cm-editor")

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
  // (Escape during a drag out of it cancels the drag: core/drag.ts.)
  useDismiss(open, () => setOpen(false), { inside: OWNED, anchor: icon, hash: true, escape: (e) => !getDrag() && !editing(e) })
  const Icon = panel.flyout!.icon
  const side = useContext(SidebarSide)
  // Something dragged out of it onto the panes: the flyout steps aside for the rest of the drag so the panes take the
  // drop (let go of nowhere and it's back).
  useEffect(() => {
    if (!open) return
    return onDrag(() => {
      const el = box.current, d = getDrag()
      if (!el) return
      if (!d) return el.removeAttribute("data-aside")
      const r = el.getBoundingClientRect()
      if (d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) el.setAttribute("data-aside", "")
    })
  }, [open])
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

/** A panel's icon: its rail icon, else its plugin's. */
export const panelIcon = ({ panel, plugin }: PanelOf) => (panel.flyout?.icon ?? plugin.icon) as LucideIcon

/** Right-click a sidebar: its panels ticked, More ▸ with the hidden ones and the other sidebar's (a `checklist`). In a
 *  panel (`key`): its own `menu`, Open in a tab, a Panels submenu, Move to the other sidebar and Hide. */
export function panelMenu(key?: string, side?: Side): MenuItem[] {
  const { disabled } = getPrefs()
  const s = sidebars()
  const here: Side = side ?? (key ? sideOf(key, s) : null) ?? "left"
  const other: Side = here === "left" ? "right" : "left"
  const all = sidebarPanels(disabled)
  // (on but out of sight: an empty one, with quiet headings, takes no room; ticking it again would seem to do nothing)
  const away = (k: string) => { const el = document.querySelector(`[data-panel="${CSS.escape(k)}"]`); return !!el?.querySelector("[data-panel-empty]") && getComputedStyle(el).display === "none" }
  const choice = (p: PanelOf, hint?: string): CheckItem => ({ key: p.key, label: p.panel.title, icon: panelIcon(p), hint: hint ?? (away(p.key) ? "Hidden while empty" : undefined) })
  const list = checklist(`panels:${here}`, {
    on: panelsIn(here, s, disabled).map((p) => choice(p)),
    off: [all.filter((p) => !sideOf(p.key, s)).map((p) => choice(p)), panelsIn(other, s, disabled).map((p) => choice(p, `${other === "left" ? "Left" : "Right"} sidebar`))],
    set: (k, on, before) => (!on ? hidePanel(k) : before ? dockPanel(k, { side: here, before }) : dockAtEnd(k, here)),
  })
  list.push({ label: "Customize sidebars…", icon: SlidersHorizontal, sep: true, run: () => openDetail("sidebars") })
  if (!key || !all.some((p) => p.key === key)) return list
  // Right-clicked in a panel that is also a view: open it as a tab (the focused pane; the tab it has already, if any).
  const me = all.find((p) => p.key === key)!.panel, view = me.view
  const own: MenuItem[] = me.menu?.() ?? []
  const tab = me.tab?.() ?? (view ? { name: me.title, open: () => openView(view, { newTab: true }) } : null)
  const open: MenuItem[] = tab ? [{ label: `Open ${tab.name} in a tab`, icon: SquareArrowOutUpRight, sep: !!own.length, run: tab.open }] : []
  // A phone's drawer: a `dockable` panel goes to its dock and back.
  const docked = !!s.dock?.includes(key)
  // Its heading: shown, quiet or hidden (holding ⌥ shows either); one that isn't shown can't be clicked to fold, so folding is here too.
  const of = all.find((p) => p.key === key)!, mode = headingMode(of, s), placed = !!sideOf(key, s)
  // (the one Quiet panel headings gives every panel says Default: picking another is this panel's own)
  const pick = (v: HeadingMode, label: string, hint?: string): MenuItem => ({ label, hint: v === defaultHeading(of.panel) ? "Default" : hint, checked: mode === v, run: () => setPanelHeading(of, v) })
  const ways = [pick("shown", "Shown"), pick("quiet", "Shown when pointed at"), pick("hidden", "Hidden", keysText("hold ⌥ to see"))]
  const head: MenuItem[] = !placed ? [] : [{ label: "Heading", icon: Heading, hint: ways.find((w) => w.checked)?.label, sep: !!(own.length || open.length), run: () => {}, items: ways },
    ...(mode !== "shown" && !s.collapsed.includes(key) ? [{ label: `Fold ${me.title}`, icon: ChevronsDownUp, run: () => togglePanelCollapsed(key) }] : [])]
  const dock: MenuItem[] = me.dockable && !isDesktop() ? [{ label: docked ? "Take out of the dock" : "Put in the dock", icon: docked ? PanelBottomClose : PanelBottom, sep: !!(own.length || open.length), run: () => setPanelDocked(key, !docked) }] : []
  return [...own, ...open, ...head, ...dock,
    { label: "Panels", icon: Layers, sep: !!(own.length || open.length || head.length || dock.length), run: () => {}, items: list },
    // Where it is, together: the tab list on top instead (the tab bar), in the other sidebar, nowhere.
    ...(me.tabList ? commandItems("tab:sidebar", "setting:pane-tab-bars").map((it, i) => ({ ...it, sep: i === 0 })) : []),
    { label: `Move to ${other} sidebar`, icon: other === "right" ? PanelRight : PanelLeft, sep: !me.tabList, run: () => dockAtEnd(key, other) },
    // (a top bar item's own menu has Move to top bar; hidden, it leaves the top bar too)
    { label: `Hide ${me.title}`, icon: EyeOff, run: () => (isBarItem(key) ? hideBarItem(key) : hidePanel(key)) },
  ]
}

/** The sidebar header's menu: the sidebar's, with Header ▸ ticking which plugins' items it shows (few: no More). */
export function headerMenu(): MenuItem[] {
  const { disabled } = getPrefs()
  const all = headerItems(disabled), shown = new Set(shownHeaderItems(disabled).map((x) => x.key))
  const menu = panelMenu()
  if (!all.length) return menu
  const items: MenuItem[] = all.map((x) => ({ label: x.plugin.name, icon: x.plugin.icon, checked: shown.has(x.key), keep: true,
    run: () => void setHeaderItemShown(x.key, !shown.has(x.key)) }))
  const at = menu.findIndex((m) => m.label === "Customize sidebars…")
  const header: MenuItem = { label: "Header", icon: PanelTop, sep: true, run: () => {}, items }
  return at < 0 ? [...menu, header] : [...menu.slice(0, at), header, { ...menu[at], sep: false }, ...menu.slice(at + 1)]
}

/** The sidebar's geometry in Tailwind spacing units so it follows density (rows h-7, icons size-4, rail 11 units):
 *  anything sized in px instead drifts out of line in comfortable. The rail's width: `space(RAIL)`. */
export const RAIL = 11

/** A sidebar row's box (SidebarRow's; a button that looks like one: a blank tab's). */
export const ROW = "group/row flex h-7 items-center gap-2 rounded-[5px] pl-1.5 pr-1 text-[13px] whitespace-nowrap transition-colors"

/** A row in the sidebar, like a pinned page: an icon (in line with the rail's) and a label that fades as it narrows. */
export function SidebarRow({ icon: Icon, iconClassName, tint, badge, tag, mark, label, labelClassName, open, active, onClick, onContextMenu, href, tip, className, children, more: dots, actions, swipe, ...rest }: {
  /** None: the label alone (file icons turned off). */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>
  label: React.ReactNode; open: boolean; active?: boolean; href?: string
  /** Classes for the label's box (a drawn label that mustn't fade at its end: a split tab's map). */
  labelClassName?: string
  /** Classes for the row, after its own. */
  className?: string
  /** Classes for the icon, after its own (a status: a pulse). */
  iconClassName?: string
  /** The icon's colour (a CSS colour: a coding agent's own), else the rows' grey (the accent while active). */
  tint?: string
  /** A dot on the icon (Badged's kinds): an agent at work, waiting for an answer. */
  badge?: Dot
  /** A tiny label on the icon's bottom corner (Badged: the machine a terminal runs on). */
  tag?: string
  /** A small button beside the icon (a tab's mark: a page playing sound, its speaker). */
  mark?: TabMark
  /** Its tooltip (default the label, when text): always in the rail; open, only when it adds to the row or the label is
   *  cut off. A non-text label counts as said by `tip`; null: none. `onClick` hears middle-click too (new tab). */
  tip?: string | null
  onClick?: (e: React.MouseEvent) => void; onContextMenu?: (e: React.MouseEvent) => void
  /** Drawn at the right end (a button, a count). */
  children?: React.ReactNode
  /** A … on hover, opening its right-click menu (its own or its wrapper's): for a row whose menu has more than opening
   *  it. A finger holds the row instead. */
  more?: boolean
  /** Buttons only a hovering pointer needs (a tab's Close), before the …. Drawn over the label's end, which fades under
   *  them, so hovering moves nothing; `children` stay where they are. */
  actions?: React.ReactNode
  /** What a finger swiping it shows (the buttons a mouse finds on hover: SwipeRow). */
  swipe?: () => SwipeAction[]
} & Record<`data-${string}`, string | undefined> & { "aria-expanded"?: boolean; "aria-current"?: "page" }) {
  const text = tip === null ? undefined : tip ?? (typeof label === "string" ? label : undefined)
  const more = typeof label === "string" && text !== label
  const side = useContext(SidebarSide)
  const hovers = open ? Children.toArray(actions).length + (dots && !coarse ? 1 : 0) : 0
  // (named by what it shows, its count too, as a screen reader's user hears it read; a tip that says more describes it)
  const row = (
    <a href={href ?? "#"} data-keyrow {...rest} data-tip={text} data-tip-trunc={open && !more ? "" : undefined} data-tip-side={side === "right" ? "left" : "right"} aria-label={typeof label === "string" ? undefined : text} aria-description={more ? text : undefined}
      onClick={(e) => { if (!onClick) return; e.preventDefault(); onClick(e) }} onContextMenu={onContextMenu}
      // A middle-click is a click that asks for a new tab (e.button 1), as in the file tree: never the browser's new tab.
      onAuxClick={(e) => { if (e.button !== 1) return; e.preventDefault(); onClick?.(e) }}
      style={hovers ? { "--row-actions": `calc(var(--spacing) * ${5.5 * hovers + 0.5})` } as CSSProperties : undefined}
      className={cn(
        ROW,
        active ? "bg-foreground/[0.08] font-medium" : "hover:bg-foreground/[0.04]", className,
      )}>
      {Icon && <Badged on={badge} tag={tag}>
        <Icon className={cn("size-4 shrink-0", tint ? undefined : active ? "text-primary" : "text-muted-foreground", iconClassName)} strokeWidth={2} style={tint ? { color: tint } : undefined} />
      </Badged>}
      {/* (on the left, where hovering the row doesn't move it: the … and X come in on the right) */}
      {open && mark && <IconAction action={mark} className="-ml-1"><mark.icon className={cn("size-3.5 shrink-0", !mark.tint && "text-muted-foreground")} strokeWidth={2.25} style={mark.tint ? { color: mark.tint } : undefined} /></IconAction>}
      <span className={cn("min-w-0 flex-1 fade-end [transition:opacity_var(--motion),--fade-reserve_var(--motion-fast)_var(--ease-out)]", !open && "opacity-0", hovers && "group-hover/row:[--fade-reserve:var(--row-actions)]", labelClassName)}>{label}</span>
      {/* (pinned to the label's end, taking no room: hidden, not removed, so nothing moves when they show) */}
      {hovers > 0 && (
        <span className="relative -ml-2 self-stretch">
          <span data-row-actions className="invisible absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-[opacity,visibility] duration-(--motion-fast) group-hover/row:visible group-hover/row:opacity-100">
            {actions}
            {dots && !coarse && <HeadingButton icon={Ellipsis} label={`More for ${text ?? "this"}`} tip="More" data-no-drag data-row-more onClick={rightClickBelow} />}
          </span>
        </span>
      )}
      {open && children}
    </a>
  )
  return swipe && coarse && open ? <SwipeRow actions={swipe} className="rounded-[5px]">{row}</SwipeRow> : row
}

// (at most a label's length, however wide the page)
const widths = ["min(58%, 13em)", "min(44%, 10em)", "min(66%, 15em)", "min(50%, 11em)", "min(62%, 14em)", "min(40%, 9em)"]
/** Rows on their way: SidebarRow's shape, its icon a muted square and its label a bar (`right`: a bar at its end, as
 *  a time or a count); in a `data-size-up` list where the real rows are. `useKeptCount` gives as many as last time. */
export function LoadingSidebarRows({ count, right, className, ...rest }: { count: number; right?: boolean; className?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className={cn("loading-in flex flex-col gap-px", className)} aria-busy {...rest}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn(ROW, "cursor-default")}>
          <span className="skeleton size-4 shrink-0 rounded-[4px]" />
          <span className="min-w-0 flex-1"><Bar w={widths[i % widths.length]} /></span>
          {right && <span className="mr-1 shrink-0 text-[11px]"><Bar w="3em" /></span>}
        </div>
      ))}
    </div>
  )
}

/** A sidebar tile, a SidebarRow drawn as its icon alone, bigger (a grid of them: Pinned's tiles): named by its
 *  tooltip, under it. Its icon keeps a row's colours; active, the tile stands out as a segmented control's choice. */
export function SidebarTile({ icon: Icon, iconClassName, tint, badge, label, active, onClick, onContextMenu, href, className, ...rest }: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>
  label: string; active?: boolean; href?: string; className?: string; iconClassName?: string; tint?: string; badge?: Dot
  onClick?: (e: React.MouseEvent) => void; onContextMenu?: (e: React.MouseEvent) => void
} & Record<`data-${string}`, string | undefined>) {
  return (
    <a href={href ?? "#"} data-keyrow {...rest} data-tip={label} aria-label={label} aria-current={active ? "page" : undefined}
      onClick={(e) => { if (!onClick) return; e.preventDefault(); onClick(e) }} onContextMenu={onContextMenu}
      onAuxClick={(e) => { if (e.button !== 1) return; e.preventDefault(); onClick?.(e) }}
      // (on a phone, a size up: a unit flatter, nearer a row's height)
      className={cn("grid h-10 min-w-0 place-items-center rounded-[8px] transition-colors max-md:h-9",
        active ? "bg-[var(--segment-on)] shadow-[0_1px_3px_rgb(0_0_0/0.1)] ring-[0.5px] ring-border" : "bg-foreground/[0.05] hover:bg-foreground/[0.09]", className)}>
      <Badged on={badge}>
        <Icon className={cn("size-[18px] shrink-0", tint ? undefined : active ? "text-primary" : "text-muted-foreground", iconClassName)} strokeWidth={2} style={tint ? { color: tint } : undefined} />
      </Badged>
    </a>
  )
}

/** The search field: opens the quick switcher (⌘O works without it). Its 0.5px border and its padding make a row's
 *  `pl-1.5`, so its icon lines up with theirs. */
export function SidebarSearch({ open }: SidebarCtx) {
  const side = useContext(SidebarSide)
  const keys = useCommandKeys("switcher:open", true)
  return (
    // The panel is this one control, so it's its own handle: drag it to move the panel, click it to search.
    <button type="button" data-sidebar-search data-ui="button:switcher:open" data-panel-handle={open ? "" : undefined} data-heading="Search" onClick={() => runCommandById("switcher:open")} data-tip={open ? undefined : `Search${keys}`} data-tip-side={side === "right" ? "left" : "right"} aria-label="Search"
      className={cn(
        "group flex h-7 w-full shrink-0 cursor-pointer items-center gap-2 rounded-[5px] border-[0.5px] pr-1 pl-[calc(--spacing(1.5)-0.5px)] text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-foreground/[0.04]",
        open ? "border-border bg-background/60" : "border-transparent",
      )}>
      <Search className="size-4 shrink-0" strokeWidth={2.25} />
      {/* In the rail only the icon: the label and keycaps would make the rail wider than itself (a scrollbar). */}
      {open && <span className="flex-1 text-left">Search</span>}
      {open && <RowKeys id="switcher:open" className="group-hover:opacity-100 group-focus-visible:opacity-100" />}
    </button>
  )
}

/** A command's keycaps at a sidebar row's end, shown on hover or keyboard focus (`className` says the row's group):
 *  the search field's ⌘O, the Tabs panel's ⌘T. Nothing while the command has no keys here. */
export function RowKeys({ id, className }: { id: string; className?: string }) {
  useCommandKeys(id)
  const first = firstKeys(id)
  if (!first) return null
  return (
    <span aria-hidden className={cn("flex shrink-0 gap-1 opacity-0 transition-opacity duration-150", className)}>
      {keyCaps(first).map((k, i) => (
        <kbd key={i} className="grid h-5 min-w-5 place-items-center rounded-[4px] border-[0.5px] border-border bg-foreground/[0.06] px-1 font-keys text-[11px] leading-none text-muted-foreground">{k}</kbd>
      ))}
    </span>
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
