// Taps answered at once: what a write takes away leaves its list now, what it changes shows changed now, and a slow one
// shows it's working. The server's answer catches up; a failed write puts things back and says so.
import { useCallback, useEffect, useRef, useState } from "react"
import { notifyError } from "@/core/notify"
import { cell } from "@/core/signal"

/** How long a row folds away (index.css's `[data-leaving]`). */
const FOLD = 180
/** How long something written stays as shown while its source still says otherwise (its next refresh catches up). */
const LINGER = 15_000

const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

type Phase = "leaving" | "writing" | "done"

/** Items taken off a list before the write that removes them is done: one per source (a module's, shared by every
 *  list drawing it), with keys unique in it. `remove` them; draw the list through `use`. */
export function removals() {
  const phases = cell(new Map<string, Phase>())
  const set = (keys: string[], p: Phase | null) => {
    if (keys.length) phases.update((m) => {
      const next = new Map(m)
      for (const k of keys) { if (p) next.set(k, p); else next.delete(k) }
      return next
    })
  }
  const inPhase = (keys: string[], p: Phase) => keys.filter((k) => phases.get().get(k) === p)
  return {
    /** Take `keys` off now (their rows fold away) and write; a failed write brings them back and says `failed`. Keys
     *  already on their way are left out (a second press). Whether it worked. */
    async remove(keys: string | string[], write: () => Promise<unknown>, failed: string): Promise<boolean> {
      const ks = (typeof keys === "string" ? [keys] : keys).filter((k) => !phases.get().has(k))
      if (!ks.length) return false
      set(ks, "leaving")
      const folded = new Promise<void>((r) => setTimeout(() => { set(inPhase(ks, "leaving"), "writing"); r() }, still() ? 0 : FOLD))
      try { await write() } catch (e) {
        await folded
        set(ks, null)
        notifyError(e, failed)
        return false
      }
      await folded
      set(inPhase(ks, "writing"), "done")
      setTimeout(() => set(inPhase(ks, "done"), null), LINGER)
      return true
    },
    /** Put keys back at once (an Undo), whatever their write did. */
    back: (keys: string[]) => set(keys, null),
    /** Whether a key is taken off (or on its way). */
    has: (key: string) => phases.get().has(key),
    /** A hook: `list` without what's taken off, and `leaving(key)`, its row's `data-leaving` while it folds away. A key
     *  whose write is done is let go once `list` no longer has it. */
    use<T>(list: T[] | null | undefined, key: (t: T) => string) {
      const m = phases.use()
      useEffect(() => {
        if (!list || !m.size) return
        const have = new Set(list.map(key))
        set([...m].filter(([k, p]) => p === "done" && !have.has(k)).map(([k]) => k), null)
      })
      return {
        list: list && m.size ? list.filter((t) => { const p = m.get(key(t)); return !p || p === "leaving" }) : list ?? null,
        leaving: (k: string): "" | undefined => (m.get(k) === "leaving" ? "" : undefined),
      }
    },
  }
}

/** A slow action of a button's: `busy` while it runs (`<Button busy>`: it shows it and takes no second press). `run`
 *  returns the work's promise, or undefined when one is already running. */
export function useBusy() {
  const [busy, setBusy] = useState(false)
  const running = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const run = useCallback(<T,>(work: () => Promise<T>): Promise<T> | undefined => {
    if (running.current) return undefined
    running.current = true
    setBusy(true)
    const p = work()
    void p.finally(() => { running.current = false; if (alive.current) setBusy(false) }).catch(() => {})
    return p
  }, [])
  return [busy, run] as const
}

/** A value the user just changed (a switch, a name), shown at once over `value`, the source's: until the source says
 *  the same or moves on, or the old one again when the write fails (saying `failed`). */
export function useChosen<T>(value: T): [T, (v: T, write: () => Promise<unknown>, failed: string) => void] {
  const [chosen, setChosen] = useState<{ v: T; from: T } | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (chosen && (Object.is(value, chosen.v) || !Object.is(value, chosen.from))) setChosen(null)
  }, [value, chosen])
  const choose = useCallback((v: T, write: () => Promise<unknown>, failed: string) => {
    const mine = { v, from: value }
    setChosen(mine)
    const drop = () => { if (alive.current) setChosen((c) => (c === mine ? null : c)) }
    write().then(() => setTimeout(drop, LINGER), (e) => { drop(); notifyError(e, failed) })
  }, [value])
  return [chosen ? chosen.v : value, choose]
}
