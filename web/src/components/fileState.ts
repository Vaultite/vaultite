import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react"
import type { Store } from "@/core/data"
import { BookOpen, Code2, Pencil, type LucideIcon } from "lucide-react"
import type { MenuItem } from "@/components/ContextMenu"
import type { FileHead } from "@/core/define"
import { editorSettings, useEditorSettings, type EditingMode } from "@/core/editorPrefs"
import { isDesktop } from "@/core/platform"
import { usePane } from "@/core/pane"
import { signal } from "@/core/signal"
import { isObj } from "../../../core/values.ts"

export type Mode = "read" | "live" | "source"
type TabView = { mode: Mode; edit: EditingMode }
const TABS_KEY = "vaultite.tabViews"
const TABS_KEPT = 100
const stored = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
try { for (const k of ["vaultite.fileMode", "vaultite.editMode", "vaultite.tabModes"]) localStorage.removeItem(k) } catch {}
const isMode = (v: unknown): v is Mode => v === "read" || v === "live" || v === "source"
const isEdit = (v: unknown): v is EditingMode => v === "live" || v === "source"
export const opensReading = () => (editorSettings().defaultView ?? (isDesktop() ? "editing" : "reading")) === "reading"
const fresh = (): TabView => {
  const edit = editorSettings().editingMode
  return { mode: opensReading() ? "read" : edit, edit }
}
function storedTabs() {
  const out = new Map<string, TabView>()
  try {
    const all: unknown = JSON.parse(stored(TABS_KEY) ?? "{}")
    for (const [k, v] of Object.entries(isObj(all) ? all : {}))
      if (isObj(v) && isMode(v.mode) && isEdit(v.edit)) out.set(k, { mode: v.mode, edit: v.edit })
  } catch {}
  return out
}
let tabs_: Map<string, TabView> | null = null
const tabs = () => (tabs_ ??= storedTabs())
const modeSubs = new Set<() => void>()
export const beforeMode = new Set<(m: Mode, tab: string) => void>()
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
  try { localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries([...t].slice(-TABS_KEPT)))) } catch {}
  for (const f of modeSubs) f()
}
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
export function useMode(own?: string): [Mode, (m: Mode) => void, string, EditingMode] {
  const { pane, tab: inTab } = usePane()
  const tab = own ?? (pane || inTab || "")
  useEditorSettings()
  const set = useCallback((m: Mode) => setMode(tab, m), [tab])
  const v = useSyncExternalStore(subscribeMode, () => viewOf(tab))
  return [v.mode, set, tab, v.edit]
}
type DrawFile = (store: Store, path: string, docked?: string) => ReactNode
let fileView: DrawFile | null = null
export const setFileView = (fn: DrawFile) => { fileView = fn }
export const drawFileView: DrawFile = (store, path, docked) => fileView?.(store, path, docked) ?? null

export const VIEWS: { value: Mode; label: string }[] = [
  { value: "read", label: "Reading view" }, { value: "live", label: "Live preview" }, { value: "source", label: "Source mode" },
]
export const SOURCE_VIEWS = VIEWS.filter((v) => v.value !== "live")
export const CODE_VIEWS = VIEWS.filter((v) => v.value === "source")
export const MODES: Record<Mode, { label: string; icon: LucideIcon }> = {
  read: { label: "reading", icon: BookOpen },
  live: { label: "editing", icon: Pencil },
  source: { label: "source", icon: Code2 },
}
export const viewItems = (views: typeof VIEWS, mode: Mode, setMode: (m: Mode) => void): MenuItem[] =>
  views.map((v) => ({ label: v.label, icon: MODES[v.value].icon, checked: v.value === mode, run: () => setMode(v.value) }))

type Status_ = { path: string; mode: Mode; setMode: (m: Mode) => void; body: string; views: typeof VIEWS
  fm?: string; head?: FileHead
  info?: string[]
  says?: (text: string) => string | null
  pane?: string } | null
export let status_: Status_ = null
export const statusSubs = signal()
function publish(s: Status_) { status_ = s; statusSubs.notify() }
export const paneStatus = new Map<string, NonNullable<Status_>>()
export const paneStatusSubs = signal()
function setPane(pane: string, s: Status_) {
  if (s) paneStatus.set(pane, s)
  else paneStatus.delete(pane)
  paneStatusSubs.notify()
}
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
  }, [live, shown, group, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps -- the caller passes what make reads
  useEffect(() => { if (hidden && mine.current && status_ === mine.current) publish(null) }, [hidden])
  useEffect(() => { if (!shown && mine.current && paneStatus.get(group) === mine.current) setPane(group, null) }, [shown, group])
  useEffect(() => () => {
    if (!mine.current) return
    if (status_ === mine.current) publish(null)
    if (paneStatus.get(group) === mine.current) setPane(group, null)
  }, [group])
  return useCallback(() => {
    const was = mine.current
    if (!was || (status_ !== was && paneStatus.get(group) !== was)) return
    mine.current = { ...latest.current(), pane: group }
    if (status_ === was) publish(mine.current)
    if (paneStatus.get(group) === was) setPane(group, mine.current)
  }, [group])
}
