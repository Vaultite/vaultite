// macOS's permissions on a page and the way to allow one (Settings > Permissions, Set up Vaultite): `act` presses a
// button (electron/permissions.ts), `read` runs again when the window comes back, and each second while one is allowed.
import { useCallback, useEffect, useRef, useState } from "react"
import type { Permission } from "../../../core/permissions.ts"

/** How long a grant is watched for: System Settings may ask for a password, or the user may wander off. */
const WATCH_MS = 3 * 60_000

/** `read` and `act` keep their identity. `grant(id)` resolves once its button did its part (a prompt answered, Settings
 *  opened); `pending`: buttons still at it (a prompt waiting), `granting`: the one watched until it reads allowed. */
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
    // (back from System Settings: what changed there shows)
    const back = () => { if (document.visibilityState === "visible") void refresh() }
    window.addEventListener("focus", back)
    document.addEventListener("visibilitychange", back)
    return () => { window.removeEventListener("focus", back); document.removeEventListener("visibilitychange", back) }
  }, [refresh])

  // (System Settings is in front meanwhile, so the window hears nothing: it asks)
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
