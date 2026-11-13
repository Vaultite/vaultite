import { useEffect, useSyncExternalStore } from "react"
import { webPages } from "@vaultite"

const kept = new Map<string, string | null>()
const KEEP = { s: 1200, b: 40 }
const listeners = new Map<string, Set<() => void>>()
const asked = new Set<string>()
let batch: Map<string, { run: string; small: boolean; shots: Set<string> }> | null = null

const keyOf = (run: string, shot: string, small: boolean) => `${small ? "s" : "b"}:${run}/${shot}`
function put(key: string, v: string | null) {
  kept.delete(key)
  kept.set(key, v)
  const size = key[0] as "s" | "b"
  let n = 0
  for (const k of kept.keys()) if (k[0] === size) n++
  for (const k of kept.keys()) { if (n <= KEEP[size]) break; if (k[0] === size && !listeners.get(k)?.size) { kept.delete(k); n-- } }
  for (const f of listeners.get(key) ?? []) f()
}

export function wantShots(run: string, shots: (string | null | undefined)[], small: boolean) {
  for (const shot of shots) {
    if (!shot) continue
    const key = keyOf(run, shot, small)
    if (kept.has(key) || asked.has(key)) continue
    asked.add(key)
    if (!batch) {
      batch = new Map()
      queueMicrotask(flush)
    }
    const b = `${small ? "s" : "b"}:${run}`
    if (!batch.has(b)) batch.set(b, { run, small, shots: new Set() })
    batch.get(b)!.shots.add(shot)
  }
}
function flush() {
  const all = [...(batch?.values() ?? [])]
  batch = null
  for (const { run, small, shots } of all) {
    const list = [...shots]
    for (let i = 0; i < list.length; i += small ? 24 : 4) {
      const part = list.slice(i, i + (small ? 24 : 4))
      void Promise.resolve(webPages?.engine?.("agents:shots", run, part, small)).then((r) => {
        const got = (r && typeof r === "object" ? r : {}) as Record<string, string | null>
        for (const s of part) { const k = keyOf(run, s, small); asked.delete(k); put(k, typeof got[s] === "string" ? got[s] : null) }
      }, () => { for (const s of part) asked.delete(keyOf(run, s, small)) })
    }
  }
}

export function useShot(run: string, shot: string | null | undefined, small: boolean, on = true): string | null | undefined {
  const key = shot ? keyOf(run, shot, small) : ""
  const v = useSyncExternalStore((f) => {
    if (!key) return () => {}
    let set = listeners.get(key)
    if (!set) listeners.set(key, set = new Set())
    set.add(f)
    return () => { set.delete(f); if (!set.size) listeners.delete(key) }
  }, () => (key ? kept.get(key) : null))
  useEffect(() => { if (key && on && v === undefined) wantShots(run, [shot], small) }, [key, on, v, run, shot, small])
  return shot ? v : null
}
