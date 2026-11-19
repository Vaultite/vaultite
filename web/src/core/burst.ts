import { useEffect, useRef } from "react"
import { trackSoon } from "@/core/unsaved"

export const BURST_MS = 100

export function useBurst(run: ((signal: AbortSignal) => void) | null, deps: unknown[], what: string, { wait = BURST_MS, leading = true } = {}) {
  const last = useRef(-Infinity)
  useEffect(() => {
    if (!run) return
    const stop = new AbortController(), now = performance.now(), quiet = leading && now - last.current >= wait
    last.current = now
    if (quiet) { run(stop.signal); return () => stop.abort() }
    const off = trackSoon(what, () => true)
    const t = setTimeout(() => { off(); run(stop.signal) }, wait)
    return () => { off(); clearTimeout(t); stop.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` are the caller's, as useEffect's
  }, deps)
}
