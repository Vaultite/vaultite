import { lazy, memo, useState, type ComponentType } from "react"

/** Code loaded apart, drawn at once if in (`preload`): React.lazy suspends even then, which an opening's motion misses. */
export function apart<P extends object>(load: () => Promise<ComponentType<P>>, { memoized = false } = {}) {
  let got: ComponentType<P> | null = null
  let loading: Promise<ComponentType<P>> | null = null
  const preload = () => {
    if (!loading) { loading = load().then((c) => (got = c)); loading.catch(() => { loading = null }) }
    return loading
  }
  const Lazy = lazy(() => preload().then((c) => ({ default: c })))
  function Part(props: P) {
    const [Drawn] = useState<ComponentType<P> | typeof Lazy>(() => got ?? Lazy)
    return <Drawn {...props} />
  }
  return Object.assign(memoized ? memo(Part) : Part, { preload: () => { preload().catch(() => undefined) } })
}
