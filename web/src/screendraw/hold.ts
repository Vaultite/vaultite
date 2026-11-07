// The overlay lets the pointer through but over what can be pressed: `useHold(grab)` takes it while the pointer is over
// (each change once), and lets it go when what took it goes.
import { useCallback, useEffect, useRef } from "react"

/** `hold(on)`: the pointer came over it or left; true when that changed. */
export function useHold(grab: (on: boolean) => void) {
  const over = useRef(false), g = useRef(grab)
  g.current = grab
  useEffect(() => () => { if (over.current) { over.current = false; g.current(false) } }, [])
  return useCallback((on: boolean) => {
    if (over.current === on) return false
    over.current = on
    g.current(on)
    return true
  }, [])
}
