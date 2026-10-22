// The desktop status bar's items as one list (appearance `statusBar`: shown, in order; `statusBarMore`: those kept in
// its tray): the app's own (the file's view and counts) and the plugins' (ambient, and status: for the focused file).
import type { AmbientItem, StatusItem } from "@/core/define"
import { ambientItems, statusItems } from "@/core/plugins"
import { getPrefs, setPrefs } from "@/core/prefs"
import { defaultOrder, keyList, placeKey } from "../../../core/slots.ts"

/** The app's own items, drawn by the bar (StatusBar.tsx), between the plugins' status items before and `after`. */
export const BUILT_IN = [
  { key: "core:view", title: "Current view" },
  { key: "core:words", title: "Word count" },
  { key: "core:characters", title: "Character count" },
] as const

/** One item: `ambient` whatever is open, else for the focused file (a plugin's `status`, or one of the app's own). */
export type BarItem = { key: string; title: string } & ({ ambient: AmbientItem; status?: undefined } | { ambient?: undefined; status?: StatusItem })

/** Every item there could be now, in their default order (`defaults`: those shown where nothing's saved). */
export function barItems(disabled: string[], order: string[]) {
  const ambient = ambientItems(disabled, order).map((x): BarItem => ({ key: x.key, title: x.item.title, ambient: x.item }))
  const status = statusItems(disabled, order).map((x): BarItem => ({ key: x.key, title: x.item.title ?? x.plugin.name, status: x.item }))
  const all = [...ambient, ...status.filter((x) => !x.status!.after), ...BUILT_IN.map((b): BarItem => ({ ...b })), ...status.filter((x) => x.status!.after)]
  const shownAmbient = defaultOrder(ambient.map((x) => ({ key: x.key, sort: x.ambient!.sort, hidden: x.ambient!.hidden })))
  const hiddenAmbient = ambient.filter((x) => !shownAmbient.includes(x.key)).map((x) => x.key)
  const rest = all.filter((x) => !x.ambient).map((x) => x.key)
  return { all, defaults: [...shownAmbient, ...rest], order: [...shownAmbient, ...hiddenAmbient, ...rest] }
}

/** The keys shown, in order: the saved list (keys of plugins that are off kept in their place), else the defaults. */
function shownKeys(defaults: string[], saved = getPrefs().statusBar) { return saved ? keyList(saved) : defaults }

/** The items the bar shows, in order, and every one there could be. */
export function barShown(disabled: string[], order: string[], saved: string[] | null) {
  const b = barItems(disabled, order), keys = shownKeys(b.defaults, saved)
  return { ...b, keys, shown: keys.flatMap((k) => b.all.filter((x) => x.key === k)) }
}
const now = () => { const { disabled, order, statusBar } = getPrefs(); return barShown(disabled, order, statusBar) }

/** Where `key` goes back into `list` by default: before the next one after it in the default order that's there. */
const defaultPlace = (list: string[], order: string[], key: string) => order.slice(order.indexOf(key) + 1).find((k) => list.includes(k)) ?? null

/** Show or hide an item (shown: before `before`, else at its default place); hidden, it leaves the tray too. */
export function showBarItem(key: string, on: boolean, before?: string | null) {
  const { keys, order } = now(), more = getPrefs().statusBarMore
  return setPrefs(on ? { statusBar: placeKey(keys, key, before === undefined ? defaultPlace(keys, order, key) : before) }
    : { statusBar: keys.filter((k) => k !== key), statusBarMore: more.filter((k) => k !== key) })
}

/** Every item shown, the hidden ones at their default places. */
export function showAllBarItems() {
  const { keys, order } = now()
  return setPrefs({ statusBar: order.reduce((list, k) => (list.includes(k) ? list : placeKey(list, k, defaultPlace(list, order, k))), keys) })
}

/** An item put before `before` (null: last), in the tray (`tuck`) or out of it. */
export function moveBarItem(key: string, before: string | null, tuck: boolean) {
  const more = getPrefs().statusBarMore.filter((k) => k !== key)
  return setPrefs({ statusBar: placeKey(now().keys, key, before), statusBarMore: tuck ? [...more, key] : more })
}

/** Whether the bar shows `key` now. */
export const barShows = (key: string) => now().shown.some((x) => x.key === key)
