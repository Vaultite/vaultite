// The Web viewer's state in the app: its settings, the pages' titles and the pages on screen, for the desktop app's
// events.
import { useSyncExternalStore } from "react"
import { currentWorkspace, patch, viewsChanged, type WebPageState } from "@vaultite"

export const SETTINGS_DIR = ".vaultite/plugins/web-viewer"

export type Settings = {
  /** Where web links clicked in the app open: "viewer" (the default: a tab here; ⌘-click: the browser) or "browser". */
  openLinks?: "viewer" | "browser"
  /** The search for what's typed in the address bar that isn't an address: `%s` is what was typed. */
  search?: string
  /** Whether pages' notifications reach the user (the default) or are dropped. */
  notifications?: boolean
  /** Whose logins a page has: "workspace" (the default: each workspace its own) or "shared" (every page the same). */
  logins?: "workspace" | "shared"
}

const subs = new Set<() => void>()
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
let settings: Settings = {}
export const getSettings = () => settings
export const useSettings = () => useSyncExternalStore(subscribe, getSettings)
let loaded: () => void = () => {}
/** Settled once the settings were first read (a page waits for it: its logins depend on them). */
export const settingsRead = new Promise<void>((done) => { loaded = done; setTimeout(done, 3000) })
export function setSettings(s: Settings) {
  loaded()
  if (JSON.stringify(s) === JSON.stringify(settings)) return
  settings = s
  subs.forEach((f) => f())
}
/** Change a setting (null: back to the default), here at once and in the vault. */
export function changeSettings(p: { [K in keyof Settings]?: Settings[K] | null }) {
  const next: Settings = { ...settings }
  for (const [k, v] of Object.entries(p)) { if (v === null || v === undefined) delete next[k as keyof Settings]; else (next as Record<string, unknown>)[k] = v }
  setSettings(next)
  return patch("config/plugin/web-viewer", p).catch(() => {})
}
export const linksInViewer = () => settings.openLinks !== "browser"

/** The logins a new page gets: "" (the one every page shared before workspaces had their own) for the first workspace
 *  or "shared", else the workspace's number. */
export function profile(): string {
  return profileFor(currentWorkspace()?.n ?? 1)
}
/** The logins of workspace `n`'s pages. */
export const profileFor = (n: number) => (settings.logins === "shared" || n === 1 ? "" : String(n))

/** Pages' titles by address, for their tabs (a page not loaded yet shows its site). */
const titles = new Map<string, string>()
export const titleOf = (url: string) => titles.get(url)
export function setTitle(url: string, title: string) {
  if (!url || titles.get(url) === title) return
  titles.set(url, title)
  viewsChanged()
}

/** A page on screen (WebPage.tsx): what the desktop app's events about it reach. */
export type Shown = {
  /** Its pane (a tab group's id). */
  group: string
  url: () => string
  onState: (s: WebPageState) => void
  clip: () => void
  focusAddress: () => void
}
export const shown = new Map<number, Shown>()
/** The page in the focused pane, if one is: "Clip current web page". */
let focused = 0
export const setFocusedPage = (id: number, on: boolean) => { if (on) focused = id; else if (focused === id) focused = 0 }
export const focusedPage = () => (focused ? shown.get(focused) ?? null : null)
