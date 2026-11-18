import { useId } from "react"
import { canDropTab, dropTab, tabListDrop, tabPreview, tabSlot, useDropHit, useDropTarget, type DragItem, type TabList } from "@vaultite"
import { reorderIn } from "./elsewhere"
import { current, moveAt, named, type Sent } from "./state"

type Moving = Exclude<Sent, { open: string[] }>
type Source = { from: number; what: Moving }
export type AllDrop = Source & { n: number; index: number; group: string | null; home: boolean }
type ListOf = (n: number) => TabList

function sourceOf(item: DragItem): Source | null {
  const a = item.away
  if (a) return a.group ? { from: a.workspace, what: { group: a.group } } : a.tab ? { from: a.workspace, what: { tab: a.tab } } : null
  if (item.group) return { from: current(), what: { group: item.group } }
  if (item.pane) return { from: current(), what: { pane: item.pane } }
  return item.tab ? { from: current(), what: { tab: item.tab } } : null
}
const stand = (what: Moving): DragItem => ("group" in what ? { from: "group", group: what.group } : "tab" in what ? { from: "tab", tab: what.tab } : { from: "pane" })
const same = (l: TabList, order: { id: string; group?: string }[]) => order.every((t, i) => l.tabs[i]?.id === t.id && l.tabs[i]?.group === t.group)

export const previewOf = (l: TabList, d: AllDrop) => tabPreview(l, stand(d.what), { kind: "list", index: d.index, group: d.group })

function landing(item: DragItem, src: Source, card: HTMLElement, l: TabList, y: number): AllDrop | null {
  const n = Number(card.dataset.allTabsWorkspace)
  const rows = [...card.querySelectorAll<HTMLElement>("[data-all-tabs-window='0'] :is([data-all-tabs-tab], [data-group-row])")]
  const at = tabSlot(l, rows.map((e) => ({ el: e, tab: e.dataset.allTabsTab, group: e.dataset.groupRow })), y, "y")
  const d = { n, index: at.index, group: "group" in src.what ? null : at.group, ...src, home: false }
  if (src.from !== n) return "tab" in src.what && (item.tabs?.length ?? 0) > 1 ? null : d
  if (n === current()) { const t = tabListDrop(item, { kind: "list", index: d.index, group: d.group }); return t ? { ...d, home: t.kind === "list" && !!t.home } : null }
  const p = previewOf(l, d)
  return { ...d, home: !p || same(l, p.tabs) }
}

function land(item: DragItem, d: AllDrop, l: TabList) {
  if (d.home) return
  if (d.from !== d.n) { void moveAt(d.from, d.n, d.what, { at: d.index, into: d.group ?? undefined }); return }
  if (d.n === current()) { const t = tabListDrop(item, { kind: "list", index: d.index, group: d.group }); if (t && canDropTab(item, t)) dropTab(item, t); return }
  const p = previewOf(l, d)
  if (p) reorderIn(d.n, p.tabs)
}

export function useAllDrops(listOf: ListOf) {
  const target = `all-tabs:${useId()}`
  useDropTarget<AllDrop>(target, (item, _x, y, el) => {
    const src = sourceOf(item), card = el?.closest<HTMLElement>("[data-all-tabs-workspace]")
    if (!src || !card || el?.closest("[data-all-tabs-window]:not([data-all-tabs-window='0'])")) return null
    return landing(item, src, card, listOf(Number(card.dataset.allTabsWorkspace)), y)
  }, (item, d) => land(item, d, listOf(d.n)), { stay: (d) => d.home, hint: (d) => (d.from !== d.n ? `Move to ${named(d.n)}` : undefined) })
  return useDropHit<AllDrop>(target)
}
