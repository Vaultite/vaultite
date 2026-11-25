import { useEffect, useRef, useState } from "react"
import { Bot, Check, LayoutGrid, Plus } from "lucide-react"
import { cn, colorVar, commandKeys, menuFor, reorder as reorderKeys, slotAt, startDrag, useDropHit, useDropTarget, useSlide } from "@vaultite"
import { Mark as Look } from "./Mark"
import { NameField } from "./Name"
import { newCodeWorkspace } from "./preset"
import { moved } from "./order"
import { getRenaming, label, lookOf, markOf, renamed, reorder, showAllTabs, slotMenu, slots, SLOTS, switchTo } from "./state"
import { tintWash } from "./tint"

function Mark({ n, look }: { n: number; look: string }) {
  return <Look n={n} {...lookOf(n)} look={look} />
}
const markLook = (on: boolean) => cn("border", on ? "border-primary/60 bg-primary/10 font-semibold text-primary" : "border-border font-medium text-foreground")

function Rename({ n, on, end }: { n: number; on: boolean; end: (enter: boolean) => void }) {
  return (
    <div data-workspace={n} data-slide={n} style={tintWash(lookOf(n).tint, on)} className={cn("flex h-7 items-center gap-2 rounded-[5px] px-1.5", on && "bg-foreground/[0.08]")}>
      <Mark n={n} look={markLook(on)} />
      <NameField n={n} done={(name, key) => { renamed(n, name); if (key) end(key === "Enter") }} className="h-[22px] text-[13px]" />
    </div>
  )
}

type Order = { from: number; to: number; order: string[] }
const ORDER = "workspaces:order"
let droppedAt = 0
function useOrderDrop(rows: React.RefObject<HTMLDivElement | null>, done: (o: Order) => void) {
  useDropTarget<Order>(ORDER, (item, x, y) => {
    const el = rows.current
    if (!item.workspace || !el) return null
    const b = el.getBoundingClientRect()
    if (x < b.left - 40 || x > b.right + 40 || y < b.top - 28 || y > b.bottom + 28) return null
    const list = [...el.querySelectorAll<HTMLElement>(":scope > [data-slide]")]
    const { order, same } = reorderKeys(list.map((e) => e.dataset.slide!), [String(item.workspace)], slotAt(el, list, x, y, "y"))
    return same ? null : { from: item.workspace, to: order.indexOf(String(item.workspace)) + 1, order }
  }, (_item, h) => { droppedAt = Date.now(); done(h) }, { hint: (h) => `Make it ${h.to}` })
  return useDropHit<Order>(ORDER)?.order ?? null
}

export default function List({ lit, over, focus, close }: { lit: number; over: number | null; focus: boolean; close: () => void }) {
  const list = slots() ?? []
  const renaming = getRenaming()
  const rows = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Order | null>(null)
  useSlide(rows, useOrderDrop(rows, (o) => { setPending(o); void reorder(o.from, o.to)?.finally(() => setPending(null)) }), "y")
  useEffect(() => {
    if (focus && !getRenaming()) rows.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus({ preventScroll: true })
  }, [focus])
  const shown = (pending ? moved(SLOTS, pending.from, pending.to) : SLOTS).filter((m) => list[m - 1] || m === lit)
  const free = SLOTS.find((m) => !list[m - 1] && m !== lit)
  const go = (m: number) => { close(); switchTo(m) }
  const ended = (m: number, enter: boolean) => {
    if (enter) close()
    else requestAnimationFrame(() => rows.current?.querySelector<HTMLElement>(`button[data-workspace="${m}"]`)?.focus({ preventScroll: true }))
  }
  return (
    <>
      <button type="button" data-workspace-all onClick={() => { close(); showAllTabs() }} className={cn(ROW, "hover:bg-foreground/[0.07]")}>
        <LayoutGrid aria-hidden className="size-[18px] shrink-0 p-px text-muted-foreground" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">Workspaces</span>
        <span className="text-[11px] text-tertiary">{commandKeys("workspace:all-tabs")}</span>
      </button>
      <div className="mx-1 my-1 h-px bg-border" />
      <div ref={rows} className="relative flex flex-col gap-px">
        {shown.map((m) => (renaming === m
          ? <Rename key={m} n={m} on={m === lit} end={(enter) => ended(m, enter)} />
          : <Row key={m} m={m} on={m === lit} over={over === m} pick={() => go(m)} />))}
      </div>
      {free && <NewRow n={free} over={over === free} pick={() => go(free)} />}
      {free && (
        <button type="button" data-workspace-new-code onClick={() => { close(); newCodeWorkspace() }} className={cn(ROW, "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground")}>
          <Bot aria-hidden className="size-[18px] shrink-0 p-px" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">New Code workspace</span>
        </button>
      )}
    </>
  )
}

const ROW = "flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] transition-colors outline-none focus-visible:bg-foreground/[0.07]"
const dropLook = (over: boolean) => (over ? "bg-primary/15 ring-1 ring-primary/50" : "hover:bg-foreground/[0.07]")

function Row({ m, on, over, pick }: { m: number; on: boolean; over: boolean; pick: () => void }) {
  const { tint } = lookOf(m)
  return (
    <button type="button" data-workspace={m} data-slide={m} data-used data-drop={over || undefined} aria-pressed={on}
      data-tip={label(m)} data-tip-trunc data-tip-side="right"
      data-tint={tint} style={over ? undefined : tintWash(tint, on)}
      onPointerDown={(e) => startDrag(e, { from: "workspace", workspace: m, label: label(m) })}
      onClick={() => { if (Date.now() - droppedAt >= 400) pick() }}
      onContextMenu={menuFor(() => slotMenu(m))}
      className={cn(ROW, dropLook(over))}>
      <Mark n={m} look={markLook(on)} />
      <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")}>{label(m)}</span>
      <Marked n={m} />
      {on && <Check aria-hidden className="size-3.5 shrink-0 text-primary" strokeWidth={2.5} style={tint ? { color: colorVar(tint) } : undefined} />}
      <span className="text-[11px] text-tertiary">{commandKeys(`workspace:${m}`)}</span>
    </button>
  )
}

function NewRow({ n, over, pick }: { n: number; over: boolean; pick: () => void }) {
  return (
    <button type="button" data-workspace={n} data-workspace-new data-drop={over || undefined} aria-pressed={false} onClick={pick}
      className={cn(ROW, "mt-px text-muted-foreground hover:text-foreground", dropLook(over))}>
      <span className="grid size-[18px] shrink-0 place-items-center rounded-[4px] border border-dashed border-border"><Plus aria-hidden className="size-3" strokeWidth={2.25} /></span>
      <span className="min-w-0 flex-1 truncate">New workspace</span>
      <span className="text-[11px] text-tertiary">{commandKeys(`workspace:${n}`)}</span>
    </button>
  )
}

function Marked({ n }: { n: number }) {
  const m = markOf(n)
  if (!m) return null
  const Icon = m.icon
  return <Icon aria-label={m.label} data-workspace-mark className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} style={m.tint ? { color: m.tint } : undefined} />
}
