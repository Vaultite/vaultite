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
