// Archived tabs: unpinned tabs unseen a while, closed into a list kept with the tabs (the workspace's, or this device's
// without Workspaces), to reopen or find again. Not history: the tabs the user had. The rest is Tabs' (archived.tsx).
import { useSyncExternalStore } from "react"
import { clean, focusedPane, newPaneId, newTabId, mapPlaces, placesIn, tabOf, type Tab } from "../../../core/layout.ts"
import { scopedState, subscribeScoped } from "@/core/scope"
import { archivesAfter, archivingDue, canReopenTab, closeToArchive, findOpen, lastClosedAt, paneById, reopenTab, restoreTab, selectPane, tabById, unseenTabs } from "@/core/workspace"

/** An archived tab: its panes (`tab`), what its focused pane showed (`to`) and what it was called, its place in the
 *  list, and when it was archived. Its panes' history stays behind, as it does in the workspace's file. */
export type ArchivedTab = { id: string; to: string; title: string; at: number; tab: Tab; archived: number }

const MAX = 200
const kept = scopedState<unknown>("core:archived-tabs", [], "workspace")
/** An entry as kept, checked; one from before tabs held panes (`{id, to, set}`) becomes a tab of one pane. */
function okEntry(e: unknown): ArchivedTab[] {
  const x = e as Partial<ArchivedTab> & { set?: string } | null
  if (!x || typeof x !== "object" || typeof x.id !== "string" || typeof x.to !== "string" || typeof x.archived !== "number") return []
  const at = typeof x.at === "number" ? x.at : 0, title = typeof x.title === "string" ? x.title : ""
  const tab = x.tab ? clean({ tabs: [x.tab], active: x.tab.id })?.tabs[0] : { ...tabOf(x.to, { id: `t${x.id}`, pane: x.id }), ...(x.set ? { group: x.set } : {}) }
  return tab ? [{ id: tab.id, to: focusedPane(tab).to, title, at, tab, archived: x.archived }] : []
}
const NONE: ArchivedTab[] = []
let raw: unknown, list = NONE
/** The archived tabs, the latest first. */
export function archivedTabs(): ArchivedTab[] {
  const v = kept.get()
  if (v !== raw) { raw = v; list = Array.isArray(v) ? v.flatMap(okEntry) : NONE }
  return list
}
export const useArchivedTabs = () => useSyncExternalStore(subscribeScoped, archivedTabs)
/** Its list as written: the same place once, the latest kept. */
const save = (next: ArchivedTab[]) => kept.set(next.filter((e, i) => next.findIndex((x) => x.to === e.to) === i).slice(0, MAX))

/** Archive the tabs unseen for longer than the setting says (none while it's Never), named by `title` as their tab is.
 *  The same on every device (it goes by the stamps the tabs carry), so two devices archiving at once agree. */
export function archiveUnseen(title: (t: Tab) => string): ArchivedTab[] {
  const after = archivesAfter()
  const due = archivingDue() ? unseenTabs(Date.now() - after) : []
  if (!due.length) return []
  const names = new Map(due.map((t) => [t.id, title(t)]))
  const now = Date.now()
  const gone = closeToArchive(due.map((t) => t.id)).map(({ tab, at }): ArchivedTab =>
    ({ id: tab.id, to: focusedPane(tab).to, title: names.get(tab.id) ?? "", at, tab, archived: now }))
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
  if (open) { if (shown) selectPane(open.p.id); return }
  // (its ids taken meanwhile, on this device or another: new ones)
  const taken = !!tabById(e.tab.id) || placesIn(e.tab).some((p) => paneById(p.id))
  const ids = new Map(placesIn(e.tab).map((p) => [p.id, taken ? newPaneId() : p.id]))
  const tab = taken ? { ...e.tab, id: newTabId(), root: mapPlaces(e.tab.root, (p) => ({ ...p, id: ids.get(p.id)! })), focus: ids.get(e.tab.focus) ?? e.tab.focus } : e.tab
  restoreTab({ tab, at: e.at }, shown)
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
  if (cur.some((e) => placesIn(e.tab).some((p) => map(p.to) !== p.to))) save(cur.map((e) => ({ ...e, to: map(e.to), tab: { ...e.tab, root: mapPlaces(e.tab.root, (p) => ({ ...p, to: map(p.to) })) } })))
}
