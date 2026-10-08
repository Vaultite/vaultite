// What file views share: the view (reading, live preview or source), one for every file on a device, switching every
// open pane at once, each keeping its place (beforeMode); and what the status bar shows (usePublish).
import { useEffect, useRef, useSyncExternalStore } from "react"
import { BookOpen, Code2, Pencil, type LucideIcon } from "lucide-react"
import type { FileHead } from "@/core/define"
import { isDesktop } from "@/core/workspace"
import { usePane } from "@/core/pane"
import { signal } from "@/core/signal"

export type Mode = "read" | "live" | "source"
const MODE_KEY = "vaultite.fileMode"
const EDIT_KEY = "vaultite.editMode"
const stored = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const storedMode = (): Mode => {
  const v = stored(MODE_KEY)
  return v === "read" || v === "live" || v === "source" ? v : isDesktop() ? "live" : "read"
}
let mode_: Mode | null = null
const modeSubs = new Set<() => void>()
/** Called with the next mode before any pane draws it (each pane notes where its reader is). */
export const beforeMode = new Set<(m: Mode) => void>()
function setGlobalMode(m: Mode, store = true) {
  if (m === getMode()) return
  for (const f of beforeMode) f(m)
  mode_ = m
  if (store) try { localStorage.setItem(MODE_KEY, m); if (m !== "read") localStorage.setItem(EDIT_KEY, m) } catch { /* private mode */ }
  for (const f of modeSubs) f()
}
const getMode = () => (mode_ ??= storedMode())
/** Another window on this device switched it. */
const otherWindow = (e: StorageEvent) => { if (e.key === MODE_KEY) setGlobalMode(storedMode(), false) }
function subscribeMode(f: () => void) {
  modeSubs.add(f)
  if (modeSubs.size === 1) addEventListener("storage", otherWindow)
  return () => { modeSubs.delete(f); if (!modeSubs.size) removeEventListener("storage", otherWindow) }
}
export function useMode(): [Mode, (m: Mode) => void] {
  return [useSyncExternalStore(subscribeMode, getMode), setGlobalMode]
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
