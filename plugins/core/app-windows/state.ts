// What the tabs share: apps' names and windows' titles (for the tabs' titles), news of a window going, the settings.
import { getTabLayout, viewsChanged, type AppInfo, type TabLayout } from "@vaultite"

/** A tab's arg: the app, and the window it holds once it has one (`com.brave.Browser:1234`). */
export function parse(arg: string) {
  const i = arg.lastIndexOf(":"), wid = i > 0 ? Number(arg.slice(i + 1)) : 0
  return Number.isInteger(wid) && wid > 0 ? { bundle: arg.slice(0, i), wid } : { bundle: arg, wid: 0 }
}

const names = new Map<string, string>()
/** An app's name as the Mac calls it, else made from its bundle id (com.spotify.client: Spotify). */
export function nameOf(bundle: string) {
  const known = names.get(bundle)
  if (known) return known
  const parts = bundle.split(".").filter((p) => !/^(com|org|net|io|app|client|desktop|mac|macos|osx)$/i.test(p))
  const word = parts[parts.length - 1] ?? bundle
  return word.charAt(0).toUpperCase() + word.slice(1)
}
export function learnNames(apps: AppInfo[]) {
  let changed = false
  for (const a of apps) if (names.get(a.bundle) !== a.name) { names.set(a.bundle, a.name); changed = true }
  if (changed) viewsChanged()
}

const titles = new Map<number, string>()
export function setWindowTitle(wid: number, title: string) {
  if (titles.get(wid) === title) return
  titles.set(wid, title)
  viewsChanged()
}
/** The app tabs' args (`<bundle>[:<window>]`). */
export function appTabs() {
  const out: string[] = []
  const walk = (n: TabLayout["root"]) => { if ("tabs" in n) out.push(...n.tabs.filter((t) => t.to.startsWith("view:app/")).map((t) => t.to.slice(9))); else n.kids.forEach(walk) }
  walk(getTabLayout().root)
  return out
}
/** A tab's title: the app's name, and its window's title too while another tab shows the same app. */
export function tabTitle(arg: string) {
  const { bundle, wid } = parse(arg), name = nameOf(bundle), title = titles.get(wid)
  if (!title || title === name) return name
  return appTabs().filter((a) => parse(a).bundle === bundle).length > 1 ? `${name}: ${title}` : name
}

/** The tabs waiting to hear their window went (closed, or its app quit), by window. */
export const onGone = new Map<number, Set<() => void>>()
export function gone(wid: number) {
  for (const f of onGone.get(wid) ?? []) f()
}
/** The tabs waiting to hear their window left the desktop on screen or came back, by window. */
export const onHere = new Map<number, Set<(here: boolean) => void>>()
export function moved(wid: number, here: boolean) {
  for (const f of onHere.get(wid) ?? []) f(here)
}

export const SETTINGS_DIR = ".vaultite/plugins/app-windows"
export type Settings = { newWindows?: boolean }
let settings: Settings = {}
export const getSettings = () => settings
export const setSettings = (s: Settings) => { settings = s }
