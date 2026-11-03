// What file views share: the view (reading, live preview or source), each tab its own as in Obsidian from Settings'
// defaults (editor.json), so ⌘E switches only the tab in front (beforeMode); and what the status bar shows (usePublish).
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { BookOpen, Code2, Pencil, type LucideIcon } from "lucide-react"
import type { MenuItem } from "@/components/ContextMenu"
import type { FileHead } from "@/core/define"
import { editorSettings, useEditorSettings, type EditingMode } from "@/core/editorPrefs"
import { isDesktop } from "@/core/platform"
import { usePane } from "@/core/pane"
import { signal } from "@/core/signal"

export type Mode = "read" | "live" | "source"
/** A tab's view and the editing view ⌘E takes it back to from reading. */
type TabView = { mode: Mode; edit: EditingMode }
/** Each tab's, by tab id ("" outside tabs: a sheet), the last ones picked (TABS_KEPT). */
const TABS_KEY = "vaultite.tabViews"
const TABS_KEPT = 100
const stored = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
// (the views before Settings had defaults: the last one picked on this device, which new tabs took)
try { for (const k of ["vaultite.fileMode", "vaultite.editMode", "vaultite.tabModes"]) localStorage.removeItem(k) } catch { /* private mode */ }
const isMode = (v: unknown): v is Mode => v === "read" || v === "live" || v === "source"
const isEdit = (v: unknown): v is EditingMode => v === "live" || v === "source"
/** Whether a new tab opens a note in reading, by Settings (unset: on phones). */
export const opensReading = () => (editorSettings().defaultView ?? (isDesktop() ? "editing" : "reading")) === "reading"
const fresh = (): TabView => {
  const edit = editorSettings().editingMode
  return { mode: opensReading() ? "read" : edit, edit }
}
function storedTabs() {
  const out = new Map<string, TabView>()
  try {
    for (const [k, v] of Object.entries(JSON.parse(stored(TABS_KEY) ?? "{}") as Record<string, Partial<TabView>>))
      if (isMode(v?.mode) && isEdit(v.edit)) out.set(k, { mode: v.mode, edit: v.edit })
  } catch { /* hand-broken: none */ }
  return out
}
let tabs_: Map<string, TabView> | null = null
const tabs = () => (tabs_ ??= storedTabs())
const modeSubs = new Set<() => void>()
/** Called with a tab's next view before it draws it (its file notes where its reader is). */
export const beforeMode = new Set<(m: Mode, tab: string) => void>()
/** A tab's view: one picked in it, else Settings' defaults as it first showed, from then on its own. */
function viewOf(tab: string): TabView {
  let v = tabs().get(tab)
  if (!v) { v = fresh(); tabs().set(tab, v) }
  return v
}
function setMode(tab: string, m: Mode) {
  const was = viewOf(tab)
  if (m === was.mode) return
  for (const f of beforeMode) f(m, tab)
  const t = tabs()
  t.delete(tab)
  t.set(tab, { mode: m, edit: m === "read" ? was.edit : m })
  try { localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries([...t].slice(-TABS_KEPT)))) } catch { /* private mode */ }
  for (const f of modeSubs) f()
}
/** Another window on this device switched a tab's (one of the same workspace). */
const otherWindow = (e: StorageEvent) => {
  if (e.key !== TABS_KEY) return
  const next = storedTabs()
  for (const [tab, v] of next) {
    const was = tabs().get(tab)
    if (was?.mode === v.mode && was.edit === v.edit) continue
    if (was?.mode !== v.mode) for (const f of beforeMode) f(v.mode, tab)
    tabs().set(tab, v)
  }
  for (const f of modeSubs) f()
}
function subscribeMode(f: () => void) {
  modeSubs.add(f)
  if (modeSubs.size === 1) addEventListener("storage", otherWindow)
  return () => { modeSubs.delete(f); if (!modeSubs.size) removeEventListener("storage", otherWindow) }
}
/** The view of the tab this is drawn in, how to change it (that tab's only), its id, and the editing view it goes back
 *  to from reading. */
