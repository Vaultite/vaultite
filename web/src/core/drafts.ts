// Edits the server hasn't confirmed yet, kept on this device (per vault and file) until it has: a window closed or
// killed mid-save offers them back the next time the file opens (FileView). In IndexedDB, so a note of any size is kept.
import { getStore } from "@/core/data"
import { merge3 } from "@/core/merge"

export type Draft = { text: string; base: string; t: number }

const STORE = "drafts"
const key = (path: string) => `${getStore()?.vault.path ?? ""}:${path}`

let db: Promise<IDBDatabase | null> | null = null
const open = () => db ??= new Promise((done) => {
  try {
    const r = indexedDB.open("vaultite-drafts", 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => done(r.result)
    r.onerror = () => done(null)
  } catch { done(null) } // (no IndexedDB here: nothing is kept)
})
/** One request on the store, run in the order asked (a keep then a drop stay so); undefined when it fails. */
async function ask<T>(mode: IDBTransactionMode, req: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await open()
  if (!d) return undefined
  return new Promise((done) => {
    try {
      const r = req(d.transaction(STORE, mode).objectStore(STORE))
      r.onsuccess = () => done(r.result)
      r.onerror = () => done(undefined)
    } catch { done(undefined) }
  })
}

/** Keep `text` (typed over `base`, what the server had, to merge with) until `dropDraft`. */
export function keepDraft(path: string, text: string, base: string) {
  void ask("readwrite", (s) => s.put({ text, base, t: Date.now() } satisfies Draft, key(path)))
}

export function dropDraft(path: string) {
  void ask("readwrite", (s) => s.delete(key(path)))
}

/** The edits kept for a file, unless it has them now (they did get saved, maybe with what the server filled in). */
export async function draftOf(path: string, now: string): Promise<Draft | null> {
  const kept = await ask<Draft | undefined>("readonly", (s) => s.get(key(path)))
  if (!kept || typeof kept.text !== "string") return null
  if (kept.text === now || (kept.base && merge3(kept.base, kept.text, now) === now)) { dropDraft(path); return null }
  return kept
}
