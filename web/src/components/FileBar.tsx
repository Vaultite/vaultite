// What plugins draw in a file's header (FileBarItem), in the user's order: dragged along the bar, or into a sidebar,
// where it's a panel drawn for the focused file (and dragged back); right-click moves one too.
import { useId, useMemo, useRef } from "react"
import { ArrowLeft, ArrowRight, PanelLeft, PanelRight } from "lucide-react"
import { menuFor, type MenuItem } from "@/components/ContextMenu"
import { status_, statusSubs } from "@/components/fileState"
import { Catch, Drawn } from "@/components/Guard"
import type { FileBarItem, FileHead, SidebarCtx } from "@/core/define"
import { getDrag, startDrag, useDrag, useDropHit, useDropTarget } from "@/core/drag"
import { dockAtEnd, fileBarItems, isBarItem, moveBarItem, setBarItemDrawer, sideOf, useSidebars, usePluginsVersion } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { cn } from "@/lib/utils"

/** Where a dropped item goes: before `before` (null: last); `x` its line, in the bar's px. */
type Gap = { before: string | null; x: number }

/** In the desktop path bar (`bar`), or at the end of the line above the title in a sheet or on a phone (`line`). */
export function FileBar({ head, place }: { head: FileHead; place: "bar" | "line" }) {
  const { disabled, order, enabled, fileBar } = usePrefs()
  const plugins = usePluginsVersion() // (a vault plugin's code arriving)
  const setup = useSidebars()
  const items = useMemo(() => fileBarItems(disabled, order, fileBar).filter((x) => !sideOf(x.key, setup)), [disabled, order, enabled, plugins, fileBar, setup])
  const ctx = useMemo(() => ({ ...head, place }), [head, place])
  const box = useRef<HTMLDivElement>(null)
  const target = `file-bar:${useId()}`
  const d = useDrag(), dragging = d?.item.from === "panel" && !!d.item.panel && isBarItem(d.item.panel)
  const hit = useDropHit<Gap>(target)
  useDropTarget<Gap>(target, (item, x, y) => {
    const key = item.from === "panel" ? item.panel : undefined, el = box.current
    if (!key || !el || !el.offsetParent || !isBarItem(key)) return null
    const b = el.getBoundingClientRect()
    if (x < b.left - 24 || x > b.right + 24 || y < b.top - 12 || y > b.bottom + 12) return null
    const slots = [...el.querySelectorAll<HTMLElement>(":scope > [data-file-bar-key]")].filter((s) => s.offsetWidth)
    const edges = [...slots.map((s) => s.getBoundingClientRect().left - 4), (slots.at(-1)?.getBoundingClientRect().right ?? b.left) + 4]
    const i = edges.reduce((best, e, j) => (Math.abs(x - e) < Math.abs(x - edges[best]) ? j : best), 0)
    // (its own place, in the bar: nothing to do)
    const mine = slots.findIndex((s) => s.dataset.fileBarKey === key)
    if (mine >= 0 && (i === mine || i === mine + 1)) return null
    return { before: slots[i]?.dataset.fileBarKey ?? null, x: edges[i] - b.left }
  }, (item, g) => moveBarItem(item.panel!, g.before), { hint: () => (sideOf(getDrag()?.item.panel ?? "") ? "To the top bar" : undefined) })
  const keys = items.map((x) => x.key)
  const menu = (key: string, i: number) => menuFor((): MenuItem[] => [
    ...(keys.length > 1 ? [
      { label: "Move left", icon: ArrowLeft, disabled: i === 0, run: () => moveBarItem(key, keys[i - 1]) },
      { label: "Move right", icon: ArrowRight, disabled: i === keys.length - 1, run: () => moveBarItem(key, keys[i + 2] ?? null) },
    ] : []),
    { label: "Move to right sidebar", icon: PanelRight, sep: keys.length > 1, run: () => dockAtEnd(key, "right") },
    { label: "Move to left sidebar", icon: PanelLeft, run: () => dockAtEnd(key, "left") },
  ])
  // (one that throws is left out, its error in Errors: it's in every file's header)
  return (
    <div ref={box} data-file-bar={place} className={cn("relative flex items-center empty:hidden", dragging && "min-h-6 min-w-6 empty:flex",
      // (a line's items are 44px targets, their room the gap between them)
      place === "bar" ? "shrink-0 gap-2" : "ml-auto min-w-0 flex-wrap justify-end md:gap-1")}>
      {items.map(({ key, plugin, item }, i) => (
        <span key={key} data-file-bar-key={key} onContextMenu={menu(key, i)} className={cn("flex shrink-0 items-center empty:hidden", d?.item.panel === key && "opacity-50")}
          onPointerDown={(e) => startDrag(e, { from: "panel", panel: key, label: item.title ?? plugin.name })}>
          <Catch reset={head.path} fallback={() => null}><Drawn draw={() => item.render(ctx)} /></Catch>
        </span>
      ))}
      {hit && <div aria-hidden className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" style={{ left: hit.x - 1 }} />}
    </div>
  )
}

/** A top bar item docked in a sidebar: drawn for the file in the focused tab, as in the bar (a size up on a phone). */
function Docked({ item, ctx }: { item: FileBarItem; ctx: SidebarCtx }) {
  const head = statusSubs.use(() => status_?.head ?? null)
  const place = ctx.phone ? "line" : "bar"
  const file = useMemo(() => (head ? { ...head, place } as const : null), [head, place])
  if (!ctx.open) return null
  if (!file) return <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">Open a file to see it.</p>
  return (
    <div data-docked-bar-item className="flex min-h-7 flex-wrap items-center gap-2 pl-1.5">
      <Catch reset={file.path} fallback={() => null}><Drawn draw={() => item.render(file)} /></Catch>
    </div>
  )
}
setBarItemDrawer((item, ctx) => <Docked item={item} ctx={ctx} />)
