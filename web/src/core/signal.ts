// What hooks redraw on when module state changes: who to tell and a counter, the useSyncExternalStore wiring once.
import { useSyncExternalStore } from "react"

export type Signal = ReturnType<typeof signal>
export function signal() {
  let version = 0
  const subs = new Set<() => void>()
  const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
  const current = () => version
  return {
    subscribe,
    /** Tell everything that reads it: hooks redraw, subscribers run. */
    notify: () => { version++; subs.forEach((f) => f()) },
    version: current,
    /** A hook: `read()` (the counter when omitted), drawn again when it's notified. `read` returns the same value
     *  until something changes (useSyncExternalStore's rule). */
    use: <T = number>(read?: () => T): T => useSyncExternalStore(subscribe, (read ?? current) as () => T),
  }
}

export type Cell<T> = ReturnType<typeof cell<T>>
/** One value that hooks and subscribers follow: `set` a new one (the same one changes nothing), `use()` it in React
 *  (`use(pick)`: a part of it, drawn again only when that part changes). */
export function cell<T>(initial: T) {
  let value = initial
  const s = signal()
  const set = (v: T) => { if (Object.is(v, value)) return; value = v; s.notify() }
  return {
    get: () => value,
    set,
    update: (f: (v: T) => T) => set(f(value)),
    /** Call `fn` on each change; returns how to stop. */
    subscribe: s.subscribe,
    use: <R = T>(pick?: (v: T) => R): R => s.use(() => (pick ? pick(value) : value) as R),
  }
}
