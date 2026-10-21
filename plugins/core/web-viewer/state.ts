// The Browser's state in the app: its settings, the pages' titles and the pages on screen, for the desktop app's
// events.
import { cell, currentWorkspace, pluginSettings, viewsChanged, type WebPageState } from "@vaultite"
import type { Container } from "./containers"

export type Settings = {
  /** Where web links clicked in the app open: "viewer" (the default: a tab here; ⌘-click: the browser) or "browser". */
  openLinks?: "viewer" | "browser"
  /** The search for what's typed in the address bar that isn't an address: `%s` is what was typed. */
  search?: string
  /** Whether pages' notifications reach the user (the default) or are dropped. */
  notifications?: boolean
  /** Whose logins a page has: "workspace" (the default: each workspace its own) or "shared" (every page the same). */
  logins?: "workspace" | "shared"
  /** Containers a tab can open in (containers.ts); unset: the defaults. */
  containers?: Container[]
  /** Whether ads and trackers are blocked (the default) or not (false). */
  shields?: boolean
  /** Sites where nothing is blocked ("example.com"). */
  shieldsDown?: string[]
  /** Parts of sites hidden with one click, by id (elements.ts PRESETS: "youtube-shorts"). */
  hide?: string[]
}

/** Its settings (data.json), live. */
export const settings = pluginSettings<Settings>("web-viewer")
/** Settled once the settings were first read, or after 3 s (a page waits for it: its logins depend on them). */
export const settingsRead = () => Promise.race([settings.ready(), new Promise<void>((done) => setTimeout(done, 3000))])
export const linksInViewer = () => settings.get().openLinks !== "browser"

/** The logins a new page gets: "" (the one every page shared before workspaces had their own) for the first workspace
 *  or "shared", else the workspace's number. */
export function profile(): string {
  return profileFor(currentWorkspace()?.n ?? 1)
}
/** The logins of workspace `n`'s pages. */
export const profileFor = (n: number) => (settings.get().logins === "shared" || n === 1 ? "" : String(n))

/** Pages' titles by address, for their tabs (a page not loaded yet shows its site). */
const titles = new Map<string, string>()
export const titleOf = (url: string) => titles.get(url)
export function setTitle(url: string, title: string) {
  if (!url || titles.get(url) === title) return
  titles.set(url, title)
  viewsChanged()
}

/** Pages playing sound, or muted, by their tab's arg (and the page's id): the tab's icon says so, kept or not. */
let sounds = new Map<string, { sound: "playing" | "muted"; id: number }>()
export const soundOf = (arg: string) => sounds.get(arg)
export function setSounds(next: Map<string, { sound: "playing" | "muted"; id: number }>) {
  const key = (m: typeof sounds) => [...m].map(([a, v]) => `${a} ${v.sound}`).sort().join("\n")
  const changed = key(next) !== key(sounds)
  sounds = next
  if (changed) viewsChanged()
}

/** An agent at work in a page, by the page's id: who, doing what, when (its bar shows it a few seconds). */
export type AgentNews = { by: string; what: string; at: number }
export const agentNews = cell(new Map<number, AgentNews>())
/** Pages the user paused agents in (the bar's Pause). */
export const pausedPages = cell(new Set<number>())

/** A page on screen (WebPage.tsx): what the desktop app's events about it reach. */
export type Shown = {
  /** Its pane (a tab group's id). */
  group: string
  /** Its container's id (null: none): what's opened from it opens there too. */
  container: string | null
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
/** That page's id (0: none). */
export const focusedPageId = () => (focused && shown.has(focused) ? focused : 0)
