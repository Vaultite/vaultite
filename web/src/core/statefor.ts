import { useCallback, useState, type SetStateAction } from "react"

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const isUpdate = <T>(next: SetStateAction<T>): next is (prev: T) => T => next instanceof Function

export function useStateFor<T>(deps: readonly unknown[], initial: () => T): [T, (next: SetStateAction<T>) => void] {
  const [held, setHeld] = useState(() => ({ deps, value: initial() }))
  const set = useCallback((next: SetStateAction<T>) => setHeld((h) => {
    const value = isUpdate(next) ? next(h.value) : next
    return Object.is(value, h.value) ? h : { deps: h.deps, value }
  }), [])
  if (same(held.deps, deps)) return [held.value, set]
  const fresh = { deps, value: initial() }
  setHeld(fresh)
  return [fresh.value, set]
}

export const useDraft = <T>(value: T) => useStateFor([value], () => value)
