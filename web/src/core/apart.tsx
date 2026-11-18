import { lazy, memo, useEffect, useState, type ComponentType, type ReactNode } from "react"

/** Code loaded apart, drawn at once if in (`preload`): React.lazy suspends even then, and holds a reveal up to 300 ms. */
export function apart<P extends object>(load: () => Promise<ComponentType<P>>, { memoized = false } = {}) {
  let got: ComponentType<P> | null = null
  let loading: Promise<ComponentType<P>> | null = null
  const preload = () => {
    if (!loading) { loading = load().then((c) => (got = c)); loading.catch(() => { loading = null }) }
    return loading
  }
  const Lazy = lazy(() => preload().then((c) => ({ default: c })))
  function Part(all: P & { waiting?: ReactNode }) {
    const stands = all.waiting !== undefined
    const [now, setNow] = useState<{ drawn: ComponentType<P> | null; failed?: boolean }>(() => ({ drawn: got }))
    useEffect(() => {
      if (now.drawn || now.failed || !stands) return
      let on = true
      preload().then((c) => { if (on) setNow({ drawn: c }) }, () => { if (on) setNow({ drawn: null, failed: true }) })
      return () => { on = false }
    }, [now, stands])
    const Drawn = now.drawn
    if (Drawn) return <Drawn {...all} />
    return stands && !now.failed ? all.waiting : <Lazy {...all} />
  }
  return Object.assign(memoized ? memo(Part) : Part, { preload: () => { preload().catch(() => undefined) } })
}
