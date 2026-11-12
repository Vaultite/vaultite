import { useCallback, useState } from "react"

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

export function useStateFor<T>(deps: readonly unknown[], initial: () => T): [T, (value: T) => void] {
  const [held, setHeld] = useState(() => ({ deps, value: initial() }))
  const set = useCallback((value: T) => setHeld((h) => ({ deps: h.deps, value })), [])
  if (same(held.deps, deps)) return [held.value, set]
  const fresh = { deps, value: initial() }
  setHeld(fresh)
  return [fresh.value, set]
}

export const useDraft = <T>(value: T) => useStateFor([value], () => value)
