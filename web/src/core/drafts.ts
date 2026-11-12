import { getStore } from "@/core/data"
import { hasEdits } from "@/core/merge"

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
  } catch { done(null) }
})
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

export function keepDraft(path: string, text: string, base: string) {
  void ask("readwrite", (s) => s.put({ text, base, t: Date.now() } satisfies Draft, key(path)))
}

export function dropDraft(path: string) {
  void ask("readwrite", (s) => s.delete(key(path)))
}

export async function draftOf(path: string, now: string): Promise<Draft | null> {
  const kept = await ask<Draft | undefined>("readonly", (s) => s.get(key(path)))
  if (!kept || typeof kept.text !== "string") return null
  if (kept.text === now || (kept.base && hasEdits(kept.base, kept.text, now))) { dropDraft(path); return null }
  return kept
}
