import { useId, useMemo, useRef } from "react"
import { ArrowLeft, ArrowRight, EyeOff, PanelLeft, PanelRight } from "lucide-react"
import { menuFor, type MenuItem } from "@/components/ContextMenu"
import { status_, statusSubs } from "@/components/fileState"
import { Catch, Drawn } from "@/components/Guard"
import type { FileBarItem, FileHead, SidebarCtx } from "@/core/define"
import { getDrag, startDrag, useDragItem, useDropHit, useDropTarget } from "@/core/drag"
import { dockAtEnd, fileBarItems, hideBarItem, isBarItem, moveBarItem, setBarItemDrawer, sideOf, useSidebars, usePluginsVersion } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { cn } from "@/lib/utils"
import { INCOMING, reorder, slotAt, useSlide } from "@/core/slide"

type Gap = { before: string | null; order: string[] }

export function FileBar({ head, place }: { head: FileHead; place: "bar" | "line" }) {
  const { disabled, enabled, fileBar, fileBarHidden } = usePrefs()
  const plugins = usePluginsVersion()
  const setup = useSidebars()
  const items = useMemo(() => fileBarItems(disabled, fileBar).filter((x) => !sideOf(x.key, setup) && !fileBarHidden.includes(x.key)), [disabled, enabled, plugins, fileBar, fileBarHidden, setup])
  const ctx = useMemo(() => ({ ...head, place }), [head, place])
  const box = useRef<HTMLDivElement>(null)
  const target = `file-bar:${useId()}`
  const lifted = useDragItem(), dragging = lifted?.from === "panel" && !!lifted.panel && isBarItem(lifted.panel)
  const coming = dragging && !items.some((x) => x.key === lifted.panel)
  const hit = useDropHit<Gap>(target)
  useDropTarget<Gap>(target, (item, x, y) => {
    const key = item.from === "panel" ? item.panel : undefined, el = box.current
    if (!key || !el || !el.offsetParent || !isBarItem(key)) return null
    const b = el.getBoundingClientRect()
    if (x < b.left - 24 || x > b.right + 24 || y < b.top - 12 || y > b.bottom + 12) return null
    const slots = [...el.querySelectorAll<HTMLElement>(":scope > [data-file-bar-key]")].filter((s) => s.offsetWidth)
    const { order, before, same } = reorder(slots.map((s) => s.dataset.fileBarKey!), [key], slotAt(el, slots, x, y, place === "bar" ? "x" : "wrap"))
    return same ? null : { before, order }
  }, (item, g) => moveBarItem(item.panel!, g.before), { hint: () => (sideOf(getDrag()?.item.panel ?? "") ? "To the top bar" : undefined) })
  useSlide(box, hit?.order ?? null, place === "bar" ? "x" : "wrap")
  const keys = items.map((x) => x.key)
  const rows = (key: string, i: number, title: string): MenuItem[] => [
    ...(keys.length > 1 ? [
      { label: "Move left", icon: ArrowLeft, disabled: i === 0, run: () => moveBarItem(key, keys[i - 1]) },
      { label: "Move right", icon: ArrowRight, disabled: i === keys.length - 1, run: () => moveBarItem(key, keys[i + 2] ?? null) },
    ] : []),
    { label: "Move to right sidebar", icon: PanelRight, sep: keys.length > 1, run: () => dockAtEnd(key, "right") },
    { label: "Move to left sidebar", icon: PanelLeft, run: () => dockAtEnd(key, "left") },
    { label: `Hide ${title}`, icon: EyeOff, sep: true, run: () => hideBarItem(key) },
  ]
  return (
    <div ref={box} data-file-bar={place} className={cn("relative flex items-center empty:hidden", dragging && "min-h-6 min-w-6 empty:flex",
      place === "bar" ? "shrink-0 gap-2" : "ml-auto min-w-0 flex-wrap justify-end md:gap-1")}>
      {items.map(({ key, plugin, item }, i) => (
        <span key={key} data-file-bar-key={key} data-slide={key} onContextMenu={menuFor(() => rows(key, i, item.title ?? plugin.name))} className={cn("flex shrink-0 items-center empty:hidden", lifted?.panel === key && "opacity-50")}
          onPointerDown={(e) => startDrag(e, { from: "panel", panel: key, label: item.title ?? plugin.name })}>
          <Catch reset={head.path} fallback={() => null}><Drawn draw={() => item.render({ ...ctx, menu: () => rows(key, i, item.title ?? plugin.name) })} /></Catch>
        </span>
      ))}
      {coming && <span aria-hidden data-slide={hit?.order.includes(INCOMING) ? INCOMING : undefined} className="h-6 w-6 shrink-0" />}
    </div>
  )
}

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
