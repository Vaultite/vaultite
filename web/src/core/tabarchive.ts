// Archived tabs: unpinned tabs unseen a while, closed into a list kept with the tabs (the workspace's, or this device's
// without Workspaces), to reopen or find again. Not history: the tabs the user had. The rest is Tabs' (archived.tsx).
import { useSyncExternalStore } from "react"
import { newId, type Tab } from "../../../core/layout.ts"
import { scopedState, subscribeScoped } from "@/core/scope"
import { archivesAfter, canReopenTab, closeToArchive, findOpen, groups, lastClosedAt, reopenTab, restoreTab, selectTab, unseenTabs } from "@/core/workspace"

/** An archived tab: what it showed and was called, where it was (its pane, its place there, its tab group), and when it
 *  was archived. Its history stays behind, as it does in the workspace's file. */
export type ArchivedTab = { id: string; to: string; title: string; group: string; at: number; set?: string; archived: number }

const MAX = 200
const kept = scopedState<unknown>("core:archived-tabs", [], "workspace")
const ok = (e: unknown): e is ArchivedTab => !!e && typeof e === "object" && typeof (e as ArchivedTab).id === "string" && typeof (e as ArchivedTab).to === "string"
  && typeof (e as ArchivedTab).archived === "number"
const NONE: ArchivedTab[] = []
let raw: unknown, list = NONE
/** The archived tabs, the latest first. */
export function archivedTabs(): ArchivedTab[] {
  const v = kept.get()
  if (v !== raw) { raw = v; list = Array.isArray(v) ? v.filter(ok) : NONE }
  return list
}
export const useArchivedTabs = () => useSyncExternalStore(subscribeScoped, archivedTabs)
/** Its list as written: the same place once, the latest kept. */
const save = (next: ArchivedTab[]) => kept.set(next.filter((e, i) => next.findIndex((x) => x.to === e.to) === i).slice(0, MAX))

/** Archive the tabs unseen for longer than the setting says (none while it's Never), named by `title` as their tab is.
 *  The same on every device (it goes by the stamps the tabs carry), so two devices archiving at once agree. */
export function archiveUnseen(title: (t: Tab) => string): ArchivedTab[] {
  const after = archivesAfter()
  const due = after ? unseenTabs(Date.now() - after) : []
  if (!due.length) return []
  const names = new Map(due.map((t) => [t.id, title(t)]))
  const now = Date.now()
  const gone = closeToArchive(due.map((t) => t.id)).map(({ tab, group, at }): ArchivedTab =>
    ({ id: tab.id, to: tab.to, title: names.get(tab.id) ?? "", group, at, ...(tab.set ? { set: tab.set } : {}), archived: now }))
  save([...gone, ...archivedTabs()])
  return gone
}

/** Reopen an archived tab where it was (it leaves the list), shown or (`shown` false) behind the tab on screen; one
 *  open again meanwhile is shown instead. */
export function reopenArchived(id: string, shown = true) {
  const e = archivedTabs().find((x) => x.id === id)
  if (!e) return
  removeArchived([id])
  const open = findOpen(e.to)
  if (open) { if (shown) selectTab(open.t.id); return }
  // (its id taken meanwhile, on this device or another: a new one)
  const taken = groups().some((g) => g.tabs.some((t) => t.id === e.id))
  restoreTab({ tab: { id: taken ? newId() : e.id, to: e.to, ...(e.set ? { set: e.set } : {}) }, group: e.group, at: e.at }, shown)
}

/** ⌘⇧T: the tab closed last or archived since, whichever was later (skipping `gone` ones), till both lists are empty. */
export function reopenLatest(gone: (to: string) => boolean) {
  let a = archivedTabs()[0]
  while (a && gone(a.to)) { removeArchived([a.id]); a = archivedTabs()[0] }
  if (a && a.archived > lastClosedAt()) reopenArchived(a.id)
  else reopenTab(gone)
}
export const canReopen = () => canReopenTab() || archivedTabs().length > 0

export function removeArchived(ids: string[]) {
  const drop = new Set(ids), cur = archivedTabs()
  if (cur.some((e) => drop.has(e.id))) save(cur.filter((e) => !drop.has(e.id)))
}
/** Put archived tabs back in the list (Undo of a removal). */
export function restoreArchived(entries: ArchivedTab[]) {
  save([...entries, ...archivedTabs()].sort((a, b) => b.archived - a.archived))
}

/** A file was renamed or moved (or a folder with it): its archived tabs follow (Tabs' `onMove`). */
export function retargetArchived(from: string, to: string) {
  const map = (t: string) => (t === `file:${from}` ? `file:${to}` : t.startsWith(`file:${from}/`) ? `file:${to}${t.slice(from.length + 5)}` : t)
  const cur = archivedTabs()
  if (cur.some((e) => map(e.to) !== e.to)) save(cur.map((e) => ({ ...e, to: map(e.to) })))
}
