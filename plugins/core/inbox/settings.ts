// The Inbox's settings (data.json), loaded by its background and read by the lists.
import { useSyncExternalStore } from "react"

export type Settings = { toasts?: boolean; notifications?: boolean; show_read?: boolean }

let current: Settings = {}
const subs = new Set<() => void>()

export function setSettings(s: Settings) {
  current = s && typeof s === "object" ? s : {}
  subs.forEach((f) => f())
}
export const getSettings = () => current
export const useSettings = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, getSettings)
