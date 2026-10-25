// Unsent replies, kept on this device per thing replied to (a report's path, a session's event id) until the server has
// them: a reply in flight stays stored, so an app killed or suspended mid-send finds it again as a draft.
import { useMemo, useSyncExternalStore } from "react"

const KEY = (to: string) => `vaultite.reply:${to}`
const PREFIX = KEY("")

export const draftOf = (to: string) => { try { return localStorage.getItem(KEY(to)) ?? "" } catch { return "" } }
export const hasDraft = (to: string) => !!draftOf(to).trim()

/** The replies on their way, by what they answer: their text. */
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

/** Send `text` with `post`: its draft is cleared only once `post` resolves, and kept when it fails (or never answers).
 *  Undefined, sending nothing, while a reply to `to` is still on its way. */
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

/** What has a draft, as one string (a stable snapshot): every key, one per line. */
function draftKeys() {
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX) && localStorage.getItem(k)?.trim() && !flying.has(k.slice(PREFIX.length))) out.push(k.slice(PREFIX.length))
    }
  } catch { /* private mode */ }
  return out.sort().join("\n")
}

/** Whether `to` has a draft not sent yet (in flight isn't one). */
export const useHasDraft = (to: string) => useSyncExternalStore(subscribe, () => hasDraft(to) && !flying.has(to))
/** Everything with a draft not sent yet. */
export function useDrafted(): ReadonlySet<string> {
  const keys = useSyncExternalStore(subscribe, draftKeys)
  return useMemo(() => new Set(keys ? keys.split("\n") : []), [keys])
}
export const useSending = (to: string) => useSyncExternalStore(subscribe, () => sendingOf(to))
