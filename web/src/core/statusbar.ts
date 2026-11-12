import type { AmbientItem, StatusItem } from "@/core/define"
import { ambientItems, statusItems } from "@/core/plugins"
import { getPrefs, setPrefs } from "@/core/prefs"
import { defaultOrder, keyList, placeKey } from "../../../core/slots.ts"

const BUILT_IN = [
  { key: "core:view", title: "Current view" },
  { key: "core:words", title: "Word count" },
  { key: "core:characters", title: "Character count" },
] as const

export type BarItem = { key: string; title: string } & ({ ambient: AmbientItem; status?: undefined } | { ambient?: undefined; status?: StatusItem })

function barItems(disabled: string[]) {
  const ambient = ambientItems(disabled).map((x): BarItem => ({ key: x.key, title: x.item.title, ambient: x.item }))
  const status = statusItems(disabled).map((x): BarItem => ({ key: x.key, title: x.item.title ?? x.plugin.name, status: x.item }))
  const all = [...ambient, ...status.filter((x) => !x.status!.after), ...BUILT_IN.map((b): BarItem => ({ ...b })), ...status.filter((x) => x.status!.after)]
  const shownAmbient = defaultOrder(ambient.map((x) => ({ key: x.key, sort: x.ambient!.sort, hidden: x.ambient!.hidden })))
  const hiddenAmbient = ambient.filter((x) => !shownAmbient.includes(x.key)).map((x) => x.key)
  const rest = all.filter((x) => !x.ambient).map((x) => x.key)
  return { all, defaults: [...shownAmbient, ...rest], order: [...shownAmbient, ...hiddenAmbient, ...rest] }
}

function shownKeys(defaults: string[], saved = getPrefs().statusBar) { return saved ? keyList(saved) : defaults }

function leftKeys(all: BarItem[], saved: string[] | null) { return saved ? keyList(saved) : all.filter((x) => x.ambient?.left).map((x) => x.key) }

export function barShown(disabled: string[], saved: string[] | null, savedLeft: string[] | null = null) {
  const b = barItems(disabled), keys = shownKeys(b.defaults, saved)
  return { ...b, keys, left: leftKeys(b.all, savedLeft), shown: keys.flatMap((k) => b.all.filter((x) => x.key === k)) }
}
const now = () => { const { disabled, statusBar, statusBarLeft } = getPrefs(); return barShown(disabled, statusBar, statusBarLeft) }

const defaultPlace = (list: string[], order: string[], key: string) => order.slice(order.indexOf(key) + 1).find((k) => list.includes(k)) ?? null

export function showBarItem(key: string, on: boolean, before?: string | null) {
  const { keys, order } = now(), more = getPrefs().statusBarMore
  return setPrefs(on ? { statusBar: placeKey(keys, key, before === undefined ? defaultPlace(keys, order, key) : before) }
    : { statusBar: keys.filter((k) => k !== key), statusBarMore: more.filter((k) => k !== key) })
}

export function showAllBarItems() {
  const { keys, order } = now()
  return setPrefs({ statusBar: order.reduce((list, k) => (list.includes(k) ? list : placeKey(list, k, defaultPlace(list, order, k))), keys) })
}

export type BarPlace = "left" | "right" | "tray"

export function moveBarItem(key: string, before: string | null, place: BarPlace) {
  const b = now(), more = getPrefs().statusBarMore.filter((k) => k !== key), left = b.left.filter((k) => k !== key)
  return setPrefs({ statusBar: placeKey(b.keys, key, before), statusBarMore: place === "tray" ? [...more, key] : more, statusBarLeft: place === "left" ? [...left, key] : left })
}

export const barShows = (key: string) => now().shown.some((x) => x.key === key)
