import { useCallback, useEffect, useRef, useState } from "react"
import type { Permission } from "../../../core/permissions.ts"

const WATCH_MS = 3 * 60_000

export function usePermissions<T>(read: () => Promise<T>, act: (id: string) => Promise<unknown>, listOf: (r: T) => Permission[] | undefined) {
  const [report, setReport] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [granting, setGranting] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const since = useRef(0)
  const list = useRef(listOf)
  list.current = listOf

  const refresh = useCallback(() => read().then((r) => { setReport(r); setError(null); return r }, (e: unknown) => { setError(e); return null }), [read])

  useEffect(() => {
    void refresh()
    const back = () => { if (document.visibilityState === "visible") void refresh() }
    window.addEventListener("focus", back)
    document.addEventListener("visibilitychange", back)
    return () => { window.removeEventListener("focus", back); document.removeEventListener("visibilitychange", back) }
  }, [refresh])

  // With System Settings in front the window hears no focus or visibility change, so it polls.
  useEffect(() => {
    if (!granting) return
    const t = setInterval(() => void refresh().then((r) => {
      const p = r ? list.current(r)?.find((x) => x.id === granting) : undefined
      if (p?.state === "allowed" || Date.now() - since.current > WATCH_MS) setGranting(null)
    }), 1000)
    return () => clearInterval(t)
  }, [granting, refresh])

  const grant = useCallback(async (id: string) => {
    since.current = Date.now()
    setGranting(id)
    setPending((s) => new Set(s).add(id))
    try { await act(id) } finally {
      setPending((s) => { const n = new Set(s); n.delete(id); return n })
      void refresh()
    }
  }, [act, refresh])

  return { report, error, refresh, grant, granting, pending }
}
