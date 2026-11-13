import { cell, currentWorkspace, notifyError, pluginSettings, viewsChanged, webPages, type WebPageState } from "@vaultite"
import type { Container } from "./containers"

export type Settings = {
  openLinks?: "viewer" | "browser"
  /** `%s` is what was typed. */
  search?: string
  notifications?: boolean
  logins?: "workspace" | "shared"
  containers?: Container[]
  /** By profile ("c-work"; a workspace's: "", "2"). */
  siteOrder?: Record<string, string[]>
  shields?: boolean
  /** Hosts ("example.com"). */
  shieldsDown?: string[]
  /** elements.ts PRESETS ids. */
  hide?: string[]
  unstyled?: string[]
  darkPages?: boolean
  darkPagesLook?: "theme" | "dark"
  /** Hosts ("example.com"). */
  darkPagesOff?: string[]
  playerFullScreen?: boolean
  pageBar?: "shown" | "hidden"
  bookmarksBar?: "shown"
  soundCard?: boolean
}

/** Its settings (data.json), live. */
export const settings = pluginSettings<Settings>("web-viewer")
export const settingsRead = () => Promise.race([settings.ready(), new Promise<void>((done) => setTimeout(done, 3000))])
export const linksInViewer = () => settings.get().openLinks !== "browser"

export function profile(): string {
  return profileFor(currentWorkspace()?.n ?? 1)
}
export const profileFor = (n: number) => (settings.get().logins === "shared" || n === 1 ? "" : String(n))

const titles = new Map<string, string>()
export const titleOf = (url: string) => titles.get(url)
export function setTitle(url: string, title: string) {
  if (!url || titles.get(url) === title) return
  titles.set(url, title)
  viewsChanged()
}
export function keptTitles(kept: Record<string, string>) {
  let more = false
  for (const [url, title] of Object.entries(kept)) if (typeof title === "string" && title && !titles.has(url)) { titles.set(url, title); more = true }
  if (more) viewsChanged()
}

export type Sound = { playing: boolean; muted: boolean; paused: boolean; id: number; tab: string; arg: string; title: string; player?: boolean }
export const sounds = cell<Sound[]>([])
export const soundOf = (arg: string, tab?: string) => {
  const all = sounds.get()
  return tab ? all.find((s) => s.tab === tab) ?? all.find((s) => !s.tab && s.arg === arg) : all.find((s) => s.arg === arg)
}
export function setSounds(next: Sound[]) {
  const key = (l: Sound[]) => l.map((s) => `${s.tab} ${s.arg} ${s.playing} ${s.muted} ${s.paused} ${s.title} ${!!s.player}`).sort().join("\n")
  if (key(next) === key(sounds.get())) return
  const icons = (l: Sound[]) => l.map((s) => `${s.tab} ${s.arg} ${s.muted} ${s.paused && !s.playing}`).sort().join("\n")
  const redraw = icons(next) !== icons(sounds.get())
  sounds.set(next)
  if (redraw) viewsChanged()
}

const loadingTabs = cell(new Set<string>()), typedTabs = cell(new Set<string>())
export const loadingIn = (tab: string) => loadingTabs.get().has(tab)
export const typedIn = (tab: string) => typedTabs.get().has(tab)
export function setPageFlags(loading: Set<string>, typed: Set<string>) {
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))
  if (!same(typed, typedTabs.get())) typedTabs.set(typed)
  if (same(loading, loadingTabs.get())) return
  loadingTabs.set(loading)
  viewsChanged()
}

export type PasskeyAsk = { ask: number; state: string; qr: string; site: string; create: boolean }
export const passkeyAsks = cell(new Map<number, PasskeyAsk>())

export const onScreen = cell(new Set<number>())
export const pictured = cell(new Set<number>())
export function setPictured(id: number, on: boolean) {
  if (pictured.get().has(id) === on) return
  pictured.update((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next })
}
export function setOnScreen(id: number, on: boolean) {
  if (onScreen.get().has(id) === on) return
  onScreen.update((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next })
}

export type Shown = {
  group: string; tab: string
  state: () => WebPageState
  find: (how: FindAsk) => void
  found: (active: number, matches: number) => void
  container: string | null
  url: () => string
  onState: (s: WebPageState) => void
  clip: () => void
  focusAddress: () => void
  inPlayer: () => boolean
}
export const shown = new Map<number, Shown>()
const unheard = new Map<number, WebPageState>()
export function stateCame(id: number, s: WebPageState) {
  const on = shown.get(id)
  if (on) return on.onState(s)
  unheard.delete(id)
  unheard.set(id, s)
  if (unheard.size > 100) unheard.delete(unheard.keys().next().value!)
}
export const forgetUnheard = (id: number) => { unheard.delete(id) }
export function takeUnheard(id: number) { const s = unheard.get(id); unheard.delete(id); return s }
let focused = 0
export const setFocusedPage = (id: number, on: boolean) => { if (on) focused = id; else if (focused === id) focused = 0 }
export const focusedPage = () => (focused ? shown.get(focused) ?? null : null)
export const focusedPageId = () => (focused && shown.has(focused) ? focused : 0)
export const pageOfTab = (tab: string) => { for (const [id, s] of shown) if (s.tab === tab) return { id, ...s }; return null }
export type FindAsk = "open" | "next" | "previous"

let keyboard = 0
export const pageTookKeyboard = (id: number) => { keyboard = id }
export const hasKeyboard = (id: number) => keyboard === id
if (typeof window !== "undefined") addEventListener("focus", () => { keyboard = 0 })

export const setPlayer = (id: number, on: boolean) =>
  void Promise.resolve(webPages?.player?.(id, on, settings.get().playerFullScreen === true)).catch((e) => notifyError(e, on ? "Couldn't open the player" : "Couldn't bring the page back"))
