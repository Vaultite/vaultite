// What file views share: the view (reading, live preview or source), each tab its own as in Obsidian, so ⌘E switches
// only the tab in front (keeping its place: beforeMode); and what the status bar shows (usePublish).
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import { BookOpen, Code2, Pencil, type LucideIcon } from "lucide-react"
import type { FileHead } from "@/core/define"
import { isDesktop } from "@/core/workspace"
import { usePane } from "@/core/pane"
import { signal } from "@/core/signal"

export type Mode = "read" | "live" | "source"
/** The view last picked, which a tab takes until one is picked in it. */
const MODE_KEY = "vaultite.fileMode"
const EDIT_KEY = "vaultite.editMode"
/** Each tab's view, by tab id ("" outside tabs: a sheet), the last ones picked (TABS_KEPT). */
const TABS_KEY = "vaultite.tabModes"
const TABS_KEPT = 100
const stored = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const isMode = (v: unknown): v is Mode => v === "read" || v === "live" || v === "source"
const storedMode = (): Mode => {
  const v = stored(MODE_KEY)
  return isMode(v) ? v : isDesktop() ? "live" : "read"
}
function storedTabs() {
  const out = new Map<string, Mode>()
  try { for (const [k, v] of Object.entries(JSON.parse(stored(TABS_KEY) ?? "{}"))) if (isMode(v)) out.set(k, v) } catch { /* hand-broken: none */ }
  return out
}
let last_: Mode | null = null
let tabs_: Map<string, Mode> | null = null
const tabs = () => (tabs_ ??= storedTabs())
const modeSubs = new Set<() => void>()
/** Called with a tab's next view before it draws it (its file notes where its reader is). */
export const beforeMode = new Set<(m: Mode, tab: string) => void>()
/** A tab's view: one picked in it, else the last one picked anywhere, from then on its own. */
function modeOf(tab: string): Mode {
  let m = tabs().get(tab)
  if (!m) { m = (last_ ??= storedMode()); tabs().set(tab, m) }
  return m
}
function setMode(tab: string, m: Mode) {
  if (m === modeOf(tab)) return
  for (const f of beforeMode) f(m, tab)
  const t = tabs()
  t.delete(tab)
  t.set(tab, m)
  last_ = m
  try {
    localStorage.setItem(MODE_KEY, m)
    if (m !== "read") localStorage.setItem(EDIT_KEY, m)
    localStorage.setItem(TABS_KEY, JSON.stringify(Object.fromEntries([...t].slice(-TABS_KEPT))))
  } catch { /* private mode */ }
  for (const f of modeSubs) f()
}
/** Another window on this device switched a tab's (one of the same workspace). */
const otherWindow = (e: StorageEvent) => {
  if (e.key !== TABS_KEY) return
  const next = storedTabs()
  for (const [tab, m] of next) if (tabs().get(tab) !== m) { for (const f of beforeMode) f(m, tab); tabs().set(tab, m) }
  for (const f of modeSubs) f()
}
function subscribeMode(f: () => void) {
  modeSubs.add(f)
  if (modeSubs.size === 1) addEventListener("storage", otherWindow)
  return () => { modeSubs.delete(f); if (!modeSubs.size) removeEventListener("storage", otherWindow) }
}
/** The view of the tab this is drawn in, and how to change it (that tab's only). */
export function useMode(): [Mode, (m: Mode) => void, string] {
  const tab = usePane().tab ?? ""
  const set = useCallback((m: Mode) => setMode(tab, m), [tab])
  return [useSyncExternalStore(subscribeMode, () => modeOf(tab)), set, tab]
}
export const VIEWS: { value: Mode; label: string }[] = [
  { value: "read", label: "Reading view" }, { value: "live", label: "Live preview" }, { value: "source", label: "Source mode" },
]
/** Files whose editing is their source (artifacts, tables, notebooks): no live preview. */
export const SOURCE_VIEWS = VIEWS.filter((v) => v.value !== "live")
/** Code and plain text: only their source. */
export const CODE_VIEWS = VIEWS.filter((v) => v.value === "source")
/** The editing view to go back to from reading. */
export const editMode = (): Mode => (stored(EDIT_KEY) === "source" ? "source" : "live")
export const MODES: Record<Mode, { label: string; icon: LucideIcon }> = {
  read: { label: "reading", icon: BookOpen },
  live: { label: "editing", icon: Pencil },
  source: { label: "source", icon: Code2 },
}

type Status_ = { path: string; mode: Mode; setMode: (m: Mode) => void; body: string; views: typeof VIEWS
  /** Its frontmatter (the block, as in the file) and what plugins' items get (StatusItem); none: not text (an image). */
  fm?: string; head?: FileHead
  /** What a viewer says instead of counts (size, dimensions, pages). */
  info?: string[]
  /** What a drawn file says instead of counts (a table's rows: FileFormat.status). */
  says?: (text: string) => string | null } | null
export let status_: Status_ = null
export const statusSubs = signal()
function publish(s: Status_) { status_ = s; statusSubs.notify() }
/** The status bar for the file in the focused pane's tab, published while `live`, and taken down when the file goes or
 *  its tab is hidden (another tab of the pane shown), unless another file's has replaced it meanwhile. */
export function usePublish(live: boolean, make: () => NonNullable<Status_>, deps: unknown[]) {
  const mine = useRef<Status_>(null)
  const { hidden } = usePane()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (live) { mine.current = make(); publish(mine.current) } }, [live, ...deps])
  useEffect(() => { if (hidden && mine.current && status_ === mine.current) publish(null) }, [hidden])
  useEffect(() => () => { if (mine.current && status_ === mine.current) publish(null) }, [])
}
