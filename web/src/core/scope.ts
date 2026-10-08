// Where state lives: the vault (settings files), a workspace (what's open and arranged, kept by the Workspaces plugin
// and shared across its devices) or a device (localStorage). Plugins pick with useScopedState; see web/CLAUDE.md.
import { useSyncExternalStore } from "react"
import type { WorkspaceHost, WorkspaceInfo } from "@/core/define"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { devicePref, getPrefs, onPrefs } from "@/core/prefs"

export type Scope = "workspace" | "device"

/** The plugin that keeps workspaces, if one is on. */
function workspaceHost(): WorkspaceHost | null {
  const off = getPrefs().disabled
  return PLUGINS.find((p) => p.workspace && isEnabled(p.id, off))?.workspace ?? null
}

const subs = new Set<() => void>()
let version = 0
/** Tell the app the current workspace, or something kept in it, changed (the plugin keeping workspaces calls it). */
export function workspaceChanged() { version++; subs.forEach((f) => f()) }
/** Subscribe to the current workspace and what's kept in it (for useSyncExternalStore with a getter of your own). */
export const subscribeScoped = (f: () => void) => subscribe(f)
const subscribe = (f: () => void) => {
  subs.add(f)
  const off = onPrefs(f) // a plugin switched on or off brings workspaces or takes them away
  return () => { subs.delete(f); off() }
}
/** Redraws when the current workspace or what's kept in it changes; answers a number that changes then. */
export const useWorkspaceVersion = () => useSyncExternalStore(subscribe, () => `${version}:${workspaceHost() ? 1 : 0}`)

/** The plugin keeping workspaces, as the phone's tab list pages through them (null: none). */
export function workspaces(): Pick<WorkspaceHost, "current" | "list" | "switchTo" | "menu"> | null {
  return workspaceHost()
}

/** The current workspace (null: no plugin keeps workspaces). */
export function currentWorkspace(): WorkspaceInfo | null {
  const h = workspaceHost()
  if (!h) return null
  const n = h.current()
  return h.list().find((w) => w.n === n) ?? { n, label: `Workspace ${n}`, places: [] }
}
/** The workspaces in use, and the current one ([] without workspaces). */
export const workspaceList = (): WorkspaceInfo[] => workspaceHost()?.list() ?? []

/** The current workspace's pinned pages, or null: no workspaces, or the current one has no list of its own (it shows
 *  the vault's, .vaultite/pages.json: Pinned's). */
export const workspacePins = (): string[] | null => workspaceHost()?.pinned() ?? null
/** Pin a page in the current workspace (at the end, or before `before`) or unpin it there; one without a list of its
 *  own starts from `base` (the vault's). Nothing without workspaces. */
export const pinInWorkspace = (path: string, on: boolean, before: string | null | undefined, base: string[]): Promise<unknown> =>
  workspaceHost()?.pin(path, on, before, base) ?? Promise.resolve()

// ---------- values kept at a level ----------
const local = (key: string) => devicePref<unknown>(`ws:${key}`, undefined)

function read<T>(key: string, fallback: T, scope: Scope): T {
  if (scope === "workspace") {
    const h = workspaceHost()
    const v = h ? h.get(key) : local(key).get()
    return v === undefined || v === null ? fallback : v as T
  }
  const v = devicePref<unknown>(key, undefined).get()
  return v === undefined ? fallback : v as T
}

function write(key: string, value: unknown, scope: Scope) {
  if (scope === "workspace") {
    const h = workspaceHost()
    if (h) h.set(key, value ?? null)
    else local(key).set(value ?? undefined)
    return
  }
  devicePref<unknown>(key, undefined).set(value ?? undefined)
}

/** A value kept at a level by key ("<plugin id>:<name>"): `get` answers `fallback` while
 *  nothing's kept, `set(undefined)` removes it. Workspace values travel with the workspace; device values stay here. */
export function scopedState<T>(key: string, fallback: T, scope: Scope = "workspace") {
  return { get: () => read(key, fallback, scope), set: (v: T | undefined) => write(key, v, scope) }
}

/** The same as a hook: [value, set], redrawn when it changes (here, another device on the workspace, a switch). Keep
 *  `fallback` stable (a constant), or the value redraws on every draw while nothing's kept. */
export function useScopedState<T>(key: string, fallback: T, scope: Scope = "workspace"): [T, (v: T | undefined) => void] {
  const v = useSyncExternalStore(subscribe, () => read(key, fallback, scope))
  return [v, (next) => write(key, next, scope)]
}

// ---------- files opened lately, per workspace ----------
// So each desk remembers its own work: saved a moment after a file has stayed in view, offered first by new tabs.
const RECENT_MAX = 12
const recentState = scopedState<string[]>("core:recent", [], "workspace")
const NONE: string[] = []
/** The files opened lately in the current workspace, newest first. */
export const recentFiles = (): string[] => { const v = recentState.get(); return Array.isArray(v) ? v : NONE }
export const useRecentFiles = () => useSyncExternalStore(subscribe, recentFiles)
let recentTimer = 0, noted = ""
/** The focused tab shows `path` now ("" for something else): it goes first in the list once it's stayed a moment. */
export function noteOpened(path: string) {
  // (only when it's new here: another device's change to the workspace isn't this one opening its file again, and two
  // devices on different files would each put theirs first back and forth)
  const now = `${currentWorkspace()?.n}:${path}`
  if (now === noted) return
  noted = now
  clearTimeout(recentTimer)
  if (!path) return
  recentTimer = window.setTimeout(() => {
    const cur = recentFiles()
    if (cur[0] === path) return
    recentState.set([path, ...cur.filter((p) => p !== path)].slice(0, RECENT_MAX))
  }, 1500)
}
