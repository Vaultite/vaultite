import { useSyncExternalStore } from "react"

export function signal() {
  let version = 0
  const subs = new Set<() => void>()
  const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
  const current = () => version
  // `read` returns the same value until something changes: useSyncExternalStore's rule.
  function use(): number
  function use<T>(read: () => T): T
  function use<T>(read?: () => T): T | number { return useSyncExternalStore<T | number>(subscribe, read ?? current) }
  return {
    subscribe,
    notify: () => { version++; subs.forEach((f) => { try { f() } catch (e) { console.error(e) } }) },
    version: current,
    use,
  }
}

export type Cell<T> = ReturnType<typeof cell<T>>
/** One value that hooks and subscribers follow: `set` a new one (the same one changes nothing), `use()` it in React
 *  (`use(pick)`: a part of it, drawn again only when that part changes). */
export function cell<T>(initial: T) {
  let value = initial
  const s = signal()
  const set = (v: T) => { if (Object.is(v, value)) return; value = v; s.notify() }
  function use(): T
  function use<R>(pick: (v: T) => R): R
  function use<R>(pick?: (v: T) => R): T | R { return s.use<T | R>(() => (pick ? pick(value) : value)) }
  return {
    get: () => value,
    set,
    update: (f: (v: T) => T) => set(f(value)),
    /** Call `fn` on each change; returns how to stop. */
    subscribe: s.subscribe,
    use,
  }
}