export function useMode(): [Mode, (m: Mode) => void, string, EditingMode] {
  const tab = usePane().tab ?? ""
  useEditorSettings() // (a tab not shown yet opens in the defaults as they are then)
  const set = useCallback((m: Mode) => setMode(tab, m), [tab])
  const v = useSyncExternalStore(subscribeMode, () => viewOf(tab))
  return [v.mode, set, tab, v.edit]
}
export const VIEWS: { value: Mode; label: string }[] = [
  { value: "read", label: "Reading view" }, { value: "live", label: "Live preview" }, { value: "source", label: "Source mode" },
]
/** Files whose editing is their source (artifacts, tables, notebooks): no live preview. */
export const SOURCE_VIEWS = VIEWS.filter((v) => v.value !== "live")
/** Code and plain text: only their source. */
export const CODE_VIEWS = VIEWS.filter((v) => v.value === "source")
export const MODES: Record<Mode, { label: string; icon: LucideIcon }> = {
  read: { label: "reading", icon: BookOpen },
  live: { label: "editing", icon: Pencil },
  source: { label: "source", icon: Code2 },
}
/** A file's views as menu rows, each with its icon and the current one checked (at the row's end, with the icons): the
 *  status bar's view and the view button's right-click (a hold on phones). */
export const viewItems = (views: typeof VIEWS, mode: Mode, setMode: (m: Mode) => void): MenuItem[] =>
  views.map((v) => ({ label: v.label, icon: MODES[v.value].icon, checked: v.value === mode, run: () => setMode(v.value) }))

type Status_ = { path: string; mode: Mode; setMode: (m: Mode) => void; body: string; views: typeof VIEWS
  /** Its frontmatter (the block, as in the file) and what plugins' items get (StatusItem); none: not text (an image). */
  fm?: string; head?: FileHead
  /** What a viewer says instead of counts (size, dimensions, pages). */
  info?: string[]
  /** What a drawn file says instead of counts (a table's rows: FileFormat.status). */
  says?: (text: string) => string | null
  /** The pane it's in. */
  pane?: string } | null
export let status_: Status_ = null
export const statusSubs = signal()
function publish(s: Status_) { status_ = s; statusSubs.notify() }
/** Each pane's file (its shown tab's; stacked, its active one's), by the pane: what the status bar says under a pane
 *  that isn't focused. The focused pane's is status_ too. */
export const paneStatus = new Map<string, NonNullable<Status_>>()
export const paneStatusSubs = signal()
function setPane(pane: string, s: Status_) {
  if (s) paneStatus.set(pane, s)
  else paneStatus.delete(pane)
  paneStatusSubs.notify()
}
/** The status bar for the file in a pane's tab (`pane`: not a sheet): status_ while focused, its pane's while shown;
 *  each taken down when the file goes or its tab is hidden, unless another file's has replaced it meanwhile. */
export function usePublish(pane: boolean, make: () => NonNullable<Status_>, deps: unknown[]) {
  const mine = useRef<Status_>(null)
  const latest = useRef(make)
  latest.current = make
  const { pane: group, focused, hidden } = usePane()
  const live = pane && focused, shown = pane && !hidden && !!group
  useEffect(() => {
    if (!live && !shown) return
    mine.current = { ...make(), pane: group }
    if (live) publish(mine.current)
    if (shown) setPane(group, mine.current)
  }, [live, shown, group, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hidden && mine.current && status_ === mine.current) publish(null) }, [hidden])
  useEffect(() => { if (!shown && mine.current && paneStatus.get(group) === mine.current) setPane(group, null) }, [shown, group])
  useEffect(() => () => {
    if (!mine.current) return
    if (status_ === mine.current) publish(null)
    if (paneStatus.get(group) === mine.current) setPane(group, null)
  }, [group])
  // Published again from what `make` reads now (typing: the file's text, without drawing the file again).
  return useCallback(() => {
    const was = mine.current
    if (!was || (status_ !== was && paneStatus.get(group) !== was)) return
    mine.current = { ...latest.current(), pane: group }
    if (status_ === was) publish(mine.current)
    if (paneStatus.get(group) === was) setPane(group, mine.current)
  }, [group])
}
