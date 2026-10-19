// Customize sidebars: both sidebars side by side as they sit in the window, and the hidden panels under them. Arranging
// lives here, in a sheet that stays open, rather than in menus that close as the pointer lets go.
import { useEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { ArrowDown, ArrowUp, Ellipsis, EyeOff, PanelLeft, PanelRight, SlidersHorizontal } from "lucide-react"
import { startDrag, useDrag, useDropHit, useDropTarget, type DragItem } from "@/core/drag"
import { fuzzy } from "@/core/fuzzy"
import { defaultPanels, dockPanel, hidePanel, panelsIn, restoreSidebars, sideOf, sidebarPanels, useSidebars, type PanelOf, type Side } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { menuFor, rightClickBelow, type MenuItem } from "@/components/ContextMenu"
import { FilterField, SheetHead } from "@/components/kit"
import { panelIcon } from "@/components/Sidebar"
import { cn } from "@/lib/utils"

/** A list in the sheet: a sidebar, or the hidden panels (null). */
type Where = Side | null
/** Where a drop would put it: before panel `before` (null: the end), the line at `y` in the list's box. */
type Drop = { before: string | null; y: number }

const byTitle = new Intl.Collator(undefined, { sensitivity: "base" })
const other = (side: Side): Side => (side === "left" ? "right" : "left")
const named = (side: Side) => (side === "left" ? "Left sidebar" : "Right sidebar")
/** A panel picked up here (not the sidebars' own kind: those take a panel dropped anywhere on them, behind the sheet). */
const carried = (item: DragItem) => (item.from === "row" && item.drawn && item.panel) || null

export function SidebarsSheet() {
  const { disabled, order } = usePrefs()
  const setup = useSidebars()
  const [query, setQuery] = useState("")
  const all = sidebarPanels(disabled, order)
  const lists = {
    left: panelsIn("left", setup, disabled, order),
    right: panelsIn("right", setup, disabled, order),
    hidden: all.filter((p) => !sideOf(p.key, setup)).sort((a, b) => byTitle.compare(a.panel.title, b.panel.title)),
  }
  const shows = (p: PanelOf) => !query || !!fuzzy(query, [p.panel.title, ...(p.panel.names ?? [])].join(" "))
  // Restored: the button undoes it until the panels move again (a toast's Undo would be under the sheet, out of reach).
  const [undo, setUndo] = useState<{ run: () => void; landed: boolean } | null>(null)
  const stock = defaultPanels(setup)
  useEffect(() => {
    if (undo && stock && !undo.landed) setUndo({ ...undo, landed: true })
    else if (undo?.landed && !stock) setUndo(null)
  }, [undo, stock])
  const restore = () => setUndo({ run: restoreSidebars(), landed: false })
  const root = useRef<HTMLDivElement>(null)
  return (
    <div ref={root} data-customize-sidebars>
      <SheetHead icon={SlidersHorizontal} tint="var(--primary)" title="Sidebars"
        sub="Drag panels to arrange them, between the sidebars, or down to hide them. Right-click one for more." />
      <FilterField value={query} onChange={setQuery} placeholder="Filter panels" className="mb-3" />
      <div className="grid grid-cols-2 gap-3">
        {(["left", "right"] as const).map((side) => (
          <PanelList key={side} where={side} title={named(side)} panels={lists[side]} shows={shows} filtered={!!query} />
        ))}
      </div>
      <PanelList where={null} title="Hidden" panels={lists.hidden} shows={shows} filtered={!!query} className="mt-4" />
      <div className="mt-4 flex justify-end">
        <button type="button" data-restore-sidebars disabled={!undo && stock} onClick={() => { if (undo) { undo.run(); setUndo(null) } else restore() }}
          className="h-8 cursor-pointer rounded-[7px] px-3 text-[14px] text-primary hover:bg-primary/10 disabled:cursor-default disabled:text-tertiary disabled:hover:bg-transparent">
          {undo ? "Undo restore" : "Restore defaults"}
        </button>
      </div>
      <Lifted within={root} />
    </div>
  )
}

/** A sidebar's panels in order, or the hidden ones by name; each takes panels dropped on it. */
function PanelList({ where, title, panels, shows, filtered, className }: {
  where: Where; title: string; panels: PanelOf[]; shows: (p: PanelOf) => boolean; filtered: boolean; className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const id = `customize:${where ?? "hidden"}`
  const hit = useListDrop(id, where, box)
  const seen = panels.filter(shows)
  return (
    <section aria-label={title} className={className}>
      <h3 className="mb-1 px-1 text-[13px] font-semibold text-muted-foreground">{title}</h3>
      <div ref={box} data-panel-list={where ?? "hidden"}
        className={cn("relative flex min-h-24 flex-col rounded-[10px] bg-foreground/[0.04] p-1 transition-colors", hit && !where && "bg-primary/10 ring-1 ring-primary/50")}>
        {seen.map((p) => <PanelRow key={p.key} p={p} where={where} list={panels} />)}
        {!seen.length && (
          <div className="grid flex-1 place-items-center px-3 py-4 text-center text-[13px] text-muted-foreground">
            {filtered ? "No panel matches" : where ? "Drag panels here" : "Every panel is in a sidebar"}
          </div>
        )}
        {hit && where && <div aria-hidden className="pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary" style={{ top: hit.y }} />}
      </div>
    </section>
  )
}

/** A list as a drop target: a sidebar puts the panel at the gap nearest the pointer, the hidden list hides it. */
function useListDrop(id: string, where: Where, box: RefObject<HTMLDivElement | null>) {
  useDropTarget<Drop>(id, (item, x, y) => {
    const key = carried(item), el = box.current
    if (!key || !el) return null
    const b = el.getBoundingClientRect()
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return null
    const from = sideOf(key)
    if (!where) return from ? { before: null, y: 0 } : null
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-row]")]
    if (!rows.length) return { before: null, y: 3 }
    const edges = [...rows.map((r) => r.getBoundingClientRect().top), rows[rows.length - 1].getBoundingClientRect().bottom]
    const i = edges.reduce((best, e, j) => (Math.abs(y - e) < Math.abs(y - edges[best]) ? j : best), 0)
    // Just above or below itself: it stays where it is.
    const mine = rows.findIndex((r) => r.dataset.row === key)
    if (from === where && mine >= 0 && (i === mine || i === mine + 1)) return null
    return { before: rows[i]?.dataset.row ?? null, y: Math.max(1, edges[i] - b.top - 1) }
  }, (item, h) => {
    const key = carried(item)!
    if (where) dockPanel(key, { side: where, before: h.before })
    else hidePanel(key)
  })
  return useDropHit<Drop>(id)
}

/** A panel: drag it, or its menu (right-click, a held finger, its … button) moves it without dragging. */
function PanelRow({ p, where, list }: { p: PanelOf; where: Where; list: PanelOf[] }) {
  const Icon = panelIcon(p)
  const d = useDrag()
  const menu = (): MenuItem[] => {
    if (!where) return (["left", "right"] as const).map((side) => ({
      label: `Show in ${named(side).toLowerCase()}`, icon: side === "left" ? PanelLeft : PanelRight, run: () => dockPanel(p.key, { side, before: null }),
    }))
    const i = list.findIndex((x) => x.key === p.key), there = other(where)
    return [
      ...(i > 0 ? [{ label: "Move up", icon: ArrowUp, run: () => dockPanel(p.key, { side: where, before: list[i - 1].key }) }] : []),
      ...(i < list.length - 1 ? [{ label: "Move down", icon: ArrowDown, run: () => dockPanel(p.key, { side: where, before: list[i + 2]?.key ?? null }) }] : []),
      { label: `Move to ${there} sidebar`, icon: there === "left" ? PanelLeft : PanelRight, sep: list.length > 1, run: () => dockPanel(p.key, { side: there, before: null }) },
      { label: "Hide", icon: EyeOff, run: () => hidePanel(p.key) },
    ]
  }
  return (
    <div data-row={p.key} onContextMenu={menuFor(menu)}
      onPointerDown={(e) => startDrag(e, { from: "row", panel: p.key, label: p.panel.title, drawn: true }, { touch: true })}
      className={cn("group/row flex h-11 shrink-0 cursor-grab items-center gap-3 rounded-[7px] pr-1 pl-2.5 text-[17px] select-none hover:bg-foreground/[0.05] md:h-8 md:gap-2 md:pl-2 md:text-[13px]",
        d && carried(d.item) === p.key && "opacity-40")}>
      <Icon className="size-5 shrink-0 text-muted-foreground md:size-4" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{p.panel.title}</span>
      <button type="button" data-no-drag aria-label={`More for ${p.panel.title}`} data-tip="More" onClick={rightClickBelow}
        className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground md:size-6 md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100">
        <Ellipsis className="size-4 md:size-3.5" strokeWidth={2.25} />
      </button>
    </div>
  )
}

/** The panel being dragged, under the pointer: drawn in the sheet's own layer (the app's drag picture is under it). */
function Lifted({ within }: { within: RefObject<HTMLDivElement | null> }) {
  const d = useDrag()
  const host = d && carried(d.item) ? within.current?.closest("dialog") : null
  if (!d || !host) return null
  const r = host.getBoundingClientRect()
  const hint = d.hit?.target === "customize:hidden" ? "Hide" : undefined
  return createPortal(
    <div aria-hidden className="glass-strong pointer-events-none absolute z-50 flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[13px] shadow-lg"
      style={{ left: d.x - r.left + 12, top: d.y - r.top + (d.finger ? -44 : 10) }}>
      {d.item.label}
      {hint && <span className="text-muted-foreground">{hint}</span>}
    </div>,
    host,
  )
}
