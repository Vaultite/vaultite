// Words just dictated, watched a minute for the user's fixes (Wispr Flow's window): what a fix teaches goes into the
// dictionary, said with a toast and its Undo. The editor, terminals and fields each say how to read their words back.
import { notify, op } from "@vaultite"
import { corrections } from "./learn.ts"
import type { Entry } from "./words.ts"

/** How long words just said are watched, and how long the user's let them be before what they changed is read. */
export const WATCH_MS = 60_000, SETTLE_MS = 2000

const list = (es: Entry[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(es.map((e) => `“${e.word}”`))
const sameEntry = (a: Entry, b: Entry) => a.word === b.word && (a.said ?? "") === (b.said ?? "")

export type Watch = {
  /** The user changed them (or typed in them): read once they've stopped. */
  edited(): void
  /** Done with them (Enter, another dictation there, the field gone): read now if they were changed, then stop. */
  done(): void
}

/** Watch `said`, as `read` gives it now (null: lost, as when the user went elsewhere). */
export function watchFix(said: string, read: () => string | null): Watch {
  let changed = false, over = false, timer: ReturnType<typeof setTimeout> | null = null
  /** What this watch taught, so a word still being typed ("Vorss") is replaced when it's finished ("Vorssaint"). */
  let taught: Entry[] = []
  const stop = () => { over = true; if (timer) clearTimeout(timer); timer = null }
  // (a minute from the dictation, or from the last change: a fix still settling is read then, the last time)
  const expiring = () => setTimeout(() => { const was = !!timer; stop(); if (was) settled() }, WATCH_MS)
  let expire = expiring()
  // (one read at a time: two overlapping would both teach the same fix)
  let learning: Promise<void> = Promise.resolve()
  const settled = () => { learning = learning.then(learn).catch(() => {}) }
  const learn = async () => {
    const now = read()
    if (now === null) return stop()
    const fixes = corrections(said, now)
    const gone = taught.filter((t) => !fixes.some((f) => f.word === t.word))
    taught = taught.filter((t) => !gone.includes(t))
    for (const e of gone) await op("dictation.remove", { ...e }).catch(() => {})
    const added: Entry[] = []
    for (const e of fixes.filter((f) => !taught.some((t) => t.word === f.word))) {
      const r = await op<{ added: Entry | null }>("dictation.add", { ...e, fixed: true }).catch(() => null)
      if (r?.added) { added.push(r.added); taught.push(r.added) }
    }
    if (!added.length) return
    notify(`Added ${list(added)} to your dictionary`, { duration: 6000, action: { label: "Undo", run: async () => {
      taught = taught.filter((t) => !added.some((a) => sameEntry(a, t)))
      await Promise.all(added.map((e) => op("dictation.remove", { ...e })))
    } } })
  }
  return {
    edited() {
      if (over) return
      changed = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; settled() }, SETTLE_MS)
      clearTimeout(expire)
      expire = expiring()
    },
    done() {
      if (over) return
      const was = changed && !!timer
      stop()
      clearTimeout(expire)
      if (was) settled()
    },
  }
}
