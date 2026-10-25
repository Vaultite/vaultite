// The Browser's state in the app: its settings, the pages' titles and the pages on screen, for the desktop app's
// events.
import { cell, currentWorkspace, notify, notifyError, op, openFile, pluginSettings, viewsChanged, webPages, type WebPageState } from "@vaultite"
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
  /** Each set of logins' sites in the order they were dragged into in Sites, by profile ("c-work"; a workspace's: "",
   *  "2"): those not in it come after (loginsets.ts). */
  siteOrder?: Record<string, string[]>
  /** Whether ads and trackers are blocked (the default) or not (false). */
  shields?: boolean
  /** Sites where nothing is blocked ("example.com"). */
  shieldsDown?: string[]
  /** Parts of sites hidden with one click, by id (elements.ts PRESETS: "youtube-shorts"). */
  hide?: string[]
  /** Sites whose style (sitestyles.ts) is off: shown as the site makes them. */
  unstyled?: string[]
  /** Whether a page opened as a player goes full screen, on a Space of its own (the default), or is a window. */
  playerFullScreen?: boolean
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

/** A page playing sound (through its quiet scenes, till its media pauses), or muted: its tab's speaker says so, shown or
 *  in the background. `tab`: its tab's id ("" from builds before tabs owned their pages), `arg` that tab's. */
export type Sound = { playing: boolean; muted: boolean; id: number; tab: string; arg: string; title: string }
/** Every page's, for the status bar's "playing". */
export const sounds = cell<Sound[]>([])
/** Tab `tab`'s page's sound; without a tab (a pin), a page's at that address. */
export const soundOf = (arg: string, tab?: string) => {
  const all = sounds.get()
  return tab ? all.find((s) => s.tab === tab) ?? all.find((s) => !s.tab && s.arg === arg) : all.find((s) => s.arg === arg)
}
export function setSounds(next: Sound[]) {
  const key = (l: Sound[]) => l.map((s) => `${s.tab} ${s.arg} ${s.playing} ${s.muted} ${s.title}`).sort().join("\n")
  if (key(next) === key(sounds.get())) return
  const icons = (l: Sound[]) => l.map((s) => `${s.tab} ${s.arg} ${s.muted}`).sort().join("\n")
  const redraw = icons(next) !== icons(sounds.get())
  sounds.set(next)
  if (redraw) viewsChanged()
}

/** A page waiting on a passkey from a phone (electron/browser/passkeys.ts), by the page's id: its QR code while it's to be
 *  scanned, then how it's going. */
export type PasskeyAsk = { ask: number; state: string; qr: string; site: string; create: boolean }
export const passkeyAsks = cell(new Map<number, PasskeyAsk>())

/** The pages shown in a tab now, by id: an agent's there needs no card of its own (AgentsCard.tsx). */
export const onScreen = cell(new Set<number>())
export function setOnScreen(id: number, on: boolean) {
  if (onScreen.get().has(id) === on) return
  onScreen.update((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next })
}

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
  /** It's in its player. */
  inPlayer: () => boolean
}
export const shown = new Map<number, Shown>()
/** The page in the focused pane, if one is: "Clip current web page". */
let focused = 0
export const setFocusedPage = (id: number, on: boolean) => { if (on) focused = id; else if (focused === id) focused = 0 }
export const focusedPage = () => (focused ? shown.get(focused) ?? null : null)
/** That page's id (0: none). */
export const focusedPageId = () => (focused && shown.has(focused) ? focused : 0)

/** The page the desktop app last said took the keyboard (0: none, or the window's own page has it since). */
let keyboard = 0
export const pageTookKeyboard = (id: number) => { keyboard = id }
export const hasKeyboard = (id: number) => keyboard === id
if (typeof window !== "undefined") addEventListener("focus", () => { keyboard = 0 })

/** Bookmark a page: a line in the bookmarks note (⌘D, the bar's … menu). */
export async function bookmark(url: string, title: string) {
  if (!/^https?:\/\//i.test(url)) return
  try {
    const r = await op<{ path: string | null; added: number }>("bookmarks.add", { url, title })
    const path = r.path
    notify(r.added ? "Bookmarked" : "Already bookmarked", { action: path ? { label: "Open bookmarks", run: () => openFile(path) } : undefined })
  } catch (e) { notifyError(e, "Couldn't bookmark the page") }
}

/** Page `id` into its player (full screen as the settings say), or back in its tab. */
export const setPlayer = (id: number, on: boolean) =>
  void Promise.resolve(webPages?.player?.(id, on, settings.get().playerFullScreen !== false)).catch((e) => notifyError(e, on ? "Couldn't open the player" : "Couldn't bring the page back"))
