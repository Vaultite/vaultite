// A reply in flight stays stored: a phone's app killed or suspended mid-send finds it again as a draft.
import { useSyncExternalStore } from "react"

const KEY = (to: string) => `vaultite.reply:${to}`
const PREFIX = KEY("")

export const draftOf = (to: string) => { try { return localStorage.getItem(KEY(to)) ?? "" } catch { return "" } }
export const hasDraft = (to: string) => !!draftOf(to).trim()

const flying = new Map<string, string>()
export const sendingOf = (to: string) => flying.get(to) ?? null

const subs = new Set<() => void>()
const changed = () => { for (const f of subs) f() }
// (another window's drafts: the storage event fires only in the others)
const fromElsewhere = (e: StorageEvent) => { if (!e.key || e.key.startsWith(PREFIX)) changed() }
function subscribe(f: () => void) {
  if (!subs.size) globalThis.addEventListener?.("storage", fromElsewhere)
  subs.add(f)
  return () => { subs.delete(f); if (!subs.size) globalThis.removeEventListener?.("storage", fromElsewhere) }
}

export function keepDraft(to: string, text: string) {
  try { if (text.trim()) localStorage.setItem(KEY(to), text); else localStorage.removeItem(KEY(to)) } catch { /* private mode, full */ }
  changed()
}

export async function sendDraft<T>(to: string, text: string, post: () => Promise<T>): Promise<T | undefined> {
  if (flying.has(to)) return undefined
  keepDraft(to, text)
  flying.set(to, text)
  changed()
  try {
    const out = await post()
    if (draftOf(to) === text) keepDraft(to, "")
    return out
  } finally {
    flying.delete(to)
    changed()
  }
}

export const useHasDraft = (to: string) => useSyncExternalStore(subscribe, () => hasDraft(to) && !flying.has(to))
export const useSending = (to: string) => useSyncExternalStore(subscribe, () => sendingOf(to))
